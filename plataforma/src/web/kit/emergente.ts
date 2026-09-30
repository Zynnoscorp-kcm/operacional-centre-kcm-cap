import { html, type Html } from "./html.ts";

export interface OpcionesDeEmergente {
  readonly ancla?: string;
  readonly fijo?: boolean;
  readonly titulo: string;
  readonly cuerpo: Html;
  readonly claseDeCaja?: string;
  readonly anclaDeCierre?: string;
}

function idDelTitulo(opciones: OpcionesDeEmergente): string {
  return `titulo-emergente-${opciones.ancla ?? opciones.anclaDeCierre ?? "fijo"}`;
}

export function renderEmergente(opciones: OpcionesDeEmergente): Html {
  const titulo = idDelTitulo(opciones);
  const caja = opciones.claseDeCaja ? ` ${opciones.claseDeCaja}` : "";

  const emergente = html`<div
    class="emergente${opciones.fijo ? " emergente-fijo" : ""}"
    ${opciones.ancla ? html`id="${opciones.ancla}"` : ""}
    role="dialog"
    aria-modal="true"
    aria-labelledby="${titulo}"
  >
    <div class="emergente-caja${caja}">
      <h2 class="emergente-titulo" id="${titulo}">${opciones.titulo}</h2>
      ${opciones.cuerpo}
    </div>
  </div>`;

  return opciones.anclaDeCierre
    ? html`<span class="ancla-de-cierre" id="${opciones.anclaDeCierre}"></span>${emergente}`
    : emergente;
}
