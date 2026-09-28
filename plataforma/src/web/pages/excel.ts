/**
 * Pantalla `Conexión Excel`.
 *
 * Es la hoja de configuración de todo lo que ocurre del lado del libro. El
 * puente VBA es el único camino: los complementos de Office no están
 * autorizados en la instalación.
 *
 * El orden de la pantalla corresponde a cómo se instala de verdad:
 *
 * 1. Estado, para saber de un vistazo si hay algo esperando a Excel;
 * 2. Conectar un equipo, que emite la credencial de esa instalación;
 * 3. Qué hace la persona que instala, en pasos numerados y sin jerga.
 *
 * Por qué el secreto se muestra aquí y no en la URL
 *
 * La emisión responde en esta misma página en lugar de redirigir con el secreto
 * en la cadena de consulta. Un secreto no va en una URL: la URL queda en el
 * historial del navegador y en el registro de cualquier intermediario. La regla
 * no admite excepciones cómodas, ni siquiera para algo que dura minutos.
 */

import type { AppConfig } from "../../config/environment.ts";
import { html, type Html } from "../kit/html.ts";
import { renderLayout } from "../layout.ts";

export interface DatosDeExcel {
  readonly config: AppConfig;
  readonly endpoint: string;
  /** Origen público, para dictar la dirección correcta detrás del túnel. */
  readonly origen: string;
  readonly notice?: string;
  readonly error?: string;
  /** Liberaciones efectivas que Excel todavía no escribió. */
  readonly pendientesDeExcel: number;
  /**
   * Acuses efectivos: fechas que Excel confirmó haber escrito.
   *
   * Se enseña esto y no «equipos con credencial» porque el repositorio no sabe
   * enumerar credenciales —`findCredentials` exige un cliente— y un número
   * inventado en una pantalla de estado es peor que un número ausente.
   */
  readonly fechasEscritas: number;
}

export function renderExcelPage(input: DatosDeExcel): string {
  const contenido = html`
    ${input.error ? html`<p class="aviso aviso-error">${input.error}</p>` : ""}
    ${input.notice ? html`<p class="aviso">${input.notice}</p>` : ""}

    <div class="kpi-tira">
      ${renderKpi(
        "Pendientes de escritura",
        input.pendientesDeExcel,
        input.pendientesDeExcel === 0
          ? "Sin pendientes en la matriz."
          : "Se escriben en la próxima actualización.",
        input.pendientesDeExcel === 0 ? "ok" : "aviso",
      )}
      ${renderKpi(
        "Fechas escritas en la matriz",
        input.fechasEscritas,
        "Acuses confirmados por el libro.",
        "neutro",
      )}
    </div>

    <section class="tarjeta">
      <div class="seccion-cabecera">
        <h2>Dirección del puente</h2>
        <p>Se registra en la hoja <code>KCM_CONFIG</code> del libro.</p>
      </div>
      <dl class="definiciones">
        <dt><code>ENDPOINT</code></dt>
        <dd><code>${input.endpoint}</code></dd>
      </dl>
      <p class="texto-nota">
        Los envíos de más de 3 MB salen de Excel en partes y la plataforma los junta.
      </p>
    </section>

    <section class="tarjeta">
      <div class="seccion-cabecera">
        <h2>Instalación en el equipo</h2>
        <p>Una vez por computadora.</p>
      </div>
      ${renderPasos()}
    </section>

    <section class="tarjeta">
      <div class="seccion-cabecera">
        <h2>Conectar un equipo</h2>
        <p>La clave se muestra <strong>una sola vez</strong>. La credencial se puede revocar.</p>
      </div>
      <form method="post" action="/api/excel/credentials" class="formulario">
        <div class="fila-campos">
          <div class="grupo-campo">
            <label for="vba-clientId">Identificador del equipo *</label>
            <input
              type="text"
              id="vba-clientId"
              name="clientId"
              required
              placeholder="KCM-OFFICE-01"
              class="control-formulario"
            />
          </div>
          <div class="grupo-campo">
            <label for="vba-principal">Cuenta *</label>
            <input
              type="text"
              id="vba-principal"
              name="principal"
              required
              class="control-formulario"
            />
          </div>
          <div class="grupo-campo">
            <label for="vba-windowsProfile">Perfil de Windows *</label>
            <input
              type="text"
              id="vba-windowsProfile"
              name="windowsProfile"
              required
              class="control-formulario"
            />
          </div>
          <div class="grupo-campo">
            <label for="vba-equipment">Nombre de la computadora *</label>
            <input
              type="text"
              id="vba-equipment"
              name="equipment"
              required
              class="control-formulario"
            />
          </div>
          <div class="grupo-campo">
            <label for="vba-scope">Alcance</label>
            <select id="vba-scope" name="scope" class="control-formulario">
              <option value="PUENTE_VBA">Libro de Excel (lectura y escritura de la matriz)</option>
              <option value="POWER_QUERY_LECTURA">Power Query (sólo lectura)</option>
            </select>
          </div>
          <div class="grupo-campo">
            <label for="vba-resource">Recurso *</label>
            <input
              type="text"
              id="vba-resource"
              name="resource"
              value="bridge"
              required
              class="control-formulario"
            />
          </div>
          <div class="grupo-campo">
            <label for="vba-expiresAt">Vencimiento</label>
            <input
              type="datetime-local"
              id="vba-expiresAt"
              name="expiresAt"
              class="control-formulario"
            />
          </div>
          <div class="grupo-campo grupo-campo-casilla">
            <label class="opcion" for="vba-permanent">
              <input type="checkbox" id="vba-permanent" name="permanent" value="true" />
              Sin vencimiento
            </label>
          </div>
        </div>
        <button type="submit" class="boton-primario">Emitir credencial</button>
      </form>
    </section>
  `;

  return renderLayout({
    titulo: "Conexión Excel",
    rutaActiva: "/excel",
    subtitulo: "Conexión de los libros de Excel y credenciales por equipo",
    entorno: input.config.environment,
    papel: input.config.role,
    contenido,
  });
}

function renderPasos(): Html {
  const pasos = [
    {
      titulo: "Abrir el libro del puente",
      texto: html`Archivo <code>.xlsm</code>. Requiere macros habilitadas.`,
    },
    {
      titulo: "Conectar",
      texto: html`<strong>Conectar este equipo</strong> registra las direcciones y la credencial.`,
    },
    {
      titulo: "Verificar",
      texto: html`<strong>Verificar conexión</strong> revisa la credencial, las rutas y la red.`,
    },
  ];

  return html`<ol class="pasos">
    ${pasos.map(
      (paso, indice) =>
        html`<li class="paso">
          <span class="paso-numero" aria-hidden="true">${indice + 1}</span>
          <div class="paso-cuerpo">
            <h3 class="paso-titulo">${paso.titulo}</h3>
            <p class="paso-texto">${paso.texto}</p>
          </div>
        </li>`,
    )}
  </ol>`;
}

function renderKpi(
  etiqueta: string,
  cifra: number,
  pista: string,
  tono: "neutro" | "ok" | "aviso" | "alerta" = "neutro",
): Html {
  const clase = tono === "neutro" ? "" : ` kpi-${tono}`;
  return html`<div class="kpi${clase}">
    <span class="kpi-etiqueta">${etiqueta}</span>
    <span class="kpi-dato"><span class="kpi-cifra">${cifra}</span></span>
    <p class="kpi-pista">${pista}</p>
  </div>`;
}
