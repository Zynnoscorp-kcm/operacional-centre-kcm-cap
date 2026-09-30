import type { EnvironmentName } from "../../config/environment.ts";
import {
  NOMBRE_DE_CAMPO,
  type CampoDelInforme,
  type InformeDeSincronia,
  type VeredictoDeSincronia,
} from "../../domain/sincronia/tipos.ts";
import type { MuestraDeCotejo } from "../../ports/sincronia.port.ts";
import { momento } from "../kit/fechas.ts";
import { html, type Html } from "../kit/html.ts";
import { renderLayout } from "../layout.ts";

export interface DatosDeSincronia {
  readonly entorno: EnvironmentName;
  readonly informe?: InformeDeSincronia | undefined;
  readonly padronAplicadoEn?: string | undefined;
  readonly sinBase?: boolean;
  readonly error?: string | undefined;
}

const ROTULO_DE_CLASE: Readonly<Record<MuestraDeCotejo["clase"], string>> = {
  IGUAL: "Idéntico",
  EQUIVALENTE: "Misma información",
  DISCREPANTE: "Distinto",
  SOLO_MATRIZ: "Sólo en la matriz",
  SOLO_PADRON: "Sólo en el padrón",
};

const TONO_DE_CLASE: Readonly<Record<MuestraDeCotejo["clase"], string>> = {
  IGUAL: "insignia insignia-completado",
  EQUIVALENTE: "insignia insignia-pendiente",
  DISCREPANTE: "insignia insignia-aviso",
  SOLO_MATRIZ: "insignia insignia-aviso",
  SOLO_PADRON: "insignia insignia-aviso",
};

const INSIGNIA_DE_VEREDICTO: Readonly<Record<VeredictoDeSincronia, Html>> = {
  IDENTICOS: html`<span class="insignia insignia-completado">Sincronizados</span>`,
  EQUIVALENTES: html`<span class="insignia insignia-pendiente">Sin desacuerdos</span>`,
  CON_DISCREPANCIAS: html`<span class="insignia insignia-aviso">Con diferencias</span>`,
};

function porcentaje(proporcion: number): string {
  if (proporcion >= 1) return "100 %";
  if (proporcion <= 0) return "0 %";
  const valor = Math.min(Math.max(proporcion * 100, 0.1), 99.9);
  return `${Number.isInteger(valor) ? valor.toFixed(0) : valor.toFixed(1)} %`;
}

function hora(iso: string): string {
  return momento(iso);
}

function renderKpi(
  etiqueta: string,
  cifra: string,
  tono: "neutro" | "ok" | "aviso" | "alerta" = "neutro",
): Html {
  const clase = tono === "neutro" ? "" : ` kpi-${tono}`;
  return html`<div class="kpi${clase}">
    <span class="kpi-etiqueta">${etiqueta}</span>
    <span class="kpi-dato"><span class="kpi-cifra">${cifra}</span></span>
  </div>`;
}

function renderMuestraDeNominas(valores: readonly string[], total: number): Html {
  if (total === 0) return html`<span class="texto-atenuado">—</span>`;
  const restantes = total - valores.length;
  return html`<span class="celda-mono">${valores.join(", ")}</span>${
      restantes > 0 ? html` <span class="texto-atenuado">+${restantes}</span>` : ""
    }`;
}

function renderResumen(informe: InformeDeSincronia): Html {
  const u = informe.universo;
  const hayDiferencias = informe.diferenciasTotales > 0;

  return html`<div class="kpi-tira">
    ${renderKpi("Similitud", porcentaje(informe.similitudGlobal), hayDiferencias ? "aviso" : "ok")}
    ${renderKpi("En las dos fuentes", String(u.enAmbos))}
    ${renderKpi("Diferencias", String(informe.diferenciasTotales), hayDiferencias ? "alerta" : "ok")}
    ${renderKpi(
      "Misma información",
      String(informe.equivalentesTotales),
      informe.equivalentesTotales > 0 ? "aviso" : "ok",
    )}
  </div>`;
}

function renderFuente(informe: InformeDeSincronia, padronAplicadoEn: string | undefined): Html {
  const f = informe.fuente;
  return html`<section class="tarjeta">
    <div class="seccion-cabecera"><h2>Qué se está comparando</h2></div>
    <div class="tabla-contenedor">
      <table class="tabla-kcm">
        <thead>
          <tr>
            <th scope="col">Lado</th>
            <th scope="col">Origen</th>
            <th scope="col">Hoja</th>
            <th scope="col">Leído</th>
            <th scope="col">Huella</th>
            <th scope="col">Personas</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td><span class="celda-destacada">Matriz</span></td>
            <td><code>${f.archivo}</code></td>
            <td>${f.hoja}</td>
            <td>${hora(f.extraidoEn)}</td>
            <td class="celda-mono">${f.sha256.slice(0, 12)}</td>
            <td class="celda-numero">${f.empleados}</td>
          </tr>
          <tr>
            <td><span class="celda-destacada">Padrón</span></td>
            <td>Estado aplicado en la base</td>
            <td class="texto-atenuado">—</td>
            <td>
              ${
                padronAplicadoEn
                  ? hora(padronAplicadoEn)
                  : html`<span class="texto-atenuado">Sin padrón aplicado</span>`
              }
            </td>
            <td class="texto-atenuado">—</td>
            <td class="celda-numero">${informe.universo.enPadron}</td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>`;
}

