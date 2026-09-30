import { guionAcceso, hojaDeEstilos, simboloKcm } from "../estaticos.ts";
import { html, renderDocument, type Html } from "../kit/html.ts";

export interface AccessPageProps {
  readonly error?: string | undefined;
  readonly destino?: string | undefined;
  readonly accesoAbierto?: boolean | undefined;
}

export function renderAccessPage(props: AccessPageProps): string {
  const claseDeCampo = props.error ? "campo-rechazado" : "";

  const documento = html`<html lang="es-MX" class="tema-plataforma">
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <meta name="referrer" content="no-referrer" />
      <meta name="robots" content="noindex, nofollow, noarchive" />
      <meta name="theme-color" content="#224c9f" />
      <title>Acceso · Plataforma KCM</title>
      <link rel="stylesheet" href="${hojaDeEstilos.ruta}" />
      <link rel="icon" href="${simboloKcm.ruta}" type="${simboloKcm.tipo}" />
    </head>
    <body class="puerta">
      <a class="salto-contenido" href="#contenido">Saltar al contenido</a>

      <div class="puerta-fondo" aria-hidden="true">
        <div class="puerta-fondo-lateral"></div>
        <div class="puerta-fondo-lienzo">
          <div class="puerta-fondo-pieza"></div>
          <div class="puerta-fondo-pieza"></div>
        </div>
      </div>

      <div class="puerta-hojas" id="puerta-hojas">
        <section class="puerta-hoja puerta-marca">
          <span class="puerta-halo" aria-hidden="true"></span>
          <span class="puerta-halo puerta-halo-bajo" aria-hidden="true"></span>
          <div class="puerta-marca-bloque">
            <img
              class="puerta-simbolo"
              src="${simboloKcm.ruta}"
              alt="Símbolo de Kimberly-Clark"
              width="74"
              height="69"
            />
            <span class="puerta-marca-texto">
              <strong>Kimberly-Clark</strong>
              <span>de México</span>
            </span>
          </div>
          <h1 class="puerta-titulo">Plataforma KCM</h1>
          <p class="puerta-lede">Administración de capacitación y DNC.</p>
          <p class="puerta-sello">Ecatepec · hora del centro de México</p>
        </section>

        <section class="puerta-hoja puerta-forma">
          <main class="puerta-tarjeta" id="contenido">
            <h2 class="puerta-titulo-forma">Acceso a la consola</h2>
            <form
              class="puerta-formulario"
              id="puerta-formulario"
              method="POST"
              action="/acceso"
              autocomplete="off"
            >
              ${
                props.destino
                  ? html`<input type="hidden" name="destino" value="${props.destino}" />`
                  : ""
              }

              <label class="puerta-campo" for="acceso-usuario">
                <span>Usuario</span>
                <input
                  id="acceso-usuario"
                  name="usuario"
                  class="${claseDeCampo}"
                  type="text"
                  maxlength="120"
                  placeholder="Nombre0000"
                  autocomplete="username"
                  spellcheck="false"
                  autocapitalize="off"
                  autofocus
                  required
                  aria-describedby="acceso-ayuda"
                />
              </label>

              <label class="puerta-campo" for="acceso-clave">
                <span>Contraseña</span>
                <input
                  id="acceso-clave"
                  name="clave"
                  class="${claseDeCampo}"
                  type="password"
                  maxlength="200"
                  placeholder="••••••••"
                  autocomplete="current-password"
                  spellcheck="false"
                  required
                  aria-describedby="acceso-ayuda"
                />
              </label>

              ${renderAyuda(props.error, props.accesoAbierto ?? false)}

              <button class="boton boton-primario puerta-boton" type="submit">Entrar</button>
            </form>
          </main>
        </section>
      </div>

      <script src="${guionAcceso.ruta}"></script>
    </body>
  </html>`;

  return renderDocument(documento);
}

function renderAyuda(error: string | undefined, accesoAbierto: boolean): Html {
  if (error) {
    return html`<p class="puerta-ayuda puerta-ayuda-error" id="acceso-ayuda" role="alert">
      ${error}
    </p>`;
  }

  return html`<p class="puerta-ayuda" id="acceso-ayuda">
    ${
      accesoAbierto
        ? "Modo de prueba: no se validan credenciales."
        : "Credenciales asignadas por el departamento de capacitación."
    }
  </p>`;
}
