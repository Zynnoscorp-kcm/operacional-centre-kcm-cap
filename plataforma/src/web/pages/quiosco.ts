/**
 * Quiosco de Registro (Función 1).
 *
 * Es una pantalla externa: corre en la computadora de la sala de
 * capacitación, no dentro de la consola. Por eso no lleva rail, ni encabezado
 * de plataforma, ni pie con navegación —no hay a dónde ir desde ahí— y por eso
 * no usa `renderLayout` ni `renderEscena`.
 *
 * El marcado se conserva literal, atributo por
 * atributo: el estilo de esa pantalla vive entero en atributos `style="…"` y en
 * un bloque `<style>` del encabezado, y calcarlo con clases daría un parecido,
 * no una copia. Aquí se copia. Las seis secciones —espera, no disponible,
 * arranque, PIN, lanzador y registro— viajan las seis en la respuesta, ocultas
 * con `hidden`, y el guion alterna entre ellas.
 *
 * Sólo tres cosas cambian respecto del original, y ninguna se ve:
 *
 * 1. El símbolo de marca sale de `/assets`, no de Drive. Es el mismo archivo,
 *    con las mismas medidas, servido desde este árbol para que la pantalla no
 *    dependa de que un tercero siga en línea.
 * 2. El guion se sirve como estático con su hash en vez de ir en línea, porque
 *    su shader GLSL está escrito con plantillas de plantilla.
 * 3. La escena no comparte estilos con el acceso. `.escena-*` de `base.css` se
 *    queda como estaba y sigue siendo de `/acceso`.
 */

import { guionHaces, guionQuiosco, simboloKcm } from "../estaticos.ts";
import { html, rawHtml, renderDocument } from "../kit/html.ts";

export interface KioskPageProps {
  readonly entorno: string;
  readonly sessionCode?: string | undefined;
  readonly trainingName?: string | undefined;
  readonly instructor?: string | undefined;
  readonly isUnlocked?: boolean;
}

/**
 * El bloque `<style>` del encabezado del original, sin una coma de diferencia.
 * Son las animaciones (pulso, sacudón del campo con error, giro del spinner) y
 * los pocos estados que un atributo `style` no puede expresar: `:hover`,
 * `:active`, `[hidden]` y el color de las opciones del desplegable.
 */
const ESTILO_DEL_QUIOSCO = rawHtml(`
    body { margin: 0; background: #060607; color: #f5f6f8; font-family: "IBM Plex Sans", system-ui, -apple-system, sans-serif; overflow-x: hidden; }
    * { box-sizing: border-box; }
    @keyframes kcmPulse { 0%, 100% { opacity: 0.55; } 50% { opacity: 1; } }
    @keyframes kcmShake { 0%, 100% { transform: translateX(0); } 25% { transform: translateX(-8px); } 75% { transform: translateX(8px); } }
    @keyframes spin { to { transform: rotate(360deg); } }
    .input-error {
      border: 1px solid rgba(224, 138, 138, 0.6) !important;
      animation: kcmShake 0.4s ease !important;
    }
    .help.error-text {
      color: #e08a8a !important;
      font-size: 14px !important;
      font-weight: 600 !important;
    }
    #kiosk-close-session-btn:hover {
      background: rgba(63, 120, 180, 0.95) !important;
      border-color: rgba(255, 255, 255, 0.4) !important;
      transform: translateY(-1px);
    }
    #kiosk-close-session-btn:active {
      transform: translateY(0);
    }
    [hidden] { display: none !important; }
    #launcher select option, #launcher option { background: #12161f; color: #f5f6f8; }
    #kiosk-start-btn:hover, #kiosk-unlock-btn:hover { transform: translateY(-1px); }
    #kiosk-code-btn:hover, #kiosk-launch-btn:hover { background: rgba(63, 120, 180, 0.95) !important; }
  `);

/** La familia tipográfica del original, con la misma lista y los mismos pesos. */
const FUENTES =
  "https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600;700" +
  "&family=Montserrat:wght@400;700;900&family=Manrope:wght@400;700" +
  "&family=Poppins:wght@400;700&family=Raleway:wght@700;800&display=swap";

