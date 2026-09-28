/**
 * Lo que se le dice al modelo en cada paso, y la forma exacta de lo que debe
 * contestar.
 *
 * Tres decisiones que conviene no deshacer sin volver a evaluar:
 *
 * - **Sin nombre de empresa ni de planta.** El contexto es «una planta de
 *   papel tisú», que basta para razonar y no identifica a nadie. Un puesto
 *   único junto al nombre de la empresa sí apuntaría a una persona.
 * - **Sin ejemplos del padrón.** Cada caso se evalúa desde cero: el modelo no ve
 *   cómo se clasificó a otros trabajadores.
 * - **Dos pasos.** Primero la subárea entre 55; después la ocupación entre las
 *   de esa subárea (46 en la mediana). Así cada llamada cabe en el tope por
 *   minuto de los planes gratuitos y el modelo compara pocas opciones a la vez.
 *
 * Los criterios son del departamento y se corrigen aquí. Cualquier cambio de
 * texto cambia la huella de configuración, y con ella queda marcado en cada
 * sugerencia con qué instrucciones se hizo.
 */

import { z } from "zod";

import type { SolicitudJson } from "../../ports/modelo-de-lenguaje.port.ts";
import { SUBAREAS_CNO, type Ocupacion } from "./catalogo.ts";

export interface CasoDeOcupacion {
  readonly puesto: string;
  readonly centroDeCostos: string;
}

const CONTEXTO = [
  "Clasificas puestos de una planta que fabrica productos de papel tisú —papel higiénico, pañuelos faciales, servilletas y toallas de papel— en el Catálogo Nacional de Ocupaciones de México (STPS).",
  "",
  "Recibes dos datos: el nombre del puesto y el nombre del centro de costos donde trabaja la persona. El centro de costos dice qué se hace ahí: una máquina, un proceso, un almacén, un laboratorio o un área administrativa. El puesto dice el papel de la persona dentro de él. Un mismo puesto puede corresponder a ocupaciones distintas en centros de costos distintos.",
  "",
  "Criterios:",
  "- Decide por la actividad real que implica el puesto en ese centro de costos, no por un término aislado.",
  "- El nivel o la categoría (1°, 2°, 3°, A, B, «especial») no cambia la ocupación.",
  "- Abreviaturas frecuentes: MANTTO = mantenimiento; OP. = operador; AUX. = auxiliar; SUPDTE. = superintendente; ING. = ingeniero o ingeniería; GTE. = gerente; RELS. INDS. = relaciones industriales. El asterisco al inicio del puesto sólo marca personal sindicalizado.",
  "- Cuidado con los homónimos: en una planta, «instrumentista» es un técnico de instrumentación industrial, no un músico.",
  "- En una planta de papel tisú hay dos clases de centros de costos de producción: las máquinas de papel, que fabrican la hoja a partir de la pasta, y las líneas de conversión, que toman la hoja ya fabricada y la cortan, embobinan, doblan y empacan como papel higiénico, servilleta, pañuelo o toalla. Quien opera una línea de conversión no fabrica papel, y quien opera una máquina de papel no convierte.",
].join("\n");

function listaDeSubareas(): string {
  const lineas: string[] = [];
  let areaActual = "";
  for (const subarea of SUBAREAS_CNO) {
    if (subarea.area !== areaActual) {
      areaActual = subarea.area;
      lineas.push(`${subarea.area} ${subarea.denominacionDelArea}`);
    }
    lineas.push(`  ${subarea.clave} ${subarea.denominacion}`);
  }
  return lineas.join("\n");
}

export const INSTRUCCIONES_DE_SUBAREA = [
  CONTEXTO,
  "",
  "Paso actual: elige la subárea del catálogo. Devuelve una o dos subáreas, la más probable primero; la segunda sólo si de verdad dudas entre dos.",
  "",
  "Responde sólo con un objeto JSON de esta forma:",
  '{"subareas": ["05.5"], "motivo": "una o dos frases"}',
  "",
  "Subáreas del catálogo:",
  listaDeSubareas(),
].join("\n");

