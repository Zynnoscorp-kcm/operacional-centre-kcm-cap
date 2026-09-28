/**
 * Barrido de la matriz: encargo, revisión y acuse.
 *
 * La pantalla es hermana de la del padrón semanal y tiene los mismos tres
 * momentos: el botón que encarga el barrido, la revisión —qué columnas trae
 * el libro, si cuadran con SQL y qué cambiaría— y el acuse de lo aplicado.
 * Entre la revisión y la escritura hay un botón que alguien tiene que apretar.
 *
 * Dos diferencias con el padrón, y las dos vienen del mismo hecho: el archivo no
 * se sube, se lee en la PC donde vive.
 *
 * 1. El botón no ejecuta el barrido, lo encarga. La plataforma no abre
 *    Excel; el libro controlador recoge la orden cuando pregunta.
 * 2. De las dos listas, la de columnas va completa —son las treinta y tantas
 *    de la hoja y el punto es verlas con nombre— y todo lo demás va sólo con lo
 *    que cambió, con doce de muestra y el resto como cifra.
 *
 * Aquí no aparece el nombre de ningún trabajador: quien cambió de puesto se
 * identifica por su número de nómina, que es lo que hace falta para ir a
 * buscarlo en la matriz.
 */

import type { DeploymentRole, EnvironmentName } from "../../config/environment.ts";
import type {
  ColumnaDetectada,
  InformeDeBarrido,
  ResultadoDeBarrido,
} from "../../domain/barrido-matriz/tipos.ts";
import type { ComparacionConLaAnterior } from "../../domain/cargas/tipos.ts";
import { personasConCambios, renderPanelDeCambios } from "../kit/panel-de-cambios.ts";
import { momento } from "../kit/fechas.ts";
import { html, type Html } from "../kit/html.ts";
import { renderLayout } from "../layout.ts";

export interface DatosDeBarrido {
  readonly entorno: EnvironmentName;
  /** Dónde está parada la persona. Decide si se explica dónde mandar el barrido. */
  readonly papel?: DeploymentRole;
  /** Rechazo ya redactado: revisión vencida, conflictos, snapshot inválido. */
  readonly error?: string | undefined;
  /** Revisión pendiente de confirmar. */
  readonly informe?: InformeDeBarrido | undefined;
  /** Acuse de la última aplicación. */
  readonly resultado?: ResultadoDeBarrido | undefined;
  /**
   * Qué libro se aplicó la última vez y en qué se parece a éste. Es lo que
   * distingue «no cambió nada» de «se volvió a barrer el archivo de siempre».
   */
  readonly comparacion?: ComparacionConLaAnterior | undefined;
  /** Sin base la pantalla explica y no ofrece encargar nada. */
  readonly sinBase?: boolean;
}

/**
 * Un mosaico del resumen. Es el mismo componente que usan la consola interna, la
 * auditoría y los tableros de la Función 8: cifra grande, rótulo en versalitas y
 * una pista debajo que dice de qué está hecha la cifra.
 *
 * El tono no es decorativo. Verde es «nada que revisar», ámbar es «mírelo antes
 * de aplicar» y rojo es «esto bloquea». Un número sin tono obliga a recordar
 * cuál de los dieciséis era el preocupante.
 */
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

function hora(iso: string): string {
  return momento(iso);
}

function insigniaDeColumna(columna: ColumnaDetectada): Html {
  if (columna.estado === "NUEVA") {
    return html`<span class="insignia insignia-aviso">Nueva</span>`;
  }
  if (columna.estado === "RENOMBRADA") {
    return html`<span class="insignia insignia-pendiente">Otro nombre</span>`;
  }
  return html`<span class="insignia insignia-completado">Coincide</span>`;
}

/**
 * Los cursos del libro contra los de la base, plegados: casi siempre coinciden
 * todos y la lista es larga. El resumen de la cabecera dice si hay algo que
 * abrir.
 */
