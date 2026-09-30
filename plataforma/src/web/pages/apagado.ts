import type { AppConfig } from "../../config/environment.ts";
import { renderEmergente } from "../kit/emergente.ts";
import { html, type Html, rawHtml } from "../kit/html.ts";
import { renderLayout } from "../layout.ts";

export interface ApagadoConfirmarInput {
  readonly config: AppConfig;
}

interface DestinosDeLaPregunta {
  readonly accion: string;
  readonly cierre: string;
}

function cuerpoDeLaPregunta(destinos: DestinosDeLaPregunta): Html {
  return html`
    <p class="emergente-texto">Excel dejará de poder mandar el barrido de la matriz y el padrón.</p>
    <form method="post" action="${destinos.accion}" class="emergente-acciones">
      <input type="hidden" name="accion" value="apagar" />
      <button type="submit" class="boton-peligro">Sí, apagar</button>
      <a class="boton-secundario" href="${destinos.cierre}">No</a>
    </form>
  `;
}

export function renderEmergenteDeApagado(): Html {
  return renderEmergente({
    ancla: "apagar",
    titulo: "¿Apagar el servidor local?",
    cuerpo: cuerpoDeLaPregunta({ accion: "/", cierre: "#" }),
  });
}

export function renderApagadoConfirmarPage(input: ApagadoConfirmarInput): string {
  const contenido: Html = renderEmergente({
    fijo: true,
    titulo: "¿Apagar el servidor local?",
    cuerpo: cuerpoDeLaPregunta({ accion: "/apagar", cierre: "/" }),
    claseDeCaja: "energia-confirmacion",
  });

  return renderLayout({
    titulo: "Apagar la plataforma",
    rutaActiva: "/",
    subtitulo: "Sólo afecta a esta computadora",
    entorno: input.config.environment,
    papel: input.config.role,
    contenido,
  });
}

const PALOMITA = rawHtml(
  '<svg class="escena-palomita" viewBox="0 0 24 24" width="46" height="46" fill="none" ' +
    'stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" ' +
    'aria-hidden="true" focusable="false"><path d="M4 12.6 L9.4 18 L20 6.4"/></svg>',
);

const RUEDA = rawHtml(
  '<span class="escena-rueda" aria-hidden="true">' + "<i></i>".repeat(12) + "</span>",
);

export function renderEmergenteDelAcuse(): Html {
  return renderEmergente({
    fijo: true,
    anclaDeCierre: "cerrar-acuse",
    titulo: "Servidor local apagado",
    claseDeCaja: "emergente-acuse",
    cuerpo: html`
      <div class="escena">${RUEDA}${PALOMITA}</div>
      <p class="emergente-acciones escena-accion">
        <a class="boton-kcm" href="#cerrar-acuse">OK</a>
      </p>
    `,
  });
}

export function renderApagadoHechoPage(input: ApagadoConfirmarInput): string {
  const emergente = renderEmergenteDelAcuse();

  const contenido: Html = html`
    ${emergente}
    <section class="tarjeta energia-reposo">
      <h2>Encenderlo de nuevo</h2>
      <p>Se enciende con <strong>Encender KCM</strong>, en el Escritorio.</p>
    </section>
  `;

  return renderLayout({
    titulo: "Servidor local apagado",
    subtitulo: "Esta computadora",
    entorno: input.config.environment,
    papel: input.config.role,
    contenido,
    sinRail: true,
  });
}
