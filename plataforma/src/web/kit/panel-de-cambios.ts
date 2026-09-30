import type {
  DetalleDeCambios,
  FechaDelCambio,
  MovimientoDelCambio,
  PersonaDelCambio,
} from "../../domain/cargas/detalle.ts";
import { fechaCorta } from "./fechas.ts";
import { html, type Html } from "./html.ts";

type Tono = "alta" | "baja" | "cambio" | "aviso";

export interface CifraDelPanel {
  readonly valor: number;
  readonly rotulo: string;
  readonly tono: Tono;
}

const SIGNO: Readonly<Record<Tono, string>> = { alta: "+", baja: "−", cambio: "↻", aviso: "!" };

function renderCifra(cifra: CifraDelPanel): Html {
  return html`<span class="cambio-cifra cambio-cifra-${cifra.tono}">
    <span class="cambio-cifra-valor">${SIGNO[cifra.tono]}${cifra.valor}</span>
    <span class="cambio-cifra-rotulo">${cifra.rotulo}</span>
  </span>`;
}

function renderQuien(nomina: string, nombre: string): Html {
  return html`<span class="diff-nomina">${nomina}</span>
    <span class="diff-nombre">${nombre === "" ? "Sin nombre registrado" : nombre}</span>`;
}

function valor(texto: string): string {
  if (texto === "") return "—";
  return /^\d{4}-\d{2}-\d{2}$/u.test(texto) ? fechaCorta(texto) : texto;
}

function renderDato(movimiento: MovimientoDelCambio): Html {
  return html`<span
    class="diff-dato${movimiento.soloAviso ? " diff-dato-aviso" : ""}"
    title="${movimiento.soloAviso ? "Sólo aviso: no se escribe" : ""}"
  >
    <span class="diff-campo">${movimiento.campo}</span>
    <del>${valor(movimiento.antes)}</del>
    <span class="diff-flecha" aria-hidden="true">→</span>
    <ins>${valor(movimiento.ahora)}</ins>
  </span>`;
}

function renderFecha(fecha: FechaDelCambio): Html {
  return html`<span class="diff-dato">
    <span class="diff-campo">${fecha.curso}</span>
    ${fecha.antes === null ? "" : html`<del>${fechaCorta(fecha.antes)}</del>`}
    ${
      fecha.antes !== null && fecha.ahora !== null
        ? html`<span class="diff-flecha" aria-hidden="true">→</span>`
        : ""
    }
    ${fecha.ahora === null ? "" : html`<ins>${fechaCorta(fecha.ahora)}</ins>`}
  </span>`;
}

function renderFila(tono: Tono, nomina: string, nombre: string, datos: readonly Html[]): Html {
  return html`<li class="diff-fila diff-${tono}">
    <span class="diff-marca" aria-hidden="true">${SIGNO[tono]}</span>
    ${renderQuien(nomina, nombre)}
    <span class="diff-detalle">${datos}</span>
  </li>`;
}

function renderPersona(
  persona: PersonaDelCambio,
  tono: "alta" | "baja",
  fechas: readonly FechaDelCambio[],
): Html {
  const efectivo: Tono = persona.soloAviso ? "aviso" : tono;
  const adscripcion =
    persona.adscripcion.length === 0
      ? []
      : [
          html`<span class="diff-dato diff-dato-${efectivo}"
            >${persona.adscripcion.join(" · ")}</span
          >`,
        ];
  const nota = persona.nota
    ? [
        html`<span class="diff-nota"
          >${persona.nota}${
            persona.fechaDeBaja ? ` · baja del ${fechaCorta(persona.fechaDeBaja)}` : ""
          }</span
        >`,
      ]
    : [];
  return renderFila(efectivo, persona.nomina, persona.nombre, [
    ...nota,
    ...adscripcion,
    ...fechas.map(renderFecha),
  ]);
}

interface CambiosDeUnaPersona {
  readonly nombre: string;
  readonly datos: MovimientoDelCambio[];
  readonly fechas: FechaDelCambio[];
}