function renderColumnas(informe: InformeDeBarrido): Html {
  const c = informe.cuadre;
  const coinciden = c.columnasEnMatriz - c.columnasNuevas - c.columnasRenombradas;
  return html`
    <details class="tarjeta plegable">
      <summary>
        Cursos · ${coinciden}
        coinciden${c.columnasNuevas > 0 ? ` · ${String(c.columnasNuevas)} ${c.columnasNuevas === 1 ? "nuevo" : "nuevos"}` : ""}${
          c.columnasRenombradas > 0 ? ` · ${String(c.columnasRenombradas)} con otro nombre` : ""
        }${c.columnasRetiradas > 0 ? ` · ${String(c.columnasRetiradas)} ya no ${c.columnasRetiradas === 1 ? "viene" : "vienen"}` : ""}
      </summary>
      <div class="tabla-contenedor">
        <table class="tabla-kcm">
          <thead>
            <tr>
              <th scope="col">Col.</th>
              <th scope="col">Curso en la matriz</th>
              <th scope="col">Fechas</th>
              <th scope="col">En la base</th>
            </tr>
          </thead>
          <tbody>
            ${
              informe.columnas.length === 0
                ? html`<tr>
                    <td colspan="4" class="texto-vacio">Sin columnas de curso.</td>
                  </tr>`
                : informe.columnas.map(
                    (columna) => html`
                      <tr>
                        <td class="celda-mono">${columna.columna}</td>
                        <td>
                          <span class="celda-destacada">${columna.nombre}</span>
                          ${
                            columna.nombreEnBase
                              ? html`<br /><span class="texto-atenuado"
                                    >en la base: ${columna.nombreEnBase}</span
                                  >`
                              : ""
                          }
                        </td>
                        <td class="celda-numero">${columna.fechas}</td>
                        <td>${insigniaDeColumna(columna)}</td>
                      </tr>
                    `,
                  )
            }
            ${informe.muestras.columnasRetiradas.map(
              (nombre) => html`
                <tr>
                  <td class="celda-mono">—</td>
                  <td><span class="celda-destacada">${nombre}</span></td>
                  <td class="celda-numero">—</td>
                  <td><span class="diff-dato diff-dato-baja">Ya no viene en la matriz</span></td>
                </tr>
              `,
            )}
          </tbody>
        </table>
      </div>
    </details>
  `;
}

function renderRevision(informe: InformeDeBarrido): Html {
  const c = informe.cuadre;
  // Sin detalle (una revisión guardada antes de 0046) no se sabe quién sigue en
  // el padrón: se cuenta a todos como ausentes, sin anunciar bajas.
  const bajasReales = informe.detalle
    ? informe.detalle.bajas.filter((persona) => persona.soloAviso !== true).length
    : 0;
  return html`
    ${renderPanelDeCambios({
      titulo: `${informe.fuente.nombreArchivo} · ${hora(informe.recibidoEn)}`,
      rotuloAltas: "Entran",
      rotuloBajas: "No vienen en la matriz",
      detalle: informe.detalle,
      cifras: [
        { valor: c.trabajadoresNuevos, rotulo: "entran", tono: "alta" },
        {
          valor: bajasReales,
          rotulo: "se dan de baja",
          tono: "baja",
        },
        {
          valor: c.trabajadoresAusentes - bajasReales,
          rotulo: "no vienen en la matriz",
          tono: "aviso",
        },
        {
          valor: informe.detalle
            ? personasConCambios(informe.detalle)
            : c.cambiosDePuesto + c.cambiosDeArea + c.cambiosDeDepartamento,
          rotulo: "con cambios",
          tono: "cambio",
        },
        { valor: c.fechasNuevas, rotulo: "fechas nuevas", tono: "alta" },
        {
          valor: c.fechasCorregidas + c.fechasReactivadas,
          rotulo: "fechas cambian",
          tono: "cambio",
        },
        { valor: c.fechasRetiradas, rotulo: "fechas se quitan", tono: "baja" },
        { valor: c.columnasNuevas, rotulo: "cursos nuevos", tono: "alta" },
      ],
    })}
    ${
      informe.bloqueado
        ? html`<p class="aviso aviso-error">
            ${c.conflictos} fechas contradicen sesiones ya liberadas. Se corrigen en la matriz y se
            vuelve a enviar.
          </p>`
        : ""
    }
    <div class="acciones-formulario">
      <form method="POST" action="/matriz/aplicar" class="formulario">
        <input type="hidden" name="barridoId" value="${informe.barridoId}" />
        <button type="submit" ${informe.sinCambios || informe.bloqueado ? "disabled" : ""}>
          ${
            informe.bloqueado
              ? "Bloqueado por conflictos"
              : informe.sinCambios
                ? "No hay nada que aplicar"
                : "Aplicar los cambios"
          }
        </button>
      </form>
      <form method="POST" action="/matriz/descartar" class="formulario">
        <button type="submit" class="boton-secundario">Descartar</button>
      </form>
    </div>
    ${renderColumnas(informe)}
  `;
}