export const INSTRUCCIONES_DE_OCUPACION = [
  CONTEXTO,
  "",
  "Paso actual: elige la ocupación específica. Recibes las opciones de una o dos subáreas del catálogo, cada una con su código de nueve o diez dígitos. Elige el código cuya descripción corresponde mejor a lo que hace la persona en ese centro de costos.",
  "- Si ninguna opción describe bien el puesto, elige la más cercana y marca confianza baja.",
  "- Confianza alta: la descripción corresponde claramente. Media: corresponde en lo general, pero otra opción también es razonable. Baja: ninguna corresponde bien.",
  "- En «alternativa» va el segundo mejor código de la lista, o una cadena vacía si no hay otro razonable.",
  "- Los códigos se copian tal como aparecen en la lista.",
  "",
  "Responde sólo con un objeto JSON de esta forma:",
  '{"codigo": "552081900", "alternativa": "552090402", "confianza": "alta", "motivo": "una o dos frases"}',
].join("\n");

/** Lo que el modelo debe devolver en el primer paso. Se valida siempre, aunque el proveedor prometa el esquema. */
export const RespuestaDeSubareas = z.object({
  subareas: z.array(z.string()),
  motivo: z.string(),
});
export type RespuestaDeSubareas = z.infer<typeof RespuestaDeSubareas>;

export const CONFIANZAS = ["alta", "media", "baja"] as const;
export type Confianza = (typeof CONFIANZAS)[number];

export const RespuestaDeOcupacion = z.object({
  codigo: z.string(),
  alternativa: z.string(),
  confianza: z.enum(CONFIANZAS),
  motivo: z.string(),
});
export type RespuestaDeOcupacion = z.infer<typeof RespuestaDeOcupacion>;

const ESQUEMA_DE_SUBAREAS = {
  type: "object",
  properties: {
    subareas: {
      type: "array",
      items: { type: "string", enum: SUBAREAS_CNO.map((subarea) => subarea.clave) },
    },
    motivo: { type: "string" },
  },
  required: ["subareas", "motivo"],
  additionalProperties: false,
} as const;

const ESQUEMA_DE_OCUPACION = {
  type: "object",
  properties: {
    codigo: { type: "string" },
    alternativa: { type: "string" },
    confianza: { type: "string", enum: [...CONFIANZAS] },
    motivo: { type: "string" },
  },
  required: ["codigo", "alternativa", "confianza", "motivo"],
  additionalProperties: false,
} as const;

function datosDelCaso(caso: CasoDeOcupacion): string {
  return `Puesto: ${caso.puesto}\nCentro de costos: ${caso.centroDeCostos}`;
}

export function solicitudDeSubareas(caso: CasoDeOcupacion): SolicitudJson {
  return {
    instrucciones: INSTRUCCIONES_DE_SUBAREA,
    mensaje: datosDelCaso(caso),
    esquema: { nombre: "subareas", definicion: ESQUEMA_DE_SUBAREAS },
    validar: (datos) => RespuestaDeSubareas.safeParse(datos).success,
  };
}

export interface BloqueDeOpciones {
  readonly subarea: string;
  readonly denominacion: string;
  readonly ocupaciones: readonly Ocupacion[];
}

export function solicitudDeOcupacion(
  caso: CasoDeOcupacion,
  bloques: readonly BloqueDeOpciones[],
  aviso: string,
): SolicitudJson {
  const opciones = bloques.map((bloque) =>
    [
      `Opciones de ${bloque.subarea} ${bloque.denominacion}:`,
      ...bloque.ocupaciones.map((ocupacion) => `${ocupacion.codigo} ${ocupacion.descripcion}`),
    ].join("\n"),
  );
  const partes = [datosDelCaso(caso), "", ...opciones];
  if (aviso) partes.push("", `Aviso: la respuesta anterior no sirvió porque ${aviso}.`);
  return {
    instrucciones: INSTRUCCIONES_DE_OCUPACION,
    mensaje: partes.join("\n"),
    esquema: { nombre: "ocupacion", definicion: ESQUEMA_DE_OCUPACION },
    validar: (datos) => RespuestaDeOcupacion.safeParse(datos).success,
  };
}