export function renderKioskPage(props: KioskPageProps): string {
  const documento = html`<html lang="es-MX">
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <meta name="referrer" content="no-referrer" />
      <meta name="robots" content="noindex,nofollow,noarchive" />
      <meta name="theme-color" content="#0a0a0c" />
      <title>Registro de capacitación KCM</title>
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
      <link href="${FUENTES}" rel="stylesheet" />
      <link rel="icon" href="${simboloKcm.ruta}" type="${simboloKcm.tipo}" />
      <script src="https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js"></script>
      <style>
        ${ESTILO_DEL_QUIOSCO}
      </style>
    </head>
    <body>
      <div
        style="position:relative;width:100%;min-height:100vh;background:#0a0a0c;overflow:hidden;font-family:'IBM Plex Sans',system-ui,-apple-system,sans-serif;display:flex;align-items:center;justify-content:center;padding:64px 24px"
      >
        <div style="position:absolute;inset:0;background:#000"></div>
        <canvas
          id="beams-canvas"
          aria-hidden="true"
          style="position:absolute;inset:0;width:100%;height:100%;display:block"
        ></canvas>
        <div
          style="position:absolute;inset:0;pointer-events:none;background:radial-gradient(ellipse 1200px 820px at 50% 40%, transparent 42%, rgba(0,0,0,0.5) 100%)"
        >
          <div
            style="position:relative;display:flex;align-items:center;gap:16px;margin-bottom:28px"
          >
            <div style="position:relative;width:64px;height:64px;flex-shrink:0"></div>
            <img
              src="${simboloKcm.ruta}"
              alt="Símbolo Kimberly-Clark"
              style="position: relative; width: 175px; height: 162px; object-fit: contain"
            />
            <div style="text-align: left; line-height: 1.15; width: 100%">
              <div
                style="font-size: 25px; font-weight: 700; color: #f5f6f8; letter-spacing: -0.01em; text-align: left"
              >
                Kimberly-Clark
              </div>
              <div
                style="font-size: 15px; font-weight: 500; color: rgba(235,238,242,0.55); text-align: left"
              >
                de México
              </div>
            </div>
            <div
              style="position: absolute; inset: -20px; border-radius: 50%; background: radial-gradient(circle, rgba(63,109,163,0.45), transparent 70%); filter: blur(6px); left: 26px; top: -4px; width: 297px; height: 185px"
            ></div>
            <button
              id="kiosk-close-session-btn"
              type="button"
              hidden
              aria-label="Cerrar sesión"
              style="box-sizing: border-box; display: inline-flex; align-items: center; justify-content: center; gap: 8px; width: 180px; height: 50px; border-radius: 8px; position: absolute; left: 984px; top: 50px; background: rgba(51, 103, 158, 0.85); color: #ffffff; border: 1px solid rgba(255, 255, 255, 0.25); font-size: 15px; font-weight: 700; font-family: inherit; cursor: pointer; pointer-events: auto; z-index: 50; backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px); box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35); transition: all 0.2s ease;"
            >
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="#ffffff"
                stroke-width="2.2"
                stroke-linecap="round"
                stroke-linejoin="round"
              >
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                <polyline points="16 17 21 12 16 7" />
                <line x1="21" y1="12" x2="9" y2="12" />
              </svg>
              <span>Cerrar sesión</span>
            </button>
          </div>
        </div>

        <div
          style="position:relative;z-index:1;width:100%;max-width:680px;display:flex;flex-direction:column;align-items:center;text-align:center"
        >
          <h1
            style="margin: 0 0 14px; font-size: 50px; line-height: 0.75; font-weight: 900; letter-spacing: 0.2em; -webkit-background-clip: text; background-clip: text; color: #FFFFFF; font-family: Montserrat"
          >
            <span style="font-weight: 700"
              ><b style="font-family: Poppins"
                ><span style="font-weight: normal; font-family: Montserrat"
                  ><b style="font-weight: 400; font-family: Manrope"
                    ><b style="font-family: Montserrat">Registro de capacitación</b></b
                  ></span
                ></b
              ></span
            >
          </h1>

          <div
            style="display:inline-flex;align-items:center;gap:8px;padding:9px 18px;border-radius:999px;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.1);backdrop-filter:blur(8px);margin-bottom:18px"
          >
            <span
              style="width:7px;height:7px;border-radius:50%;background:#5b8dc4;animation:kcmPulse 2.2s ease-in-out infinite"
            ></span>
            <span style="font-size:14px;font-weight:600;color:rgba(240,242,246,0.85)"
              >Sistema de Capacitación KCM</span
            >
            <span style="color:rgba(255,255,255,0.25)">|</span>
            <strong id="session-code" style="color:#ffffff;font-size:13px;font-weight:700"
              >${props.sessionCode ? `Sesión ${props.sessionCode}` : "Sesión KCM"}</strong
            >
            ${
              props.trainingName
                ? html`<span style="color:rgba(255,255,255,0.25)">|</span>
                    <span
                      id="session-training"
                      style="color:rgba(235,238,242,0.75);font-size:12px;font-weight:600"
                      >${props.trainingName}</span
                    >`
                : ""
            }
            <span
              id="station-label"
              hidden
              style="color:rgba(235,238,242,0.6);font-size:12px;font-weight:500"
            ></span>
            <span
              id="session-status"
              class="badge"
              style="border-radius:9999px;background:rgba(91,141,196,0.18);color:#8fb6dd;border:1px solid rgba(91,141,196,0.4);padding:0.15rem 0.5rem;font-size:0.7rem;font-weight:700;letter-spacing:0.06em;text-transform:uppercase"
              >ABIERTA</span
            >
          </div>

          <main
            id="main"
            style="width: 100%; background: rgba(255,255,255,0.045); border: 1px solid rgba(255,255,255,0.09); border-radius: 24px; padding: 36px 32px; backdrop-filter: blur(14px); -webkit-backdrop-filter: blur(14px); box-shadow: 0 30px 60px -20px rgba(0,0,0,0.6); position: relative"
          >
            <section
              id="loading"
              class="loading"
              aria-live="polite"
              style="padding:28px 0;text-align:center"
            >
              <div
                class="spinner"
                aria-hidden="true"
                style="width:36px;height:36px;margin:0 auto 12px;border:3px solid rgba(143,182,221,0.2);border-top-color:#8fb6dd;border-radius:50%;animation:spin 0.75s linear infinite"
              ></div>
              <p style="margin:0;font-size:15px;font-weight:500;color:rgba(226,230,236,0.55)">
                Validando el vínculo…
              </p>
            </section>

            <section
              id="unavailable"
              hidden
              aria-live="assertive"
              style="text-align:center;padding:20px 0"
            >
              <div aria-hidden="true" style="font-size:1.8rem; color:#e08a8a; margin-bottom:6px;">
                ●
              </div>
              <h2 style="margin:0 0 8px;font-size:24px;font-weight:700;color:#f5f6f8">
                Registro no disponible
              </h2>
              <p
                id="unavailable-message"
                style="margin:0;font-size:15px;font-weight:500;color:rgba(226,230,236,0.55)"
              >
                Solicite apoyo a la persona responsable de la capacitación.
              </p>

              <div
                class="quick-open-box"
                id="kiosk-quick-open"
                hidden
                style="margin-top:18px;padding:18px;border-radius:14px;background:rgba(0,0,0,0.4);border:1px solid rgba(255,255,255,0.12)"
              >
                <h3 style="margin:0 0 6px;font-size:1rem;font-weight:700;color:#8fb6dd">
                  Sesión sin abrir
                </h3>
                <p style="margin:0 0 12px;font-size:0.85rem;color:rgba(226,230,236,0.55)">
                  La sesión puede abrirse desde este equipo para recibir registros.
                </p>
                <form id="kiosk-quick-open-form" autocomplete="off">
                  <label
                    for="kiosk-quick-instructor"
                    style="display:block;font-size:14px;font-weight:700;color:rgba(235,238,242,0.85);margin-bottom:8px"
                    >Instructor</label
                  >
                  <input
                    id="kiosk-quick-instructor"
                    type="text"
                    placeholder="Nombre o número"
                    required
                    style="width:100%;padding:12px 16px;border-radius:10px;background:rgba(0,0,0,0.35);border:1px solid rgba(255,255,255,0.14);color:#f5f6f8;font-size:15px;margin-bottom:12px"
                  />
                  <button
                    id="kiosk-quick-open-btn"
                    class="primary"
                    type="submit"
                    style="width:100%;padding:14px;border:none;border-radius:12px;background:#5b8dc4;color:#ffffff;font-size:16px;font-weight:700;cursor:pointer"
                  >
                    Abrir sesión en esta sala
                  </button>
                </form>
              </div>
            </section>

            <section id="boot" hidden style="text-align:center;padding:14px 0">
              <h2 style="margin:0 0 10px;font-size:24px;font-weight:700;color:#f5f6f8">
                Equipo listo
              </h2>
              <p
                style="margin:0 0 26px;font-size:15px;font-weight:500;color:rgba(226,230,236,0.55)"
              >
                La sesión se abre en esta sala para recibir registros de asistencia.
              </p>
              <button
                id="kiosk-start-btn"
                type="button"
                style="width:100%;padding:18px;border:none;border-radius:14px;background:#f5f6f8;color:#0a0a0c;font-size:20px;font-weight:800;font-family:Raleway;cursor:pointer;box-shadow:0 12px 30px -8px rgba(255,255,255,0.15)"
              >
                Abrir sesión
              </button>
              <p
                class="help"
                id="boot-help"
                style="margin:16px 0 0;font-size:14px;font-weight:500;color:rgba(226,230,236,0.45);font-style:italic"
              >
                Requiere el PIN de quiosco del departamento de capacitación.
              </p>
            </section>

            <section id="unlock" hidden>
              <div style="text-align:left;margin-bottom:22px">
                <h2 style="margin:0 0 8px;font-size:24px;font-weight:700;color:#f5f6f8">
                  PIN del quiosco
                </h2>
                <p style="margin:0;font-size:15px;font-weight:500;color:rgba(226,230,236,0.55)">
                  El PIN de sala habilita la apertura de sesiones en este equipo.
                </p>
              </div>
              <form id="kiosk-unlock-form" autocomplete="off" novalidate>
                <label
                  for="kiosk-pin"
                  style="display:block;font-size:18px;font-weight:700;color:rgba(235,238,242,0.85);margin-bottom:10px"
                  >PIN de acceso</label
                >
                <input
                  id="kiosk-pin"
                  name="pin"
                  type="password"
                  inputmode="numeric"
                  pattern="[0-9]{4,12}"
                  minlength="4"
                  maxlength="12"
                  placeholder="••••••"
                  required
                  autocomplete="off"
                  spellcheck="false"
                  aria-describedby="unlock-help"
                  style="width:100%;box-sizing:border-box;padding:18px 20px;border-radius:14px;background:rgba(0,0,0,0.35);color:#f5f6f8;font-size:20px;font-weight:700;letter-spacing:0.35em;font-family:inherit;outline:none;border:1px solid rgba(255,255,255,0.14)"
                />
                <p
                  class="help"
                  id="unlock-help"
                  style="margin:10px 0 0;font-size:14px;font-weight:500;color:rgba(226,230,236,0.55);font-style:italic"
                >
                  Entre cuatro y doce dígitos. No se guarda en este equipo.
                </p>
                <button
                  id="kiosk-unlock-btn"
                  type="submit"
                  style="margin-top:22px;width:100%;padding:18px;border:none;border-radius:14px;background:#f5f6f8;color:#0a0a0c;font-size:20px;font-weight:800;font-family:Raleway;cursor:pointer;box-shadow:0 12px 30px -8px rgba(255,255,255,0.15)"
                >
                  Desbloquear quiosco
                </button>
                <button
                  id="kiosk-unlock-cancel"
                  type="button"
                  style="margin-top:12px;width:100%;padding:14px;border:1px solid rgba(255,255,255,0.2);border-radius:14px;background:rgba(255,255,255,0.08);color:#f5f6f8;font-size:16px;font-weight:700;cursor:pointer"
                >
                  Regresar
                </button>
              </form>
            </section>

            <section id="launcher" hidden>
              <div style="text-align:left;margin-bottom:20px">
                <h2 style="margin:0 0 8px;font-size:24px;font-weight:700;color:#f5f6f8">
                  Iniciar capacitación
                </h2>
                <p style="margin:0;font-size:15px;font-weight:500;color:rgba(226,230,236,0.55)">
                  Use el código emitido por Capacitación o registre los datos del curso.
                </p>
              </div>

              <div
                style="padding:18px;border-radius:14px;background:rgba(0,0,0,0.4);border:1px solid rgba(255,255,255,0.12);margin-bottom:18px"
              >
                <h3 style="margin:0 0 6px;font-size:1rem;font-weight:700;color:#8fb6dd">
                  Código de sesión
                </h3>
                <p style="margin:0 0 12px;font-size:0.85rem;color:rgba(226,230,236,0.55)">
                  Código de sesión (KCM-260727-188AAA) o código de acceso (ABCD-2345).
                </p>
                <form id="kiosk-code-form" autocomplete="off" novalidate>
                  <input
                    id="kiosk-access-code"
                    name="accessCode"
                    type="text"
                    maxlength="25"
                    placeholder="KCM-260727-188AAA"
                    required
                    autocomplete="off"
                    autocapitalize="characters"
                    spellcheck="false"
                    style="width:100%;box-sizing:border-box;padding:14px 18px;border-radius:10px;background:rgba(0,0,0,0.35);border:1px solid rgba(255,255,255,0.14);color:#f5f6f8;font-size:18px;font-weight:700;letter-spacing:0.08em;text-align:center;font-family:inherit;margin-bottom:12px"
                  />
                  <button
                    id="kiosk-code-btn"
                    type="submit"
                    style="width:100%;padding:14px;border:none;border-radius:12px;background:#5b8dc4;color:#ffffff;font-size:16px;font-weight:700;cursor:pointer"
                  >
                    Iniciar con código
                  </button>
                </form>
              </div>

              <div
                style="padding:18px;border-radius:14px;background:rgba(0,0,0,0.4);border:1px solid rgba(255,255,255,0.12)"
              >
                <h3 style="margin:0 0 6px;font-size:1rem;font-weight:700;color:#8fb6dd">
                  Registrar los datos del curso
                </h3>
                <p style="margin:0 0 12px;font-size:0.85rem;color:rgba(226,230,236,0.55)">
                  Sin código, abra la sesión indicando curso, instructor, fecha y duración.
                </p>
                <form id="kiosk-launch-form" autocomplete="off" novalidate>
                  <label
                    for="kiosk-training"
                    style="display:block;font-size:14px;font-weight:700;color:rgba(235,238,242,0.85);margin-bottom:6px"
                    >Curso</label
                  >
                  <select
                    id="kiosk-training"
                    name="trainingId"
                    required
                    style="width:100%;box-sizing:border-box;padding:12px 16px;border-radius:10px;background:rgba(0,0,0,0.35);border:1px solid rgba(255,255,255,0.14);color:#f5f6f8;font-size:15px;font-family:inherit;margin-bottom:12px"
                  ></select>

                  <label
                    for="kiosk-instructor"
                    style="display:block;font-size:14px;font-weight:700;color:rgba(235,238,242,0.85);margin-bottom:6px"
                    >Nombre del instructor</label
                  >
                  <input
                    id="kiosk-instructor"
                    name="instructor"
                    type="text"
                    maxlength="120"
                    placeholder="Nombre del instructor"
                    required
                    autocomplete="off"
                    style="width:100%;box-sizing:border-box;padding:12px 16px;border-radius:10px;background:rgba(0,0,0,0.35);border:1px solid rgba(255,255,255,0.14);color:#f5f6f8;font-size:15px;font-family:inherit;margin-bottom:12px"
                  />

                  <div style="display:flex;gap:12px;margin-bottom:12px">
                    <div style="flex:1;min-width:0">
                      <label
                        for="kiosk-date"
                        style="display:block;font-size:14px;font-weight:700;color:rgba(235,238,242,0.85);margin-bottom:6px"
                        >Fecha</label
                      >
                      <input
                        id="kiosk-date"
                        name="date"
                        type="date"
                        required
                        style="width:100%;box-sizing:border-box;padding:12px 16px;border-radius:10px;background:rgba(0,0,0,0.35);border:1px solid rgba(255,255,255,0.14);color:#f5f6f8;font-size:15px;font-family:inherit"
                      />
                    </div>
                    <div style="flex:1;min-width:0">
                      <label
                        for="kiosk-duration"
                        style="display:block;font-size:14px;font-weight:700;color:rgba(235,238,242,0.85);margin-bottom:6px"
                        >Duración en minutos</label
                      >
                      <input
                        id="kiosk-duration"
                        name="durationMinutes"
                        type="number"
                        min="1"
                        max="1440"
                        value="60"
                        required
                        style="width:100%;box-sizing:border-box;padding:12px 16px;border-radius:10px;background:rgba(0,0,0,0.35);border:1px solid rgba(255,255,255,0.14);color:#f5f6f8;font-size:15px;font-family:inherit"
                      />
                    </div>
                  </div>

                  <label
                    for="kiosk-station"
                    style="display:block;font-size:14px;font-weight:700;color:rgba(235,238,242,0.85);margin-bottom:6px"
                    >Nombre del equipo (opcional)</label
                  >
                  <input
                    id="kiosk-station"
                    name="stationLabel"
                    type="text"
                    maxlength="60"
                    placeholder="Sala A · Equipo 01"
                    autocomplete="off"
                    style="width:100%;box-sizing:border-box;padding:12px 16px;border-radius:10px;background:rgba(0,0,0,0.35);border:1px solid rgba(255,255,255,0.14);color:#f5f6f8;font-size:15px;font-family:inherit;margin-bottom:12px"
                  />

                  <button
                    id="kiosk-launch-btn"
                    type="submit"
                    style="width:100%;padding:14px;border:none;border-radius:12px;background:#5b8dc4;color:#ffffff;font-size:16px;font-weight:700;cursor:pointer"
                  >
                    Abrir sesión en esta sala
                  </button>
                </form>
              </div>

              <p
                class="help"
                id="launcher-message"
                role="status"
                aria-live="polite"
                style="margin:16px 0 0;font-size:14px;font-weight:500;color:rgba(226,230,236,0.55);font-style:italic"
              >
                La sesión abierta aquí queda visible para el departamento de capacitación.
              </p>
              <button
                id="kiosk-launcher-back"
                type="button"
                style="margin-top:14px;width:100%;padding:12px;border:1px solid rgba(255,255,255,0.2);border-radius:12px;background:rgba(255,255,255,0.08);color:#f5f6f8;font-size:15px;font-weight:700;cursor:pointer"
              >
                Regresar
              </button>
            </section>

            <!--
                Confirmación de sesión.

                El código son doce caracteres que se dictan en voz alta, y en un
                día con dos cursos en la misma sala equivocarse de uno no da
                ninguna señal: el quiosco aceptaba el código y pasaba directo a
                registrar. Las asistencias quedaban colgadas del curso ajeno y
                eso no se descubría hasta la liberación. Esta pantalla es la
                única oportunidad de notarlo, así que enseña el nombre del curso
                en grande y obliga a un acto explícito antes de registrar a
                nadie.
              -->
            <section id="confirm" hidden>
              <div style="text-align:left;margin-bottom:20px">
                <h2 style="margin:0 0 8px;font-size:24px;font-weight:700;color:#f5f6f8">
                  Confirmar sesión
                </h2>
                <p style="margin:0;font-size:15px;font-weight:500;color:rgba(226,230,236,0.55)">
                  Verifique los datos antes de iniciar el registro.
                </p>
              </div>

              <div
                style="padding:20px;border-radius:14px;background:rgba(0,0,0,0.4);border:1px solid rgba(143,182,221,0.35);margin-bottom:18px;text-align:left"
              >
                <p
                  id="confirm-training"
                  style="margin:0 0 14px;font-size:21px;font-weight:700;line-height:1.3;color:#f5f6f8"
                >
                  &nbsp;
                </p>
                <dl style="margin:0;display:grid;grid-template-columns:auto 1fr;gap:8px 14px">
                  <dt style="margin:0;font-size:13px;font-weight:700;color:rgba(226,230,236,0.5)">
                    Instructor
                  </dt>
                  <dd
                    id="confirm-instructor"
                    style="margin:0;font-size:15px;font-weight:600;color:#f5f6f8"
                  >
                    &nbsp;
                  </dd>
                  <dt style="margin:0;font-size:13px;font-weight:700;color:rgba(226,230,236,0.5)">
                    Fecha y hora
                  </dt>
                  <dd
                    id="confirm-when"
                    style="margin:0;font-size:15px;font-weight:600;color:#f5f6f8"
                  >
                    &nbsp;
                  </dd>
                  <dt style="margin:0;font-size:13px;font-weight:700;color:rgba(226,230,236,0.5)">
                    Sala
                  </dt>
                  <dd
                    id="confirm-room"
                    style="margin:0;font-size:15px;font-weight:600;color:#f5f6f8"
                  >
                    &nbsp;
                  </dd>
                  <dt style="margin:0;font-size:13px;font-weight:700;color:rgba(226,230,236,0.5)">
                    Código
                  </dt>
                  <dd
                    id="confirm-code"
                    style="margin:0;font-size:15px;font-weight:700;letter-spacing:0.06em;color:#8fb6dd;font-family:ui-monospace,Menlo,Consolas,monospace"
                  >
                    &nbsp;
                  </dd>
                </dl>
                <p
                  id="confirm-warning"
                  hidden
                  style="margin:14px 0 0;padding:10px 12px;border-radius:10px;background:rgba(154,86,0,0.25);border:1px solid rgba(227,171,94,0.45);font-size:14px;font-weight:600;color:#e3ab5e"
                >
                  &nbsp;
                </p>
              </div>

              <button
                id="confirm-start"
                type="button"
                style="width:100%;padding:16px;border:none;border-radius:12px;background:#5b8dc4;color:#ffffff;font-size:17px;font-weight:700;cursor:pointer"
              >
                Iniciar registro
              </button>
              <button
                id="confirm-back"
                type="button"
                style="margin-top:12px;width:100%;padding:12px;border:1px solid rgba(255,255,255,0.2);border-radius:12px;background:rgba(255,255,255,0.08);color:#f5f6f8;font-size:15px;font-weight:700;cursor:pointer"
              >
                Regresar
              </button>
            </section>

            <section id="registration" hidden>
              <div style="text-align:left;margin-bottom:26px">
                <h2 style="margin:0 0 8px;font-size:24px;font-weight:700;color:#f5f6f8">
                  Registro de asistencia
                </h2>
                <p style="margin: 0; font-size: 15px; font-weight: 500; color: #FFFFFF">
                  El número de trabajador son cinco dígitos.
                </p>
                <!--
                    El curso queda a la vista mientras dura el registro. Antes la
                    única referencia era el código del encabezado, que nadie
                    reconoce: si el quiosco quedó en la sesión equivocada, esto
                    lo delata aunque la confirmación se haya aceptado de prisa.
                  -->
                <p
                  id="registration-training"
                  style="margin:12px 0 0;padding:8px 12px;border-radius:10px;background:rgba(91,141,196,0.16);border:1px solid rgba(91,141,196,0.35);font-size:14px;font-weight:700;color:#8fb6dd"
                  hidden
                ></p>
              </div>

              <form id="registration-form" autocomplete="off" novalidate>
                <div style="text-align:left;margin-bottom:8px">
                  <label
                    for="employee-id"
                    style="display: block; font-size: 20px; font-weight: 700; color: rgba(235,238,242,0.85); margin-bottom: 10px; font-family: Arial"
                    >Número de trabajador</label
                  >
                  <input
                    id="employee-id"
                    name="employeeId"
                    type="text"
                    inputmode="numeric"
                    pattern="[0-9]{5}"
                    minlength="5"
                    maxlength="5"
                    placeholder="00000"
                    autofocus
                    required
                    autocomplete="off"
                    autocapitalize="off"
                    spellcheck="false"
                    aria-describedby="employee-help"
                    style="width: 100%; box-sizing: border-box; padding: 18px 20px; border-radius: 14px; background: rgba(0,0,0,0.35); color: #f5f6f8; font-size: 20px; font-weight: 700; letter-spacing: 0.08em; font-family: inherit; outline: none; border: 1px solid rgba(255, 255, 255, 0.14);"
                  />
                </div>

                <p
                  class="help"
                  id="employee-help"
                  style="margin: 10px 0 0; font-size: 15px; font-weight: 500; color: #FFFFFF; font-style: italic"
                >
                  Incluya los ceros iniciales, sin espacios ni guiones.
                </p>

                <button
                  id="register-button"
                  type="submit"
                  style="margin-top: 22px; width: 100%; padding: 18px; border: none; border-radius: 14px; background: #f5f6f8; color: #0a0a0c; font-size: 20px; font-weight: 800; font-family: Raleway; cursor: pointer; box-shadow: 0 12px 30px -8px rgba(255,255,255,0.15); border-style: none"
                >
                  Registrar asistencia
                </button>
              </form>

              <section
                class="message"
                id="result-message"
                role="status"
                aria-live="polite"
                hidden
                style="display:flex;flex-direction:column;align-items:center;padding:28px 0"
              >
                <div
                  style="width:56px;height:56px;border-radius:50%;background:rgba(91,141,196,0.18);border:1px solid rgba(91,141,196,0.4);display:flex;align-items:center;justify-content:center;margin-bottom:18px"
                >
                  <svg width="26" height="26" viewBox="0 0 24 24" fill="none">
                    <path
                      d="M4 12.5L9.5 18L20 6.5"
                      stroke="#8fb6dd"
                      stroke-width="2.5"
                      stroke-linecap="round"
                      stroke-linejoin="round"
                    ></path>
                  </svg>
                </div>
                <div
                  id="result-title"
                  style="font-size:22px;font-weight:700;color:#f5f6f8;margin-bottom:6px"
                >
                  Asistencia registrada
                </div>
                <div
                  id="result-detail"
                  style="font-size:15px;font-weight:500;color:rgba(226,230,236,0.55)"
                >
                  Solicitud recibida; la asistencia se confirmará durante el cotejo físico
                </div>
                <button
                  class="secondary"
                  id="next-person"
                  type="button"
                  hidden
                  style="margin-top: 18px; width: 100%; padding: 14px; border: 1px solid rgba(255,255,255,0.2); border-radius: 14px; background: rgba(255,255,255,0.08); color: #f5f6f8; font-size: 16px; font-weight: 700; cursor: pointer"
                >
                  Registrar a otra persona
                </button>
              </section>
            </section>
          </main>

          <div
            class="availability-box"
            style="display:flex;align-items:center;justify-content:center;gap:6px;margin-top:28px"
          >
            <span
              class="status-dot"
              aria-hidden="true"
              style="width:6px;height:6px;border-radius:50%;background:#5fae7a;flex-shrink:0"
            ></span>
            <p
              class="availability"
              id="availability-message"
              style="margin:0;font-size:13px;font-weight:500;color:rgba(226,230,236,0.55)"
            >
              Disponibilidad: validando…
            </p>
          </div>

          <footer
            style="margin-top:16px;text-align:center;color:rgba(226,230,236,0.4);font-size:12px;font-weight:500"
          >
            <span id="expiration">El vínculo se valida en este equipo.</span>
            <span
              class="preview-note"
              id="preview-note"
              hidden
              style="color:#fde047;font-weight:700"
            >
              · Vista local con datos sintéticos</span
            >
          </footer>
        </div>
      </div>

      <script src="${guionHaces.ruta}"></script>
      <script src="${guionQuiosco.ruta}"></script>
    </body>
  </html>`;

  return renderDocument(documento);
}