function renderResultado(resultado: ResultadoDeBarrido): Html {
  return html`
    <section class="tarjeta">
      <h2>Barrido aplicado</h2>
      <p class="texto-nota">
        ${resultado.informe.fuente.nombreArchivo}, aplicado el ${hora(resultado.aplicadoEn)} por
        ${resultado.aplicadoPor}. Importación <code>${resultado.importId}</code>.
        ${resultado.repetido ? "Matriz ya aplicada con la misma huella: no se escribió nada." : ""}
      </p>
      <div class="kpi-tira">
        ${renderKpi(
          "Fechas escritas",
          resultado.conteos.insertedCount + resultado.conteos.correctedCount,
          `${String(resultado.conteos.insertedCount)} altas · ${String(resultado.conteos.correctedCount)} corregidas`,
          "ok",
        )}
        ${renderKpi(
          "Fechas retiradas",
          resultado.conteos.retiredCount,
          `${String(resultado.conteos.reactivatedCount)} reactivadas. Todo queda en el historial.`,
          resultado.conteos.retiredCount > 0 ? "aviso" : "ok",
        )}
        ${renderKpi(
          "Trabajadores en la matriz",
          resultado.conteos.totalEmployees,
          `${String(resultado.conteos.totalCourses)} capacitaciones y ${String(resultado.conteos.totalCompletions)} fechas leídas del libro`,
        )}
      </div>
    </section>
  `;
}

/**
 * Dónde se manda el barrido completo.
 *
 * Vive aparte y se dibuja en las dos ramas de `renderEncargo` a propósito: el
 * papel es una propiedad del proceso y no de sus conexiones, así que esconderlo
 * detrás de «hay base o no hay base» dejaría a quien abre la pantalla sin base
 * creyendo que el problema es la conexión, cuando además está en la máquina
 * equivocada. Es la misma regla que sigue la carga del padrón.
 */
function avisoDePapel(datos: DatosDeBarrido): Html {
  if (datos.papel !== "nube") return html``;
  return html`<p class="texto-nota">
    Una matriz de más de 3 MB sale de Excel en partes y aquí llega completa.
  </p>`;
}

function renderEncargo(datos: DatosDeBarrido): Html {
  if (datos.sinBase === true) {
    return html`
      <section class="tarjeta">
        <h2>Barrer la matriz</h2>
        <p class="aviso-error" role="alert">
          Sin conexión con la base de datos: no hay contra qué comparar la matriz ni dónde
          aplicarla.
        </p>
        ${avisoDePapel(datos)}
      </section>
    `;
  }

  return html`
    <section class="tarjeta">
      <h2>Barrer la matriz</h2>
      <p class="texto-nota">
        El barrido lee la matriz de capacitación y enseña las diferencias con lo registrado en la
        plataforma. <strong>Leer no cambia nada.</strong>
      </p>

      <p class="texto-nota">
        Se envía desde Excel con <strong>Actualización completa</strong>. La revisión aparece aquí y
        espera aprobación.
      </p>
      ${avisoDePapel(datos)}
    </section>
  `;
}

export function renderMatrixScanPage(datos: DatosDeBarrido): string {
  const contenido = html`
    ${datos.error ? html`<p class="aviso-error" role="alert">${datos.error}</p>` : ""}
    ${datos.resultado ? renderResultado(datos.resultado) : ""}
    ${datos.informe ? renderRevision(datos.informe) : renderEncargo(datos)}
  `;

  return renderLayout({
    titulo: "Barrido de matriz",
    rutaActiva: "/matriz",
    subtitulo: "Lectura de la matriz de capacitación y cuadre con la plataforma",
    entorno: datos.entorno,
    ...(datos.papel ? { papel: datos.papel } : {}),
    contenido,
    ...(datos.informe
      ? { estado: html`<span class="insignia insignia-aviso">Revisión sin aplicar</span>` }
      : {}),
  });
}
