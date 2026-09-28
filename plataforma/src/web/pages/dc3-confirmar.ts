/**
 * La advertencia previa a emitir, como pantalla.
 *
 * Emitir asienta la constancia en la bitácora, y eso no se deshace: el renglón
 * queda marcado como emitido para siempre. Por eso el botón no emite de golpe,
 * pregunta antes.
 *
 * Normalmente la pregunta sale encima de la lista, en un `popover`, sin cambiar
 * de pantalla. Esta página es el respaldo para el navegador que no entiende
 * `popover` y el destino del enlace de «Emitir con recuadros escribibles».
 * Quien dice que no vuelve a la lista tal como la dejó; quien dice que sí,
 * también, con el documento bajando solo.
 *
 * Es una pantalla y no un cuadro de diálogo del navegador porque la consola
 * declara `default-src 'none'` y no corre guiones.
 */
import type { AppConfig } from "../../config/environment.ts";
import { html, type Html } from "../kit/html.ts";
import { renderLayout } from "../layout.ts";
import { renderBarraDeModulo } from "./dc3/kit.ts";

export interface Dc3ConfirmarPageInput {
  readonly config: AppConfig;
  readonly workerNumber: string;
  readonly workerName: string;
  readonly courseName: string;
  /** A dónde va el «sí». Es `POST` porque deja huella en la bitácora. */
  readonly accion: string;
  /** Campos ocultos que el «sí» tiene que llevarse consigo. */
  readonly ocultos: readonly (readonly [string, string])[];
  /** A dónde vuelve el «no»: la lista tal como estaba. */
  readonly regreso: string;
  /** Recuadros que saldrían vacíos. Vacío significa constancia completa. */
  readonly blankFields: readonly string[];
}

export function renderDc3ConfirmarPage(input: Dc3ConfirmarPageInput): string {
  const contenido: Html = html`<section class="tarjeta confirmacion-pagina">
    <h2>¿Emitir y descargar el DC-3?</h2>
    <p>
      Se emitirá la constancia de <strong>${input.workerName}</strong>, nómina
      <span class="celda-mono">${input.workerNumber}</span>, del curso
      <strong>${input.courseName}</strong>.
    </p>

    ${
      input.blankFields.length > 0
        ? html`<p class="aviso">
            Saldrá con estos recuadros en blanco, para llenarse a mano:
            ${input.blankFields.join(", ")}.
          </p>`
        : ""
    }

    <p class="texto-nota">
      Al emitir, el PDF se descarga y la emisión queda registrada con fecha y cuenta; el registro es
      permanente. Cancelar no descarga ni registra nada.
    </p>

    <form method="post" action="${input.accion}" class="acciones-fila">
      ${input.ocultos.map(
        ([nombre, valor]) => html`<input type="hidden" name="${nombre}" value="${valor}" />`,
      )}
      <button type="submit" class="boton-exito">Sí, emitir y descargar</button>
      <a class="boton-pequeno" href="${input.regreso}">No, cancelar</a>
    </form>
  </section>`;

  return renderLayout({
    titulo: "Confirmar emisión",
    rutaActiva: "/dc3/constancia",
    subtitulo: input.workerName,
    entorno: input.config.environment,
    papel: input.config.role,
    modulo: renderBarraDeModulo({ activa: "bandeja" }),
    contenido,
  });
}
