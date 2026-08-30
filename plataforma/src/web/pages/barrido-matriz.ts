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

import type { EnvironmentName } from "../../config/environment.ts";
import type {
  CambioDeAdscripcion,
  ColumnaDetectada,
  InformeDeBarrido,
  OrdenDeBarrido,
  ResultadoDeBarrido,
} from "../../domain/barrido-matriz/tipos.ts";
import type { ComparacionConLaAnterior } from "../../domain/cargas/tipos.ts";
import { renderComparacionDeCarga } from "../kit/comparacion-de-carga.ts";
import { html, type Html } from "../kit/html.ts";
import { renderLayout } from "../layout.ts";

export interface DatosDeBarrido {
  readonly entorno: EnvironmentName;
  /** Rechazo ya redactado: revisión vencida, conflictos, snapshot inválido. */
  readonly error?: string | undefined;
  /** Orden encargada y todavía sin atender. */
  readonly orden?: OrdenDeBarrido | undefined;
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

const ETIQUETA_DE_CAMPO: Readonly<Record<CambioDeAdscripcion["campo"], string>> = {
  PUESTO: "Puesto",
  AREA: "Área",
  DEPARTAMENTO: "Departamento",
};

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

/** Doce números y el resto como cifra. Vacío cuando no hay nada que enseñar. */
function renderMuestraDeNominas(valores: readonly string[], total: number): Html {
  if (total === 0) return html`<span class="texto-atenuado">—</span>`;
  const restantes = total - valores.length;
  return html`<span class="celda-mono">${valores.join(", ")}</span>${
      restantes > 0 ? html` <span class="texto-atenuado">y ${restantes} más</span>` : ""
    }`;
}

/**
 * Una fila de «cuántos y qué significa».
 *
 * Las dos tablas de cambios están hechas así a propósito: la cifra sola obliga a
 * recordar la regla —¿retirar una fecha borra algo?, ¿un ausente se da de baja?—
 * y esa regla es justo lo que hay que tener presente para decidir si se aplica.
 */
function renderFilaDeEfecto(input: {
  readonly concepto: string;
  readonly cuantos: number;
  readonly significa: string;
  readonly muestra?: Html | undefined;
  readonly alerta?: boolean | undefined;
}): Html {
  const destacar = input.alerta === true && input.cuantos > 0;
  return html`<tr>
    <td>${input.concepto}</td>
    <td class="celda-numero ${destacar ? "celda-alerta celda-destacada" : ""}">${input.cuantos}</td>
    <td>${input.muestra ?? html`<span class="texto-atenuado">—</span>`}</td>
    <td class="texto-secundario">${input.significa}</td>
  </tr>`;
}

/** Concuerda el sustantivo con la cifra: «1 columnas nuevas» se lee mal. */
function cuenta(cantidad: number, uno: string, varios: string): string {
  return `${String(cantidad)} ${cantidad === 1 ? uno : varios}`;
}

function hora(iso: string): string {
  // Se muestra tal cual llega. Convertirla aquí exigiría una zona, y la única
  // válida —America/Mexico_City— ya la fija el pie de la plataforma.
  return iso.replace("T", " ").replace(/\.\d+Z$/u, " UTC");
}

/**
 * El veredicto. Son dos frases separadas porque contestan dos preguntas
 * distintas: si el libro cuadra con el catálogo de SQL, y qué escribiría. Un
 * barrido puede cuadrar perfectamente y no tener nada que aplicar, o traer una
 * columna nueva y aun así no mover una sola fecha.
 */
function renderVeredicto(informe: InformeDeBarrido): Html {
  const c = informe.cuadre;
  const desalineadas = c.columnasNuevas + c.columnasRenombradas + c.columnasRetiradas;

  const correspondencia =
    desalineadas === 0
      ? html`<p class="texto-nota">
          <strong>Las columnas cuadran con la base.</strong> Las ${c.columnasEnMatriz} columnas del
          libro corresponden con cursos ya registrados.
        </p>`
      : html`<p class="texto-nota">
          <strong
            >Hay ${cuenta(desalineadas, "una columna", "columnas")} que no
            cuadra${desalineadas === 1 ? "" : "n"} con la base:</strong
          >
          ${cuenta(c.columnasNuevas, "nueva", "nuevas")},
          ${cuenta(c.columnasRenombradas, "con otro nombre", "con otro nombre")} y
          ${cuenta(c.columnasRetiradas, "que la base conoce", "que la base conoce")} y este barrido
          ya no trae. Aplicar da de alta las nuevas; ninguna se elimina.
        </p>`;

  if (informe.bloqueado) {
    return html`${correspondencia}
      <p class="aviso-error" role="alert">
        Este barrido <strong>no puede aplicarse</strong>: contradice
        ${cuenta(c.conflictos, "una fecha", "fechas")} liberadas en sesión. Corrija esas celdas en
        el libro y repita el barrido.
      </p>`;
  }

  const pendiente = informe.sinCambios
    ? html`<p class="texto-nota">
        <strong>Sin cambios que escribir:</strong> trabajadores, columnas y fechas coinciden con la
        matriz.
      </p>`
    : html`<p class="texto-nota">
        <strong>Por escribir:</strong>
        ${cuenta(c.trabajadoresNuevos, "trabajador nuevo", "trabajadores nuevos")},
        ${cuenta(
          c.cambiosDePuesto + c.cambiosDeArea + c.cambiosDeDepartamento,
          "cambio de adscripción",
          "cambios de adscripción",
        )},
        ${cuenta(c.columnasNuevas, "columna nueva", "columnas nuevas")} y
        ${cuenta(c.fechasNuevas, "fecha de capacitación", "fechas de capacitación")}${
          c.fechasCorregidas > 0 ? html`, más ${c.fechasCorregidas} corregidas` : ""
        }${c.fechasRetiradas > 0 ? html` y ${c.fechasRetiradas} retiradas` : ""}.
      </p>`;

  return html`${correspondencia}${pendiente}`;
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
 * Las columnas detectadas, todas. Es la lista que contesta «qué trae el libro»
 * y por eso no se recorta: treinta y tantos renglones caben en una pantalla y
 * el barrido existe, entre otras cosas, para poder leerlos.
 */
function renderColumnas(informe: InformeDeBarrido): Html {
  return html`
    <section class="tarjeta">
      <div class="seccion-cabecera">
        <h2>Columnas detectadas</h2>
        <p class="seccion-subtitulo">
          ${informe.cuadre.columnasEnMatriz} columnas de curso en la hoja
          <code>${informe.fuente.hoja}</code>, contra ${informe.cuadre.columnasEnBase} cursos
          activos en la base.
        </p>
      </div>
      <div class="tabla-contenedor">
        <table class="tabla-kcm">
          <thead>
            <tr>
              <th scope="col">Col.</th>
              <th scope="col">Nombre en la matriz</th>
              <th scope="col">Fechas</th>
              <th scope="col">Estado en la base</th>
            </tr>
          </thead>
          <tbody>
            ${
              informe.columnas.length === 0
                ? html`<tr>
                    <td colspan="4" class="texto-vacio">
                      Sin columnas de curso en el rango declarado.
                    </td>
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
          </tbody>
        </table>
      </div>
      <p class="texto-nota">
        Una columna <strong>nueva</strong> da de alta un curso al aplicar; una con
        <strong>otro nombre</strong> conserva el curso y guarda el nombre anterior como alias.
      </p>
    </section>
  `;
}

/** Los cuatro números que se leen primero, cada uno con de qué está hecho. */
function renderResumen(informe: InformeDeBarrido): Html {
  const c = informe.cuadre;
  const adscripciones = c.cambiosDePuesto + c.cambiosDeArea + c.cambiosDeDepartamento;
  const porEscribir = c.fechasNuevas + c.fechasCorregidas + c.fechasReactivadas;
  const columnasDesalineadas = c.columnasNuevas + c.columnasRenombradas + c.columnasRetiradas;

  return html`<div class="kpi-tira">
    ${renderKpi(
      "Trabajadores en la matriz",
      c.trabajadoresEnMatriz,
      `${String(c.trabajadoresNuevos)} nuevos · ${String(c.trabajadoresAusentes)} que la matriz ya no trae · ${String(adscripciones)} cambios de adscripción`,
      c.trabajadoresNuevos + c.trabajadoresAusentes + adscripciones > 0 ? "aviso" : "ok",
    )}
    ${renderKpi(
      "Columnas de curso",
      c.columnasEnMatriz,
      `${String(c.columnasNuevas)} nuevas · ${String(c.columnasRenombradas)} con otro nombre · ${String(c.columnasRetiradas)} que ya no vienen`,
      columnasDesalineadas > 0 ? "aviso" : "ok",
    )}
    ${renderKpi(
      "Fechas por escribir",
      porEscribir,
      `${String(c.fechasNuevas)} altas · ${String(c.fechasCorregidas)} corregidas · ${String(c.fechasReactivadas)} reactivadas · de ${String(c.fechasEnMatriz)} en el libro`,
    )}
    ${renderKpi(
      "Fechas que se retirarían",
      c.fechasRetiradas,
      c.conflictos > 0
        ? `Quitan información. ${String(c.conflictos)} conflictos con sesiones liberadas bloquean el barrido.`
        : c.fechasRetiradas > 0
          ? "Quitan información. Quedan en el historial y pueden reaparecer."
          : "Sin fechas retiradas ni conflictos.",
      c.conflictos > 0 ? "alerta" : c.fechasRetiradas > 0 ? "aviso" : "ok",
    )}
  </div>`;
}

/**
 * Los cambios, en dos tablas y no en un muro de mosaicos.
 *
 * Antes eran dieciséis fichas seguidas y la lista de números debajo, en prosa.
 * El problema no era el espacio sino que cada cifra exigía recordar su regla:
 * un ausente no se da de baja, una columna que ya no viene no se desactiva, una
 * fecha retirada sí quita información. Esa regla vive ahora en la misma fila que
 * el número, que es donde hace falta al decidir si se aplica.
 */
function renderCambios(informe: InformeDeBarrido): Html {
  const c = informe.cuadre;
  const m = informe.muestras;
  const adscripciones = c.cambiosDePuesto + c.cambiosDeArea + c.cambiosDeDepartamento;

  return html`
    <section class="tarjeta">
      <div class="seccion-cabecera">
        <h2>Cambios contra la matriz anterior</h2>
        <p class="seccion-subtitulo">
          Sólo lo que este barrido movería. Lo que ya coincide no aparece.
        </p>
      </div>

      <h3>Trabajadores y columnas</h3>
      <div class="tabla-contenedor">
        <table class="tabla-kcm">
          <thead>
            <tr>
              <th scope="col">Concepto</th>
              <th scope="col">Cantidad</th>
              <th scope="col">Detalle</th>
              <th scope="col">Efecto al aplicar</th>
            </tr>
          </thead>
          <tbody>
            ${renderFilaDeEfecto({
              concepto: "Trabajadores nuevos",
              cuantos: c.trabajadoresNuevos,
              muestra: renderMuestraDeNominas(m.trabajadoresNuevos, c.trabajadoresNuevos),
              significa: "Se dan de alta en la base con sus datos laborales.",
            })}
            ${renderFilaDeEfecto({
              concepto: "En la base y no en la matriz",
              cuantos: c.trabajadoresAusentes,
              muestra: renderMuestraDeNominas(m.trabajadoresAusentes, c.trabajadoresAusentes),
              significa: "Ninguno: la ausencia en un extracto no es baja laboral.",
              alerta: true,
            })}
            ${renderFilaDeEfecto({
              concepto: "Cambios de adscripción",
              cuantos: adscripciones,
              significa: `Se actualizan puesto, área y departamento. ${String(c.cambiosDePuesto)} de puesto, ${String(c.cambiosDeArea)} de área y ${String(c.cambiosDeDepartamento)} de departamento.`,
            })}
            ${renderFilaDeEfecto({
              concepto: "Columnas nuevas",
              cuantos: c.columnasNuevas,
              muestra: c.columnasNuevas === 0 ? undefined : html`${m.columnasNuevas.join(", ")}`,
              significa: "Cada una da de alta un curso en el catálogo.",
              alerta: true,
            })}
            ${renderFilaDeEfecto({
              concepto: "Columnas con otro nombre",
              cuantos: c.columnasRenombradas,
              significa: "Conservan su curso y guardan el nombre anterior como alias.",
            })}
            ${renderFilaDeEfecto({
              concepto: "Columnas que ya no vienen",
              cuantos: c.columnasRetiradas,
              muestra:
                c.columnasRetiradas === 0 ? undefined : html`${m.columnasRetiradas.join(", ")}`,
              significa: "Ninguno: no se desactivan. Suele ser un rango de cursos recortado.",
              alerta: true,
            })}
          </tbody>
        </table>
      </div>

      ${adscripciones > 0 ? renderAdscripciones(informe, adscripciones) : ""}

      <h3>Fechas de capacitación</h3>
      <div class="tabla-contenedor">
        <table class="tabla-kcm">
          <thead>
            <tr>
              <th scope="col">Concepto</th>
              <th scope="col">Cantidad</th>
              <th scope="col">Detalle</th>
              <th scope="col">Efecto al aplicar</th>
            </tr>
          </thead>
          <tbody>
            ${renderFilaDeEfecto({
              concepto: "Altas",
              cuantos: c.fechasNuevas,
              significa: "Fechas del maestro que la base todavía no tenía.",
            })}
            ${renderFilaDeEfecto({
              concepto: "Corregidas",
              cuantos: c.fechasCorregidas,
              significa:
                "El maestro trae otra fecha para un registro propio. El valor anterior queda en el historial.",
            })}
            ${renderFilaDeEfecto({
              concepto: "Retiradas",
              cuantos: c.fechasRetiradas,
              significa:
                "La celda quedó vacía en el maestro. Queda en el historial y puede reaparecer.",
              alerta: true,
            })}
            ${renderFilaDeEfecto({
              concepto: "Reactivadas",
              cuantos: c.fechasReactivadas,
              significa: "Una fecha retirada antes vuelve a aparecer en el maestro.",
            })}
            ${renderFilaDeEfecto({
              concepto: "Conflictos con liberaciones",
              cuantos: c.conflictos,
              muestra:
                c.conflictos === 0
                  ? undefined
                  : html`${m.conflictos.map((texto) => html`${texto}<br />`)}`,
              significa: "El maestro contradice una sesión liberada. Bloquea el barrido completo.",
              alerta: true,
            })}
            ${renderFilaDeEfecto({
              concepto: "Liberado y aún no en el maestro",
              cuantos: c.pendientesEnMaestro,
              significa: "Liberadas en la plataforma y aún sin escribir en el XLSB. No se retiran.",
            })}
          </tbody>
        </table>
      </div>

      ${
        informe.incidencias.length > 0
          ? html`<p class="texto-nota">
              <strong>Incidencias al leer la hoja:</strong>
              ${informe.incidencias
                .map((incidencia) => `${incidencia.codigo} (${String(incidencia.cuenta)})`)
                .join(" · ")}.
            </p>`
          : ""
      }
    </section>
  `;
}

/** Quién se movió, con nómina y valor antes y después. */
function renderAdscripciones(informe: InformeDeBarrido, total: number): Html {
  const muestra = informe.muestras.cambiosDeAdscripcion;
  const restantes = total - muestra.length;
  return html`
    <div class="tabla-contenedor">
      <table class="tabla-kcm">
        <thead>
          <tr>
            <th scope="col">Nómina</th>
            <th scope="col">Campo</th>
            <th scope="col">Antes</th>
            <th scope="col">Ahora</th>
          </tr>
        </thead>
        <tbody>
          ${muestra.map(
            (cambio) => html`
              <tr>
                <td class="celda-mono">${cambio.numeroTrabajador}</td>
                <td>${ETIQUETA_DE_CAMPO[cambio.campo]}</td>
                <td class="texto-atenuado">${cambio.antes}</td>
                <td class="celda-destacada">${cambio.ahora}</td>
              </tr>
            `,
          )}
        </tbody>
      </table>
    </div>
    ${
      restantes > 0
        ? html`<p class="texto-nota">
            Y ${restantes} cambios de adscripción más. Se muestran doce.
          </p>`
        : ""
    }
  `;
}

function renderRevision(
  informe: InformeDeBarrido,
  comparacion: ComparacionConLaAnterior | undefined,
): Html {
  return html`
    <section class="tarjeta">
      <h2>Revisión de ${informe.fuente.nombreArchivo}</h2>
      <p class="texto-nota">
        Barrido por <code>${informe.fuente.cliente}</code> y recibido el
        ${hora(informe.recibidoEn)}. Huella SHA-256
        <code>${informe.fuente.sha256.slice(0, 16)}…</code>. Sin escrituras en la base.
      </p>

      ${renderComparacionDeCarga(comparacion)} ${renderVeredicto(informe)} ${renderResumen(informe)}

      <form method="POST" action="/matriz/aplicar" class="formulario">
        <input type="hidden" name="barridoId" value="${informe.barridoId}" />
        <button type="submit" ${informe.sinCambios || informe.bloqueado ? "disabled" : ""}>
          ${
            informe.bloqueado
              ? "Bloqueado por conflictos"
              : informe.sinCambios
                ? "No hay nada que aplicar"
                : "Aplicar a la base"
          }
        </button>
      </form>
      <form method="POST" action="/matriz/descartar" class="formulario">
        <button type="submit" class="boton-secundario">Descartar y barrer de nuevo</button>
      </form>
      <p class="texto-nota">
        La revisión caduca a los 30 minutos. Al caducar se repite el barrido.
      </p>
    </section>
    ${renderColumnas(informe)} ${renderCambios(informe)}
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

function renderEncargo(datos: DatosDeBarrido): Html {
  if (datos.sinBase === true) {
    return html`
      <section class="tarjeta">
        <h2>Barrer la matriz</h2>
        <p class="aviso-error" role="alert">
          Sin base de datos conectada no hay contra qué comparar la matriz ni a dónde aplicarla.
        </p>
      </section>
    `;
  }

  return html`
    <section class="tarjeta">
      <h2>Barrer la matriz</h2>
      <p class="texto-nota">
        El barrido lee el XLSB maestro por el puente VBA y devuelve columnas, trabajadores y
        diferencias contra la base. <strong>La lectura no escribe.</strong>
      </p>

      ${
        datos.orden
          ? html`
              <p class="aviso" role="status">
                <strong>Barrido encargado</strong> el ${hora(datos.orden.solicitadaEn)} por
                ${datos.orden.solicitadaPor}. El libro controlador lo recoge en su próxima consulta.
                La orden caduca a los 30 minutos.
              </p>
              <form method="POST" action="/matriz/cancelar" class="formulario">
                <button type="submit" class="boton-secundario">Cancelar encargo</button>
              </form>
            `
          : html`
              <form method="POST" action="/matriz/barrido" class="formulario">
                <button type="submit">Solicitar barrido</button>
              </form>
            `
      }

      <p class="texto-nota">
        El botón encarga el barrido; lo ejecuta el libro controlador en la PC de la matriz. Con la
        vigilancia activa (<code>KcmIniciarVigilancia</code>) esa PC consulta cada pocos minutos;
        sin ella, el barrido corre al pulsar <strong>Barrer matriz</strong> en
        <code>KCM_CONFIG</code>.
      </p>
    </section>
  `;
}

export function renderMatrixScanPage(datos: DatosDeBarrido): string {
  const contenido = html`
    ${datos.error ? html`<p class="aviso-error" role="alert">${datos.error}</p>` : ""}
    ${datos.resultado ? renderResultado(datos.resultado) : ""}
    ${datos.informe ? renderRevision(datos.informe, datos.comparacion) : renderEncargo(datos)}
    ${
      datos.informe
        ? ""
        : html`
            <section class="tarjeta">
              <h2>Barrido y ciclo programado</h2>
              <p class="texto-nota">
                El ciclo programado transmite y aplica la matriz en la misma llamada. El barrido
                separa la lectura de la escritura y muestra la lista antes de aplicar, con el mismo
                motor de reconciliación.
              </p>
            </section>
          `
    }
  `;

  return renderLayout({
    titulo: "Barrido de matriz",
    rutaActiva: "/matriz",
    subtitulo: "Lectura del XLSB maestro y cuadre contra la base",
    entorno: datos.entorno,
    contenido,
    ...(datos.informe
      ? { estado: html`<span class="insignia insignia-aviso">Revisión sin aplicar</span>` }
      : datos.orden
        ? { estado: html`<span class="insignia insignia-pendiente">Barrido encargado</span>` }
        : {}),
  });
}
