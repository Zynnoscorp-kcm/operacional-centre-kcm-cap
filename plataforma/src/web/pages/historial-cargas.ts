/**
 * Historial de las dos cargas maestras.
 *
 * Responde qué se cargó, cuándo, quién lo hizo y qué cambió en la base. Sin
 * esta pantalla el lote de importación de la matriz no tiene dónde mostrarse y
 * las escrituras del padrón —CURP y fechas de alta de todo el personal— quedan
 * sin un asiento que las explique.
 *
 * Tres decisiones de presentación, y las tres vienen de lo mismo —que esto se
 * mira cuando algo no cuadra, no a diario—:
 *
 * 1. Las dos fuentes van en una sola línea de tiempo. Separarlas en dos
 *    tablas obligaría a cruzarlas con la vista para responder «¿qué pasó esa
 *    semana?», que es justo la pregunta que se hace aquí.
 * 2. Se muestran los cuatro momentos, no sólo el que escribió. Que una carga
 *    se aplicara no dice si alguien la revisó antes; que un barrido se rechazara
 *    por conflictos es exactamente lo que hay que poder encontrar después.
 * 3. El detalle va dentro de `<details>`, que es HTML nativo y no script: la
 *    política de contenido de esta consola prohíbe scripts, así que un
 *    desplegable hecho con JavaScript no abriría nunca.
 *
 * Aquí no aparece el nombre de ninguna persona. Lo único que identifica es el
 * archivo, su huella y quién operó la consola.
 */

import type { EnvironmentName } from "../../config/environment.ts";
import type { CargaRegistrada, HechoDeCarga, TipoDeCarga } from "../../domain/cargas/tipos.ts";
import { html, type Html } from "../kit/html.ts";
import { renderLayout } from "../layout.ts";

export interface DatosDeHistorial {
  readonly entorno: EnvironmentName;
  readonly asientos: readonly CargaRegistrada[];
  /**
   * Sin base la bitácora vive en el proceso y muere con él. Se dice, porque un
   * historial que se vacía solo al reiniciar sería peor que no tenerlo si nadie
   * avisa de que eso pasa.
   */
  readonly enMemoria: boolean;
}

const ROTULO_DE_TIPO: Readonly<Record<TipoDeCarga, string>> = {
  MATRIZ: "Matriz",
  PADRON: "Padrón",
};

const ROTULO_DE_HECHO: Readonly<Record<HechoDeCarga, string>> = {
  ENCARGADA: "Encargada",
  REVISADA: "Revisada",
  APLICADA: "Aplicada",
  RECHAZADA: "Rechazada",
};

/**
 * El tono de cada momento.
 *
 * Aplicada es lo único que escribió, así que va marcada; rechazada es lo único
 * que hay que mirar, así que va en alerta. Encargada y revisada son tránsito y
 * no compiten por la atención.
 */
const TONO_DE_HECHO: Readonly<Record<HechoDeCarga, string>> = {
  ENCARGADA: "insignia",
  REVISADA: "insignia insignia-pendiente",
  APLICADA: "insignia insignia-completado",
  RECHAZADA: "insignia insignia-aviso",
};

/**
 * Cómo se lee cada cifra del resumen.
 *
 * El diccionario vive aquí y no en la base a propósito: los asientos son
 * inmutables por disparador, así que cambiar una etiqueta no puede implicar
 * reescribirlos. Una clave que no esté en esta tabla se muestra tal cual, que es
 * preferible a esconderla.
 */
const ROTULO_DE_CIFRA: Readonly<Record<string, string>> = {
  origen: "Origen",
  hoja: "Hoja leída",
  motivo: "Motivo",
  repetido: "Lote repetido",
  sinCambios: "Sin cambios",
  bloqueado: "Bloqueado",
  importId: "Lote",

  // Matriz
  trabajadoresEnMatriz: "Trabajadores en la matriz",
  columnasEnMatriz: "Columnas de curso",
  fechasNuevas: "Fechas nuevas",
  fechasCorregidas: "Fechas corregidas",
  fechasRetiradas: "Fechas retiradas",
  conflictos: "Conflictos con liberaciones",
  insertadas: "Fechas escritas",
  corregidas: "Fechas corregidas",
  retiradas: "Fechas retiradas",
  reactivadas: "Fechas reactivadas",

  // Padrón
  activosEnArchivo: "Activos en el archivo",
  desconocidos: "Números no registrados en la base",
  ausentes: "Activos ausentes del archivo",
  curpPorEscribir: "CURP por escribir",
  curp: "CURP escritas",
  altasPorCorregir: "Fechas de alta por corregir",
  altas: "Fechas de alta escritas",
  induccionesNuevas: "Inducciones nuevas",
  inducciones: "Inducciones escritas",
  ocupaciones: "Claves de ocupación escritas",
  puestosNuevos: "Puestos fuera del catálogo",
};

