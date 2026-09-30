import type { AppConfig } from "../../config/environment.ts";
import { html, type Html } from "../kit/html.ts";
import { renderLayout } from "../layout.ts";
import { renderBarraDeModulo } from "./dc3/kit.ts";

export interface Dc3ConfirmarPageInput {
  readonly config: AppConfig;
  readonly workerNumber: string;
  readonly workerName: string;
  readonly courseName: string;
  readonly accion: string;
  readonly ocultos: readonly (readonly [string, string])[];
  readonly regreso: string;
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