// ------------------------------------------------------------------ en lote
//
// Las mismas preguntas, con varios casos por petición. El plan gratuito da 50
// peticiones al día y un caso suelto gasta cuatro; en lote, 50 trabajadores
// caben en unas quince. Lo que se cuida para que el lote no cueste precisión:
//
// - cada caso lleva su identificador y se contesta por separado;
// - las instrucciones piden resolverlos de forma independiente, porque el
//   riesgo propio del lote es contagiar la respuesta de un caso al siguiente;
// - la ocupación se pregunta en grupos chicos que comparten subárea, de modo
//   que el modelo compara pocas opciones y pocos casos a la vez.

/** Un caso dentro de un lote. El identificador es corto y no dice nada de la persona. */
export interface CasoEnLote extends CasoDeOcupacion {
  readonly id: string;
}

const INDEPENDENCIA = [
  "Recibes varios casos, cada uno con su identificador. Resuelve cada caso por separado, como si fuera el único:",
  "- Dos casos parecidos pueden tener ocupaciones distintas: el centro de costos puede cambiar la respuesta.",
  "- No copies la respuesta de un caso a otro sin revisar el segundo por sí mismo.",
  "- Contesta todos los identificadores, cada uno una sola vez.",
].join("\n");

export const INSTRUCCIONES_DE_SUBAREA_EN_LOTE = [
  CONTEXTO,
  "",
  INDEPENDENCIA,
  "",
  "Paso actual: elige la subárea del catálogo para cada caso. Una o dos subáreas por caso, la más probable primero; la segunda sólo si de verdad dudas entre dos.",
  "",
  "Responde sólo con un objeto JSON de esta forma:",
  '{"resultados": [{"id": "C001", "subareas": ["05.5"], "motivo": "una frase"}]}',
  "",
  "Subáreas del catálogo:",
  listaDeSubareas(),
].join("\n");

export const INSTRUCCIONES_DE_OCUPACION_EN_LOTE = [
  CONTEXTO,
  "",
  INDEPENDENCIA,
  "",
  "Paso actual: elige la ocupación específica de cada caso. Todos los casos comparten las opciones de la lista, cada una con su código de nueve o diez dígitos. Para cada caso, elige el código cuya descripción corresponde mejor a lo que hace esa persona en su centro de costos.",
  "- Si ninguna opción describe bien el puesto, elige la más cercana y marca confianza baja.",
  "- Confianza alta: la descripción corresponde claramente. Media: corresponde en lo general, pero otra opción también es razonable. Baja: ninguna corresponde bien.",
  "- En «alternativa» va el segundo mejor código de la lista, o una cadena vacía si no hay otro razonable.",
  "- Los códigos se copian tal como aparecen en la lista.",
  "",
  "Responde sólo con un objeto JSON de esta forma:",
  '{"resultados": [{"id": "C001", "codigo": "552081900", "alternativa": "552090402", "confianza": "alta", "motivo": "una frase"}]}',
].join("\n");

export const RespuestaDeSubareasEnLote = z.object({
  resultados: z.array(RespuestaDeSubareas.extend({ id: z.string() })),
});
export type RespuestaDeSubareasEnLote = z.infer<typeof RespuestaDeSubareasEnLote>;

export const RespuestaDeOcupacionEnLote = z.object({
  resultados: z.array(RespuestaDeOcupacion.extend({ id: z.string() })),
});
export type RespuestaDeOcupacionEnLote = z.infer<typeof RespuestaDeOcupacionEnLote>;

