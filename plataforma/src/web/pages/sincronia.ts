/**
 * Sincronía entre la matriz y el padrón.
 *
 * La cuarta pestaña de Cargas contesta una pregunta que las otras tres no
 * contestan. El barrido dice qué cambiaría un libro nuevo; la revisión del
 * padrón, qué escribiría un archivo nuevo; el historial, qué entró. Ninguna dice
 * si lo que **ya está aplicado** sigue diciendo lo mismo en las dos fuentes. Eso
 * se responde aquí, sin subir nada: los dos lados ya viven en la base.
 *
 * La pantalla enseña cifras y nada más. No lleva glosa, ni pie explicativo, ni
 * columna de «qué significa»: quien la abre sabe qué son la matriz y el padrón,
 * y una tabla de siete renglones no necesita que se la narren al lado. Lo que
 * antes decían esas leyendas está donde corresponde —en estos comentarios, que
 * los lee quien mantiene el código, no quien opera la consola—.
 *
 * Aquí no aparece el nombre de ninguna persona. Cuando el nombre completo
 * discrepa se enseña el número de nómina y nada más, y los dos valores llegan
 * enmascarados desde la consulta: la regla es la misma del barrido y del
 * historial, y se cumple en la base para que no dependa de esta plantilla.
 */

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
  /** Ausente con las dos causas de abajo: sin base, o sin matriz guardada. */
  readonly informe?: InformeDeSincronia | undefined;
  /** Cuándo se aplicó el último padrón. Ausente si nunca se ha aplicado uno. */
  readonly padronAplicadoEn?: string | undefined;
  /** Sin base no hay ni matriz ni padrón que cotejar. */
  readonly sinBase?: boolean;
  /** Rechazo ya redactado. */
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

/**
 * Un decimal, y sólo cuando hace falta.
 *
 * Los dos extremos están acotados a mano y no por redondeo. Con 16 839
 * coincidencias de 16 840, el redondeo a un decimal imprime `100.0 %` teniendo
 * una diferencia viva, que es exactamente el error que esta pantalla existe para
 * no cometer; en el otro extremo, una sola coincidencia entre miles se
 * redondearía a `0.0 %` y se leería como que no hay ninguna. Así que `100 %` y
 * `0 %` sólo se imprimen cuando la proporción es exacta, y todo lo demás se
 * queda del lado honesto del tope.
 */
function porcentaje(proporcion: number): string {
  if (proporcion >= 1) return "100 %";
  if (proporcion <= 0) return "0 %";
  const valor = Math.min(Math.max(proporcion * 100, 0.1), 99.9);
  return `${Number.isInteger(valor) ? valor.toFixed(0) : valor.toFixed(1)} %`;
}

function hora(iso: string): string {
  return momento(iso);
}

/** Cifra y rótulo. Sin pista debajo: la cifra se explica sola en esta tabla. */
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

/** Doce números y el resto como cifra. */
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

/** De qué matriz y de qué padrón se está hablando. Sin esto no es reproducible. */
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

/** Quién está en cada lado. Las dos ausencias se cuentan por separado. */
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

/**
 * La tabla de los siete campos. Las cinco columnas de conteo son la partición
 * completa de los comparados: sumadas dan el total, de modo que la tabla se
 * verifica sola sin que haya que decirlo en un pie.
 */
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

/** Los casos concretos de un campo, hasta doce. Sólo para lo que no cuadra. */
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

  // Los dos estados vacíos conservan una frase, y sólo una: sin ella la pantalla
  // quedaría en blanco y el blanco se lee como «cuadra todo», que es justo lo
  // contrario de lo que pasa cuando no hay nada que cotejar.
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