function agruparPorPersona(detalle: DetalleDeCambios): Map<string, CambiosDeUnaPersona> {
  const yaListadas = new Set([
    ...detalle.altas.map((persona) => persona.nomina),
    ...detalle.bajas.map((persona) => persona.nomina),
  ]);
  const grupos = new Map<string, CambiosDeUnaPersona>();
  const grupo = (nomina: string, nombre: string): CambiosDeUnaPersona => {
    let encontrado = grupos.get(nomina);
    if (!encontrado) {
      encontrado = { nombre, datos: [], fechas: [] };
      grupos.set(nomina, encontrado);
    }
    return encontrado;
  };
  for (const movimiento of detalle.movimientos) {
    if (!yaListadas.has(movimiento.nomina))
      grupo(movimiento.nomina, movimiento.nombre).datos.push(movimiento);
  }
  for (const fecha of detalle.fechas) {
    if (!yaListadas.has(fecha.nomina)) grupo(fecha.nomina, fecha.nombre).fechas.push(fecha);
  }
  return grupos;
}

export function personasConCambios(detalle: DetalleDeCambios): number {
  return agruparPorPersona(detalle).size;
}

function renderBloque(
  titulo: string,
  tono: Tono,
  filas: readonly Html[],
  pie: Html | string = "",
): Html | string {
  if (filas.length === 0) return "";
  return html`<details class="diff-bloque" open>
    <summary>
      <span class="diff-bloque-signo diff-bloque-signo-${tono}" aria-hidden="true"
        >${SIGNO[tono]}</span
      >
      ${titulo}
      <span class="diff-bloque-cuenta">${filas.length}</span>
    </summary>
    <ul class="diff-lista">
      ${filas}
    </ul>
    ${pie}
  </details>`;
}

function renderBloques(
  input: { readonly rotuloAltas: string; readonly rotuloBajas: string },
  detalle: DetalleDeCambios,
): Html {
  const fechasDe = (nomina: string): FechaDelCambio[] =>
    detalle.fechas.filter((fecha) => fecha.nomina === nomina);
  const grupos = agruparPorPersona(detalle);
  return html`${renderBloque(
    input.rotuloAltas,
    "alta",
    detalle.altas.map((persona) => renderPersona(persona, "alta", fechasDe(persona.nomina))),
  )}
  ${renderBloque(
    input.rotuloBajas,
    "baja",
    detalle.bajas.map((persona) => renderPersona(persona, "baja", [])),
  )}
  ${renderBloque(
    "Cambian",
    "cambio",
    [...grupos].map(([nomina, grupo]) =>
      renderFila(
        grupo.fechas.length === 0 && grupo.datos.every((dato) => dato.soloAviso)
          ? "aviso"
          : "cambio",
        nomina,
        grupo.nombre,
        [...grupo.datos.map(renderDato), ...grupo.fechas.map(renderFecha)],
      ),
    ),
    detalle.fechasOmitidas > 0
      ? html`<p class="diff-pie">Y ${detalle.fechasOmitidas} fechas más.</p>`
      : "",
  )}`;
}

export function renderPanelDeCambios(input: {
  readonly titulo: string;
  readonly cifras: readonly CifraDelPanel[];
  readonly detalle: DetalleDeCambios | undefined;
  readonly rotuloAltas: string;
  readonly rotuloBajas: string;
  readonly pie?: Html;
}): Html {
  const { detalle } = input;
  const cifras = input.cifras.filter((cifra) => cifra.valor > 0);
  return html`<section class="panel-cambios">
    <h2 class="panel-cambios-titulo">${input.titulo}</h2>
    ${
      cifras.length === 0
        ? html`<p class="panel-cambios-vacio">
            <span class="panel-cambios-palomita" aria-hidden="true">✓</span> Sin cambios
          </p>`
        : html`<div class="panel-cambios-cifras">${cifras.map(renderCifra)}</div>`
    }
    ${detalle ? renderBloques(input, detalle) : ""} ${input.pie ?? ""}
  </section>`;
}