function renderUniverso(informe: InformeDeSincronia): Html {
  const u = informe.universo;
  return html`<section class="tarjeta">
    <div class="seccion-cabecera"><h2>Quién está en cada lado</h2></div>
    <div class="tabla-contenedor">
      <table class="tabla-kcm">
        <thead>
          <tr>
            <th scope="col">Situación</th>
            <th scope="col">Cuántos</th>
            <th scope="col">Números de nómina</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>En las dos fuentes</td>
            <td class="celda-numero">${u.enAmbos}</td>
            <td class="texto-atenuado">—</td>
          </tr>
          <tr>
            <td>Sólo en la matriz</td>
            <td class="celda-numero ${u.soloMatriz > 0 ? "celda-alerta celda-destacada" : ""}">
              ${u.soloMatriz}
            </td>
            <td>${renderMuestraDeNominas(u.muestraSoloMatriz, u.soloMatriz)}</td>
          </tr>
          <tr>
            <td>Sólo en el padrón</td>
            <td class="celda-numero">${u.soloPadron}</td>
            <td>${renderMuestraDeNominas(u.muestraSoloPadron, u.soloPadron)}</td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>`;
}

function renderFilaDeCampo(campo: CampoDelInforme): Html {
  return html`<tr>
    <td><span class="celda-destacada">${NOMBRE_DE_CAMPO[campo.campo]}</span></td>
    <td class="celda-numero">${campo.iguales}</td>
    <td class="celda-numero">${campo.equivalentes}</td>
    <td class="celda-numero">${campo.discrepantes}</td>
    <td class="celda-numero">${campo.soloMatriz}</td>
    <td class="celda-numero">${campo.soloPadron}</td>
    <td class="celda-numero ${campo.diferencias > 0 ? "celda-alerta celda-destacada" : ""}">
      ${porcentaje(campo.similitud)}
    </td>
  </tr>`;
}

function renderCampos(informe: InformeDeSincronia): Html {
  return html`<section class="tarjeta">
    <div class="seccion-cabecera"><h2>Campo por campo</h2></div>
    <div class="tabla-contenedor">
      <table class="tabla-kcm">
        <thead>
          <tr>
            <th scope="col">Campo</th>
            <th scope="col">Idénticos</th>
            <th scope="col">Misma información</th>
            <th scope="col">Distintos</th>
            <th scope="col">Sólo en matriz</th>
            <th scope="col">Sólo en padrón</th>
            <th scope="col">Similitud</th>
          </tr>
        </thead>
        <tbody>
          ${informe.campos.map(renderFilaDeCampo)}
        </tbody>
      </table>
    </div>
  </section>`;
}

function renderDetalle(campo: CampoDelInforme): Html {
  const total = campo.diferencias + campo.equivalentes;
  const restantes = total - campo.muestras.length;

  return html`<details>
    <summary>
      ${NOMBRE_DE_CAMPO[campo.campo]} ·
      ${total}${restantes > 0 ? html` (${campo.muestras.length} de ${total})` : ""}
    </summary>
    <div class="tabla-contenedor">
      <table class="tabla-kcm">
        <thead>
          <tr>
            <th scope="col">Nómina</th>
            <th scope="col">Situación</th>
            <th scope="col">En la matriz</th>
            <th scope="col">En el padrón</th>
          </tr>
        </thead>
        <tbody>
          ${campo.muestras.map(
            (muestra) =>
              html`<tr>
                <td class="celda-mono">${muestra.numeroTrabajador}</td>
                <td>
                  <span class="${TONO_DE_CLASE[muestra.clase]}"
                    >${ROTULO_DE_CLASE[muestra.clase]}</span
                  >
                </td>
                <td>
                  ${
                    muestra.enMatriz ??
                    html`<span class="texto-atenuado"
                      >${campo.campo === "nombre" ? "no se muestra" : "sin dato"}</span
                    >`
                  }
                </td>
                <td>
                  ${
                    muestra.enPadron ??
                    html`<span class="texto-atenuado"
                      >${campo.campo === "nombre" ? "no se muestra" : "sin dato"}</span
                    >`
                  }
                </td>
              </tr>`,
          )}
        </tbody>
      </table>
    </div>
  </details>`;
}

function renderDetalles(informe: InformeDeSincronia): Html | string {
  const conAlgoQueVer = informe.campos.filter(
    (campo) => campo.diferencias > 0 || campo.equivalentes > 0,
  );
  if (conAlgoQueVer.length === 0) return "";

  return html`<section class="tarjeta">
    <div class="seccion-cabecera"><h2>Casos</h2></div>
    ${conAlgoQueVer.map(renderDetalle)}
  </section>`;
}

export function renderSyncPage(datos: DatosDeSincronia): string {
  const { informe } = datos;

  const cuerpo = datos.sinBase
    ? html`<section class="tarjeta">
        <div class="seccion-cabecera"><h2>Sin conexión con la base de datos</h2></div>
        <p class="texto-nota">
          El cotejo compara la matriz y el padrón guardados en la base; sin conexión no hay qué
          comparar.
        </p>
      </section>`
    : !informe
      ? html`<section class="tarjeta">
          <div class="seccion-cabecera"><h2>Todavía no hay matriz que cotejar</h2></div>
          <p class="texto-nota">
            La base no conserva copia de la matriz. Se guarda una al recibir un
            <a href="/matriz">barrido</a>.
          </p>
        </section>`
      : html`
          ${renderResumen(informe)} ${renderFuente(informe, datos.padronAplicadoEn)}
          ${renderUniverso(informe)} ${renderCampos(informe)} ${renderDetalles(informe)}
        `;

  return renderLayout({
    titulo: "Sincronía",
    subtitulo: "Matriz contra padrón aplicado",
    entorno: datos.entorno,
    rutaActiva: "/sincronia",
    ...(informe ? { estado: INSIGNIA_DE_VEREDICTO[informe.veredicto] } : {}),
    contenido: html`
      ${datos.error ? html`<p class="aviso-error" role="alert">${datos.error}</p>` : ""} ${cuerpo}
    `,
  });
}
