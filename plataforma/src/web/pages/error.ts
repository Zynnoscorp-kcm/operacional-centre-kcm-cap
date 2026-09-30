import type { EnvironmentName } from "../../config/environment.ts";
import { html } from "../kit/html.ts";
import { renderLayout } from "../layout.ts";

export interface DatosPantallaError {
  readonly entorno: EnvironmentName;
  readonly statusCode: number;
  readonly codigo: string;
  readonly mensaje: string;
  readonly requestId: string;
}

export function renderErrorPage(datos: DatosPantallaError): string {
  const contenido = html`
    <section class="tarjeta" aria-labelledby="titulo-error">
      <p class="error-codigo">Error ${datos.statusCode}</p>
      <h2 id="titulo-error">${datos.mensaje}</h2>
      <p>Si el problema continúa, estos datos ayudan a soporte a encontrar lo que pasó.</p>
      <dl class="definiciones">
        <dt>Folio</dt>
        <dd>${datos.requestId}</dd>
        <dt>Código</dt>
        <dd>${datos.codigo}</dd>
      </dl>
      <p><a href="/">Volver al inicio</a></p>
    </section>
  `;

  return renderLayout({
    titulo: "No se pudo completar",
    subtitulo: "La solicitud no llegó a su destino",
    entorno: datos.entorno,
    contenido,
  });
}
