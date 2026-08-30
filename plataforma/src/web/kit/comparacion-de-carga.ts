/**
 * El aviso de «con qué se está comparando esto».
 *
 * Vive fuera de las dos pantallas porque las dos lo necesitan idéntico: la
 * revisión de la matriz y la del padrón responden la misma pregunta y separarlas
 * garantizaría que con el tiempo dijeran cosas distintas del mismo hecho.
 *
 * El problema que resuelve es concreto. Comparar una revisión contra el estado
 * de la base y contra nada más hace que volver a subir el archivo de la semana
 * pasada se vea igual que subir uno nuevo que no cambia nada: los dos dirían
 * «sin cambios». Son situaciones opuestas —una es trabajo hecho, la otra es un
 * archivo equivocado— y se distinguen por la huella, que identifica al
 * contenido y no al nombre.
 *
 * Los tres casos que importan, y por qué cada uno se dice distinto:
 *
 * - Mismo archivo. Es el libro que ya se aplicó, byte por byte. Aplicarlo
 *   otra vez no puede cambiar nada y no es un fallo.
 * - Cambió el nombre. La matriz lleva la fecha en el nombre y cambia a
 *   propósito cada semana, así que esto es normal; se enseña porque es lo
 *   primero que hay que mirar cuando alguien barrió una copia vieja o el libro
 *   se movió de carpeta.
 * - Hace mucho. Un padrón es semanal: si la última carga tiene tres semanas,
 *   la cifra de «sin cambios» probablemente signifique que se está barriendo el
 *   archivo de siempre y no que nadie se haya movido de puesto.
 */

import type { ComparacionConLaAnterior } from "../../domain/cargas/tipos.ts";
import { html, type Html } from "./html.ts";

/**
 * A partir de cuántos días se comenta la antigüedad.
 *
 * Catorce y no siete: el padrón es semanal y la matriz no tiene periodicidad
 * fija, así que una carga de ocho días es rutina. Dos semanas ya no lo es.
 */
const DIAS_PARA_COMENTAR = 14;

function fecha(iso: string): string {
  return `${iso.slice(0, 10)} ${iso.slice(11, 16)}`;
}

/** Concuerda el sustantivo con la cifra. */
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
  // `aviso` sólo cuando hay algo que mirar: repetir el archivo aplicado es el
  // único caso en que la revisión puede engañar a quien la lee.
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
