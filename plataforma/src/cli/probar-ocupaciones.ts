#!/usr/bin/env node
/**
 * Prueba el agente de ocupaciones desde la línea de comandos, con las llaves
 * del `.env`. Sirve para dos cosas antes de usarlo en serio:
 *
 *   npm run ia:ocupaciones -- --puesto "*OPERARIO 2°" --centro "HIGIENICOS"
 *
 *     Un caso. Imprime la sugerencia completa con su traza, nodo por nodo.
 *
 *   npm run ia:ocupaciones -- --padron "~/Documents/KCM Anexos/sem 31 CAP.xlsx" --limite 20
 *
 *     La evaluación. Toma del padrón cada combinación de puesto y centro de
 *     costos —de la más frecuente a la menos—, la clasifica desde cero y
 *     escribe un CSV con la clave que ya trae el padrón al lado, para medir el
 *     acierto contra la llenada manual. Una combinación se evalúa una sola vez
 *     porque la entrada del agente es la misma para todos sus trabajadores.
 *
 *   npm run ia:ocupaciones -- --padron "~/Documents/KCM Anexos/sem 31 CAP.xlsx" --limite 12 --lote
 *
 *     La misma evaluación, pero por lotes, como la hace el botón «Clasificar
 *     faltantes»: varias combinaciones por petición. Dice cuántas peticiones
 *     gastó en total.
 *
 * Del padrón sólo se usan puesto y centro de costos: nombres, CURP, RFC y
 * números de trabajador se leen del archivo local y no salen del equipo.
 */

import { readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { setTimeout as esperar } from "node:timers/promises";

import {
  armarClasificadorPorLotes,
  armarServicioDeOcupaciones,
} from "../adapters/ia/agente-ocupaciones.ts";
import { RosterExtractorAdapter } from "../adapters/archivos/extractor-padron.ts";
import { leerAgenteDelEntorno } from "../config/agente-ocupaciones.ts";
import { ConfigError } from "../config/environment.ts";
import { subareaDelCodigo } from "../domain/ocupaciones/catalogo.ts";
import type { PropuestaValidada } from "../domain/ocupaciones/comunes.ts";
import type { EstadoDeSugerencia } from "../domain/ocupaciones/comunes.ts";
import { DomainError } from "../domain/comun/errores.ts";
import type { CasoEnLote } from "../domain/ocupaciones/instrucciones.ts";
import { leerCaso } from "../domain/ocupaciones/servicio.ts";

interface Opciones {
  puesto: string;
  centro: string;
  padron: string;
  limite: number;
  pausaMs: number;
  salida: string;
  lote: boolean;
}

function leerOpciones(argv: readonly string[]): Opciones {
  const opciones: Opciones = {
    puesto: "",
    centro: "",
    padron: "",
    limite: 20,
    pausaMs: 0,
    salida: "",
    lote: false,
  };
  for (let indice = 0; indice < argv.length; indice += 1) {
    const bandera = argv[indice] ?? "";
    if (bandera === "--lote") {
      opciones.lote = true;
      continue;
    }
    const valor = argv[(indice += 1)] ?? "";
    if (bandera === "--puesto") opciones.puesto = valor;
    else if (bandera === "--centro") opciones.centro = valor;
    else if (bandera === "--padron") opciones.padron = valor.replace(/^~(?=$|\/)/u, os.homedir());
    else if (bandera === "--limite") opciones.limite = Math.max(1, Number.parseInt(valor, 10) || 1);
    else if (bandera === "--pausa") opciones.pausaMs = Math.max(0, Number(valor) || 0) * 1000;
    else if (bandera === "--salida") opciones.salida = path.resolve(valor);
    else throw new ConfigError(`Bandera no reconocida: ${bandera}`);
  }
  if (!opciones.padron && !(opciones.puesto && opciones.centro)) {
    throw new ConfigError("Hace falta --padron, o --puesto junto con --centro.");
  }
  return opciones;
}

function celda(valor: string | number): string {
  const texto = String(valor);
  return /[",\n]/u.test(texto) ? `"${texto.replaceAll('"', '""')}"` : texto;
}

interface Combinacion {
  readonly puesto: string;
  readonly centro: string;
  trabajadores: number;
  readonly claves: Set<string>;
}

function combinaciones(archivo: string): Combinacion[] {
  const padron = new RosterExtractorAdapter().extraer(readFileSync(archivo));
  const porPar = new Map<string, Combinacion>();
  for (const empleado of padron.employees) {
    const centro = empleado.costCenterName ?? "";
    if (!empleado.position || !centro) continue;
    const llave = `${empleado.position}\u0000${centro}`;
    const par = porPar.get(llave) ?? {
      puesto: empleado.position,
      centro,
      trabajadores: 0,
      claves: new Set<string>(),
    };
    par.trabajadores += 1;
    if (empleado.cnoKey) par.claves.add(empleado.cnoKey);
    porPar.set(llave, par);
  }
  return [...porPar.values()].sort((a, b) => b.trabajadores - a.trabajadores);
}

interface Respuesta {
  readonly estado: EstadoDeSugerencia;
  readonly sugerencia: PropuestaValidada | null;
  readonly verificador: PropuestaValidada | null;
  readonly razon: string;
}

async function unoPorUno(
  servicio: ReturnType<typeof armarServicioDeOcupaciones>,
  pares: readonly Combinacion[],
  pausaMs: number,
): Promise<(Respuesta | undefined)[]> {
  const respuestas: (Respuesta | undefined)[] = [];
  for (const [indice, par] of pares.entries()) {
    if (indice > 0 && pausaMs > 0) await esperar(pausaMs);
    try {
      const sugerencia = await servicio.sugerir({ puesto: par.puesto, centroDeCostos: par.centro });
      respuestas.push(sugerencia);
      process.stderr.write(
        `  ${String(indice + 1)}/${String(pares.length)} ${par.puesto} · ${par.centro}: ${sugerencia.estado}\n`,
      );
    } catch (error) {
      respuestas.push(undefined);
      process.stderr.write(`  ${par.puesto} · ${par.centro}: ${String(error)}\n`);
    }
  }
  return respuestas;
}

/** Como el botón «Clasificar faltantes»: el lote avanza por pasos hasta terminar. */
async function porLotes(
  parametros: NonNullable<ReturnType<typeof leerAgenteDelEntorno>>,
  pares: readonly Combinacion[],
): Promise<(Respuesta | undefined)[]> {
  const lotes = armarClasificadorPorLotes(parametros);
  // La misma puerta y el mismo tope que el botón: lo que parece un dato personal
  // no sale del equipo, y la corrida no pasa de su tope.
  const tope = parametros.lote.casosPorCorrida;
  const casos: CasoEnLote[] = [];
  const parDelCaso = new Map<string, number>();
  for (const [indice, par] of pares.entries()) {
    let caso;
    try {
      caso = leerCaso({ puesto: par.puesto, centroDeCostos: par.centro });
    } catch (error) {
      if (!(error instanceof DomainError)) throw error;
      process.stderr.write(`  se omite ${par.puesto} · ${par.centro}: ${error.message}\n`);
      continue;
    }
    if (casos.length === tope) {
      process.stderr.write(
        `  la corrida llega hasta ${String(tope)} combinaciones; el resto se omite\n`,
      );
      break;
    }
    const id = `C${String(casos.length + 1).padStart(3, "0")}`;
    casos.push({ id, ...caso });
    parDelCaso.set(id, indice);
  }
  const inicio = Date.now();
  let estado = lotes.iniciar(casos);
  for (let paso = 1; paso <= 40; paso += 1) {
    const avance = await lotes.avanzar(lotes.leer(JSON.stringify(estado)));
    estado = avance.estado;
    process.stderr.write(
      `  paso ${String(paso)}: ${String(estado.consultas)} peticiones, ${String(
        Math.round((Date.now() - inicio) / 1000),
      )} s\n`,
    );
    if (avance.resultados) {
      for (const paso of estado.traza) {
        process.stderr.write(
          `    · ${paso.nodo} ${paso.modelo ?? ""} ${String(paso.milisegundos)} ms: ${paso.nota}\n`,
        );
      }
      const porPar: (Respuesta | undefined)[] = pares.map(() => undefined);
      for (const resultado of avance.resultados) {
        const indice = parDelCaso.get(resultado.id);
        if (indice !== undefined) porPar[indice] = resultado;
      }
      return porPar;
    }
  }
  throw new Error("el lote no terminó en 40 pasos");
}

async function main(): Promise<void> {
  const opciones = leerOpciones(process.argv.slice(2));
  const parametros = leerAgenteDelEntorno();
  if (!parametros) {
    throw new ConfigError("Falta KCM_IA_OPENROUTER_LLAVE en el entorno (.env).");
  }
  const servicio = armarServicioDeOcupaciones(parametros);
  process.stderr.write(`Agente ${servicio.version} · huella ${servicio.huella}\n`);

  if (!opciones.padron) {
    const sugerencia = await servicio.sugerir({
      puesto: opciones.puesto,
      centroDeCostos: opciones.centro,
    });
    process.stdout.write(`${JSON.stringify(sugerencia, null, 2)}\n`);
    return;
  }

  const pares = combinaciones(opciones.padron).slice(0, opciones.limite);
  const respuestas = opciones.lote
    ? await porLotes(parametros, pares)
    : await unoPorUno(servicio, pares, opciones.pausaMs);

  const filas = [
    "puesto,centro_de_costos,trabajadores,estado,codigo,descripcion,subarea,confianza,alternativa,codigo_verificador,razon,clave_en_padron,coincide_clave,coincide_subarea",
  ];
  const cuenta = {
    sugerida: 0,
    revisar: 0,
    sin_respuesta: 0,
    comparables: 0,
    clave: 0,
    subarea: 0,
  };

  for (const [indice, par] of pares.entries()) {
    const respuesta = respuestas[indice];
    if (!respuesta) continue;
    cuenta[respuesta.estado] += 1;
    const propuesta = respuesta.sugerencia;
    const humana = par.claves.size === 1 ? ([...par.claves][0] ?? "") : [...par.claves].join("/");
    let coincideClave = "";
    let coincideSubarea = "";
    if (par.claves.size === 1 && propuesta) {
      cuenta.comparables += 1;
      const mismaClave = humana === propuesta.codigo;
      const mismaSubarea = subareaDelCodigo(humana) === propuesta.subarea;
      if (mismaClave) cuenta.clave += 1;
      if (mismaSubarea) cuenta.subarea += 1;
      coincideClave = mismaClave ? "sí" : "no";
      coincideSubarea = mismaSubarea ? "sí" : "no";
    }
    filas.push(
      [
        par.puesto,
        par.centro,
        par.trabajadores,
        respuesta.estado,
        propuesta?.codigo ?? "",
        propuesta?.descripcion ?? "",
        propuesta?.subarea ?? "",
        propuesta?.confianza ?? "",
        propuesta?.alternativa?.codigo ?? "",
        respuesta.verificador?.codigo ?? "",
        respuesta.razon,
        humana,
        coincideClave,
        coincideSubarea,
      ]
        .map(celda)
        .join(","),
    );
  }

  const csv = `${filas.join("\n")}\n`;
  if (opciones.salida) writeFileSync(opciones.salida, csv, "utf8");
  else process.stdout.write(csv);

  process.stderr.write(
    `\n${String(pares.length)} combinaciones: ${String(cuenta.sugerida)} sugeridas, ` +
      `${String(cuenta.revisar)} a revisar, ${String(cuenta.sin_respuesta)} sin respuesta.\n` +
      (cuenta.comparables > 0
        ? `Contra la clave del padrón (${String(cuenta.comparables)} comparables): ` +
          `${String(cuenta.clave)} con la misma clave, ${String(cuenta.subarea)} con la misma subárea.\n`
        : "El padrón no trae claves con que comparar.\n"),
  );
}

try {
  await main();
} catch (error) {
  process.stderr.write(error instanceof ConfigError ? `${error.message}\n` : `${String(error)}\n`);
  process.exitCode = 1;
}