const ESQUEMA_DE_SUBAREAS_EN_LOTE = {
  type: "object",
  properties: {
    resultados: {
      type: "array",
      items: {
        type: "object",
        properties: { id: { type: "string" }, ...ESQUEMA_DE_SUBAREAS.properties },
        required: ["id", ...ESQUEMA_DE_SUBAREAS.required],
        additionalProperties: false,
      },
    },
  },
  required: ["resultados"],
  additionalProperties: false,
} as const;

const ESQUEMA_DE_OCUPACION_EN_LOTE = {
  type: "object",
  properties: {
    resultados: {
      type: "array",
      items: {
        type: "object",
        properties: { id: { type: "string" }, ...ESQUEMA_DE_OCUPACION.properties },
        required: ["id", ...ESQUEMA_DE_OCUPACION.required],
        additionalProperties: false,
      },
    },
  },
  required: ["resultados"],
  additionalProperties: false,
} as const;

function lineaDelCaso(caso: CasoEnLote): string {
  return `${caso.id} | Puesto: ${caso.puesto} | Centro de costos: ${caso.centroDeCostos}`;
}

export function solicitudDeSubareasEnLote(casos: readonly CasoEnLote[]): SolicitudJson {
  return {
    instrucciones: INSTRUCCIONES_DE_SUBAREA_EN_LOTE,
    mensaje: ["Casos:", ...casos.map(lineaDelCaso)].join("\n"),
    esquema: { nombre: "subareas_en_lote", definicion: ESQUEMA_DE_SUBAREAS_EN_LOTE },
    validar: (datos) => RespuestaDeSubareasEnLote.safeParse(datos).success,
  };
}

/**
 * La ocupación de un grupo de casos que comparten opciones. `avisos` lleva, por
 * identificador, por qué no sirvió la respuesta anterior de ese caso.
 */
export function solicitudDeOcupacionEnLote(
  casos: readonly CasoEnLote[],
  bloques: readonly BloqueDeOpciones[],
  avisos: Readonly<Record<string, string>>,
): SolicitudJson {
  const opciones = bloques.map((bloque) =>
    [
      `Opciones de ${bloque.subarea} ${bloque.denominacion}:`,
      ...bloque.ocupaciones.map((ocupacion) => `${ocupacion.codigo} ${ocupacion.descripcion}`),
    ].join("\n"),
  );
  const conAviso = casos.filter((caso) => avisos[caso.id]);
  const partes = ["Casos:", ...casos.map(lineaDelCaso), "", ...opciones];
  if (conAviso.length > 0) {
    partes.push(
      "",
      "Avisos de la respuesta anterior:",
      ...conAviso.map((caso) => `${caso.id}: no sirvió porque ${avisos[caso.id] ?? ""}.`),
    );
  }
  return {
    instrucciones: INSTRUCCIONES_DE_OCUPACION_EN_LOTE,
    mensaje: partes.join("\n"),
    esquema: { nombre: "ocupacion_en_lote", definicion: ESQUEMA_DE_OCUPACION_EN_LOTE },
    validar: (datos) => RespuestaDeOcupacionEnLote.safeParse(datos).success,
  };
}

/**
 * Todo el texto fijo que el agente le manda a un modelo, para la huella:
 * cambiar una instrucción o un esquema cambia la huella de las sugerencias.
 */
export const TEXTOS_DEL_AGENTE = {
  instrucciones: [
    INSTRUCCIONES_DE_SUBAREA,
    INSTRUCCIONES_DE_OCUPACION,
    INSTRUCCIONES_DE_SUBAREA_EN_LOTE,
    INSTRUCCIONES_DE_OCUPACION_EN_LOTE,
  ],
  esquemas: [
    ESQUEMA_DE_SUBAREAS,
    ESQUEMA_DE_OCUPACION,
    ESQUEMA_DE_SUBAREAS_EN_LOTE,
    ESQUEMA_DE_OCUPACION_EN_LOTE,
  ],
} as const;