/** Instante ISO recortado a lo que se lee de un vistazo: día y hora. */
function momento(iso: string): string {
  return `${iso.slice(0, 10)} ${iso.slice(11, 16)}`;
}

/**
 * La huella, corta.
 *
 * Doce caracteres bastan para distinguir dos libros y para comparar de un
 * vistazo dos cargas; los sesenta y cuatro completos no caben en la fila y nadie
 * los lee enteros. La completa sigue en el asiento.
 */
function huella(sha256: string): string {
  return sha256 === "" ? "—" : sha256.slice(0, 12);
}

function valorLegible(valor: number | string | boolean): string {
  if (typeof valor === "boolean") return valor ? "Sí" : "No";
  return String(valor);
}

/**
 * Lo que cambió, en una línea.
 *
 * De un asiento aplicado interesa el efecto y no el inventario, así que se
 * escogen las cifras con efecto y se omiten las que valen cero: «3 fechas
 * nuevas» se lee; «3 nuevas, 0 corregidas, 0 retiradas, 0 reactivadas» hay que
 * descifrarlo.
 */
function renderEfecto(asiento: CargaRegistrada): Html {
  const conEfecto: string[] = [];
  const cifras =
    asiento.tipo === "MATRIZ"
      ? (["insertadas", "corregidas", "retiradas", "reactivadas", "fechasNuevas"] as const)
      : (["curp", "altas", "inducciones", "ocupaciones"] as const);

  for (const clave of cifras) {
    const valor = asiento.resumen[clave];
    if (typeof valor === "number" && valor > 0) {
      conEfecto.push(`${String(valor)} ${(ROTULO_DE_CIFRA[clave] ?? clave).toLowerCase()}`);
    }
  }

  if (asiento.hecho === "RECHAZADA") {
    const motivo = asiento.resumen["motivo"];
    return html`<span class="texto-atenuado"
      >No se aplicó${typeof motivo === "string" ? ` · ${motivo}` : ""}</span
    >`;
  }
  if (asiento.hecho !== "APLICADA") {
    return html`<span class="texto-atenuado">Sin efecto</span>`;
  }
  if (asiento.resumen["repetido"] === true) {
    return html`<span class="texto-atenuado">Lote ya aplicado</span>`;
  }
  if (conEfecto.length === 0) {
    return html`<span class="texto-atenuado">Aplicada sin cambios</span>`;
  }
  return html`${conEfecto.join(" · ")}`;
}

/** El resumen completo, plegado. Se abre sólo cuando alguien lo pide. */
function renderDetalle(asiento: CargaRegistrada): Html {
  const filas = Object.entries(asiento.resumen);
  if (filas.length === 0) return html`<span class="texto-atenuado">—</span>`;
  return html`<details>
    <summary>Ver el asiento completo</summary>
    <div class="perfil-grilla-detalles">
      ${filas.map(
        ([clave, valor]) =>
          html`<div class="detalle-item detalle-item-menor">
            <span class="detalle-etiqueta">${ROTULO_DE_CIFRA[clave] ?? clave}</span>
            <span class="detalle-valor">${valorLegible(valor)}</span>
          </div>`,
      )}
      <div class="detalle-item detalle-item-menor">
        <span class="detalle-etiqueta">Huella completa</span>
        <span class="detalle-valor celda-mono"
          >${asiento.sha256 === "" ? "—" : asiento.sha256}</span
        >
      </div>
      ${
        asiento.solicitudId === undefined
          ? ""
          : html`<div class="detalle-item detalle-item-menor">
              <span class="detalle-etiqueta">Solicitud</span>
              <span class="detalle-valor celda-mono">${asiento.solicitudId}</span>
            </div>`
      }
    </div>
  </details>`;
}

function renderKpi(etiqueta: string, cifra: number | string, pista: string, tono = ""): Html {
  return html`<div class="kpi${tono === "" ? "" : ` kpi-${tono}`}">
    <span class="kpi-etiqueta">${etiqueta}</span>
    <span class="kpi-dato"><span class="kpi-cifra">${cifra}</span></span>
    <span class="kpi-pista">${pista}</span>
  </div>`;
}

