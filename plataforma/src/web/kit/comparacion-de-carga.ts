import type { ComparacionConLaAnterior } from "../../domain/cargas/tipos.ts";
import { momento } from "./fechas.ts";
import { html, type Html } from "./html.ts";

const DIAS_PARA_COMENTAR = 14;

function fecha(iso: string): string {
  return momento(iso);
}

function dias(cantidad: number): string {
  if (cantidad === 0) return "hoy mismo";
  return `hace ${String(cantidad)} ${cantidad === 1 ? "día" : "días"}`;
}

export function renderComparacionDeCarga(
  comparacion: ComparacionConLaAnterior | undefined,
): Html | string {
  if (!comparacion) {
    return html`<p class="texto-nota">
      <strong>Sin carga anterior registrada.</strong> Cada carga queda asentada en el
      <a href="/cargas">historial</a>.
    </p>`;
  }

  const { anterior } = comparacion;
  const clase = comparacion.mismoArchivo ? "aviso" : "texto-nota";

  return html`<div class="${clase}">
    <p>
      <strong>Comparación con la carga anterior.</strong> Última aplicada:
      <code>${anterior.archivo}</code> · ${dias(comparacion.diasDesde)}
      (${fecha(anterior.ocurridoEn)}) · ${anterior.actor}.
    </p>
    ${
      comparacion.mismoArchivo
        ? html`<p>
            <strong>Mismo archivo</strong>, con idéntica huella. Aplicarlo de nuevo no produce
            cambios.
          </p>`
        : html`<p>
            Archivo
            distinto${comparacion.cambioDeNombre ? " y con otro nombre" : ", con el mismo nombre"}.
          </p>`
    }
    ${
      comparacion.diasDesde >= DIAS_PARA_COMENTAR && !comparacion.mismoArchivo
        ? html`<p>
            ${String(comparacion.diasDesde)} días desde la última carga: los conteos acumulan todo
            el periodo.
          </p>`
        : ""
    }
  </div>`;
}
