/**
 * Acceso a la plataforma central.
 *
 * Dos hojas que cubren la pantalla: la izquierda azul con la marca en blanco, la
 * derecha blanca con las credenciales. Al entrar, las dos se corren hacia sus
 * orillas y dejan ver la consola. La puerta es del mismo material que lo que
 * abre —mismo azul, mismas tarjetas blancas, misma hoja de estilos—, que es lo
 * que antes no pasaba: era la pantalla del quiosco de sala, con su negro, sus
 * haces de WebGL y sus tipografías de Google, copiada atributo por atributo.
 *
 * De ahí salieron tres cosas al rediseñarla: el bloque `<style>` en línea, las
 * fuentes de un origen externo y `three.min.js` desde un CDN. Lo único que carga
 * ahora es la hoja de la consola y un guion propio de sesenta líneas servido
 * desde `/assets`, así que la política puede volver a ser `'self'` y nada más.
 *
 * Detrás hay un directorio real —`kcm.credencial_consola`, migración 0038— con
 * una cuenta por persona y la contraseña sólo como derivación scrypt. Lo que
 * sigue sin cambiar es que entrar no cierra ninguna pantalla: la consola
 * responde igual con sesión y sin ella.
 */

import { guionAcceso, hojaDeEstilos, simboloKcm } from "../estaticos.ts";
import { html, renderDocument, type Html } from "../kit/html.ts";

export interface AccessPageProps {
  /**
   * Motivo del rechazo anterior, ya redactado para mostrarse. Nunca dice si lo
   * que falló fue el usuario o la contraseña: eso confirmaría cuentas.
   */
  readonly error?: string | undefined;
  /** A dónde volver una vez dentro. Se valida en la ruta, no aquí. */
  readonly destino?: string | undefined;
  /**
   * Corrida con el acceso abierto. La pantalla lo dice en voz alta: una puerta
   * que no comprueba nada y no lo advierte es peor que no tener puerta.
   */
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

      <!-- La silueta de la consola. No es la consola: son cuatro rectángulos
           con la geometría del armazón, que es lo que la puerta descubre. -->
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
          <p class="puerta-sello">Ecatepec · America/Mexico_City</p>
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

/**
 * Un solo renglón de ayuda: gris cuando informa, rojo y en negrita cuando el
 * intento anterior falló. Es único porque los dos campos lo referencian con
 * `aria-describedby`, y el rechazo nunca dice cuál de los dos falló.
 */
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