export function renderLoadHistoryPage(datos: DatosDeHistorial): string {
  const aplicadas = datos.asientos.filter((asiento) => asiento.hecho === "APLICADA");
  const rechazadas = datos.asientos.filter((asiento) => asiento.hecho === "RECHAZADA");
  const ultimaMatriz = aplicadas.find((asiento) => asiento.tipo === "MATRIZ");
  const ultimoPadron = aplicadas.find((asiento) => asiento.tipo === "PADRON");

  const contenido = html`<section class="tarjeta">
      <div class="seccion-cabecera">
        <h2>Cargas registradas</h2>
        <p>Un renglón por cada momento de cada carga de matriz y de padrón.</p>
      </div>

      ${
        datos.enMemoria
          ? html`<p class="miga-de-pan">
              Sin base de datos conectada la bitácora vive en el proceso y se pierde al reiniciarlo.
            </p>`
          : html`<p class="miga-de-pan">
              Los asientos viven en <code>kcm.auditoria</code> y no admiten edición ni borrado.
            </p>`
      }

      <div class="kpi-tira">
        ${renderKpi(
          "Última matriz aplicada",
          ultimaMatriz ? momento(ultimaMatriz.ocurridoEn).slice(0, 10) : "—",
          ultimaMatriz ? ultimaMatriz.archivo : "Sin cargas registradas",
          ultimaMatriz ? "ok" : "aviso",
        )}
        ${renderKpi(
          "Último padrón aplicado",
          ultimoPadron ? momento(ultimoPadron.ocurridoEn).slice(0, 10) : "—",
          ultimoPadron ? ultimoPadron.archivo : "Sin cargas registradas",
          ultimoPadron ? "ok" : "aviso",
        )}
        ${renderKpi(
          "Cargas con efecto",
          aplicadas.length,
          "Escribieron en la base",
          aplicadas.length === 0 ? "" : "ok",
        )}
        ${renderKpi(
          "Rechazadas",
          rechazadas.length,
          "Revisión vencida o conflicto con una liberación",
          rechazadas.length === 0 ? "ok" : "alerta",
        )}
      </div>

      <div class="tabla-contenedor">
        <table class="tabla-kcm">
          <thead>
            <tr>
              <th scope="col">Fecha</th>
              <th scope="col">Fuente</th>
              <th scope="col">Momento</th>
              <th scope="col">Archivo</th>
              <th scope="col">Huella</th>
              <th scope="col">Actor</th>
              <th scope="col">Efecto</th>
              <th scope="col">Detalle</th>
            </tr>
          </thead>
          <tbody>
            ${
              datos.asientos.length === 0
                ? html`<tr>
                    <td colspan="8" class="texto-vacio">Sin cargas asentadas.</td>
                  </tr>`
                : datos.asientos.map(
                    (asiento) =>
                      html`<tr>
                        <td class="celda-mono">${momento(asiento.ocurridoEn)}</td>
                        <td>
                          <span class="insignia insignia-curso"
                            >${ROTULO_DE_TIPO[asiento.tipo]}</span
                          >
                        </td>
                        <td>
                          <span class="${TONO_DE_HECHO[asiento.hecho]}"
                            >${ROTULO_DE_HECHO[asiento.hecho]}</span
                          >
                        </td>
                        <td>${asiento.archivo}</td>
                        <td class="celda-mono">${huella(asiento.sha256)}</td>
                        <td>${asiento.actor}</td>
                        <td>${renderEfecto(asiento)}</td>
                        <td>${renderDetalle(asiento)}</td>
                      </tr>`,
                  )
            }
          </tbody>
        </table>
      </div>
    </section>

    <section class="tarjeta">
      <div class="seccion-cabecera">
        <h3>Momentos de una carga</h3>
      </div>
      <dl class="definiciones">
        <dt>Encargada</dt>
        <dd>Barrido solicitado desde la consola, sin archivo todavía.</dd>
        <dt>Revisada</dt>
        <dd>Archivo leído y cuadrado contra la base, sin escribir.</dd>
        <dt>Aplicada</dt>
        <dd>Único momento con efecto en la base.</dd>
        <dt>Rechazada</dt>
        <dd>Revisión vencida o en conflicto con una liberación.</dd>
        <dt>Huella</dt>
        <dd>Identifica el archivo por su contenido, no por su nombre.</dd>
      </dl>
    </section>`;

  return renderLayout({
    titulo: "Historial de cargas",
    subtitulo: "Matriz y padrón · movimientos registrados",
    rutaActiva: "/cargas",
    entorno: datos.entorno,
    contenido,
  });
}
