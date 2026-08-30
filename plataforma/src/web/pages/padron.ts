/**
 * Padrón semanal: subida del `sem NN CAP.xlsx` y ventana de cuadre.
 *
 * La pantalla tiene tres momentos y ninguno se salta: el formulario, la
 * revisión —qué trae el archivo, en qué no cuadra con la base y qué
 * cambiaría— y el acuse de lo aplicado. Leer no escribe; entre la revisión y la
 * escritura hay un botón que alguien tiene que apretar.
 *
 * La ventana de cuadre enseña conteos, nunca el padrón. De cada lista se
 * muestran doce números como muestra y el resto es una cifra: es lo que hace
 * que revisar cueste unos cientos de bytes y no una descarga del padrón entero
 * en cada visita.
 */

import type { EnvironmentName } from "../../config/environment.ts";
import type {
  HojaLeida,
  OrdenDePadron,
  PlanDePadron,
  ResultadoDePadron,
} from "../../domain/padron/tipos.ts";
import type { ComparacionConLaAnterior } from "../../domain/cargas/tipos.ts";
import { renderComparacionDeCarga } from "../kit/comparacion-de-carga.ts";
import { html, type Html } from "../kit/html.ts";
import { renderLayout } from "../layout.ts";

export interface DatosDePadron {
  readonly entorno: EnvironmentName;
  /** Rechazo ya redactado: archivo con otra forma, revisión vencida, etc. */
  readonly error?: string | undefined;
  /** Barrido encargado y todavía sin atender. */
  readonly orden?: OrdenDePadron | undefined;
  /** Revisión pendiente de confirmar. */
  readonly plan?: PlanDePadron | undefined;
  /** Acuse de la última aplicación. */
  readonly resultado?: ResultadoDePadron | undefined;
  /**
   * Qué se cargó la última vez y en qué se parece a esto. `undefined` cuando
   * nunca hubo una carga aplicada, que no es lo mismo que «no cambió nada».
   */
  readonly comparacion?: ComparacionConLaAnterior | undefined;
  /** Sin base conectada la pantalla explica y no ofrece subir nada. */
  readonly sinBase?: boolean;
}

/**
 * Nombre legible de cada campo declarado del contrato. La pantalla enseña el
 * rótulo que el libro trae de verdad al lado de éste, porque son distintos —el
 * archivo dice `FEC ALTA` donde la plataforma dice fecha de alta— y confundirlos
 * es lo que hace parecer que falta una columna que sí está.
 */
const NOMBRE_DE_CAMPO: Readonly<Record<string, string>> = {
  employeeId: "Número de trabajador",
  displayName: "Nombre",
  position: "Puesto",
  curp: "CURP",
  hireDate: "Fecha de alta",
  cnoKey: "Clave de ocupación",
};

function hora(iso: string): string {
  return iso.replace("T", " ").replace(/\.\d+Z$/u, " UTC");
}

/** Concuerda el sustantivo con la cifra: «1 fechas de alta» se lee mal. */
function cuenta(cantidad: number, uno: string, varios: string): string {
  return `${String(cantidad)} ${cantidad === 1 ? uno : varios}`;
}

/**
 * Un mosaico del resumen, el mismo componente que el resto de la consola: cifra
 * grande, rótulo en versalitas y una pista que dice de qué está hecha la cifra.
 * El tono distingue «nada que revisar» de «mírelo antes de aplicar».
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

/** Doce números y el resto como cifra. */
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
 * La cifra sola obliga a recordar la regla —¿un ausente se da de baja?, ¿una
 * inducción divergente se corrige?— y esa regla es justo lo que hay que tener
 * presente al decidir si se aplica. Va en la misma fila que el número.
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

function renderIncidencias(incidencias: Readonly<Record<string, number>>): Html | string {
  const entradas = Object.entries(incidencias);
  if (entradas.length === 0) return "";
  return html`<p class="texto-nota">
    <strong>Incidencias del archivo:</strong>
    ${entradas.map(([nombre, cuenta]) => `${nombre} (${String(cuenta)})`).join(" · ")}.
  </p>`;
}

/**
 * El veredicto de la ventana. Es lo primero que se lee y por eso son dos
 * frases separadas: una contesta si el archivo corresponde con la base, y otra
 * qué falta por escribir. Un archivo puede corresponder perfectamente y no
 * tener nada que aplicar, o traer números desconocidos y aun así aportar CURP.
 */
function renderVeredicto(plan: PlanDePadron): Html {
  const c = plan.cuadre;

  const correspondencia =
    c.desconocidos === 0
      ? html`<p class="texto-nota">
          <strong>El archivo corresponde con la base.</strong> Sus ${c.reconocidos} trabajadores
          existen en la matriz.
        </p>`
      : html`<p class="aviso-error" role="alert">
          El archivo trae
          ${cuenta(c.desconocidos, "un número de trabajador", "números de trabajador")} que la base
          no conoce. Barra la matriz antes de aplicar; de lo contrario quedan fuera de la carga.
        </p>`;

  const pendiente = plan.sinCambios
    ? html`<p class="texto-nota">
        <strong>Sin cambios que escribir:</strong> CURP y fechas de alta coinciden con el archivo.
      </p>`
    : html`<p class="texto-nota">
        <strong>Por escribir:</strong> ${cuenta(c.curpPorEscribir, "CURP", "CURP")},
        ${cuenta(c.altasPorCorregir, "fecha de alta", "fechas de alta")} y
        ${cuenta(c.induccionesNuevas, "registro de inducción", "registros de inducción")}.
      </p>`;

  return html`${correspondencia}${pendiente}`;
}

/**
 * Los encabezados que el extractor resolvió, hoja por hoja.
 *
 * Contesta la pregunta que antes sólo se podía responder abriendo el libro: qué
 * columna se leyó como qué. Un campo opcional ausente sale nombrado en lugar de
 * quedar en silencio; uno obligatorio no puede faltar, porque su ausencia habría
 * detenido la lectura antes de llegar aquí.
 */
function renderColumnas(hojas: readonly HojaLeida[]): Html | string {
  if (hojas.length === 0) return "";
  return html`
    <section class="tarjeta">
      <div class="seccion-cabecera">
        <h2>Columnas detectadas</h2>
        <p class="seccion-subtitulo">
          Qué encabezado del libro se leyó como cada campo declarado, en cada hoja de activos.
        </p>
      </div>
      ${hojas.map(
        (hoja) => html`
          <p class="texto-nota">
            <strong>${hoja.sheetName}</strong>: ${hoja.acceptedRows} trabajadores aceptados de
            ${hoja.rowsWithIdentity} renglones con número.
          </p>
          <div class="tabla-contenedor">
            <table class="tabla-kcm">
              <thead>
                <tr>
                  <th scope="col">Campo</th>
                  <th scope="col">Encabezado en el libro</th>
                  <th scope="col">Col.</th>
                  <th scope="col">Estado</th>
                </tr>
              </thead>
              <tbody>
                ${hoja.columns.map(
                  (columna) => html`
                    <tr>
                      <td>${NOMBRE_DE_CAMPO[columna.field] ?? columna.field}</td>
                      <td>${columna.present ? columna.header : "—"}</td>
                      <td class="celda-mono">${columna.present ? columna.columnName : "—"}</td>
                      <td>
                        ${
                          columna.present
                            ? html`<span class="insignia insignia-completado">Detectada</span>`
                            : html`<span class="insignia insignia-aviso">Ausente (opcional)</span>`
                        }
                      </td>
                    </tr>
                  `,
                )}
              </tbody>
            </table>
          </div>
        `,
      )}
      <p class="texto-nota">
        Los encabezados se comparan normalizados: acentos, puntos y espacios no influyen. Un
        encabezado obligatorio sin resolver <strong>detiene la lectura</strong>.
      </p>
    </section>
  `;
}

/**
 * Lo que el padrón dice y la base no, en los dos campos donde las dos fuentes
 * hablan del mismo dato.
 *
 * Es una pantalla de aviso y no de acción, y el motivo hay que decirlo entero
 * porque de otro modo parece un defecto: el departamento resolvió que la
 * matriz siga mandando en tipo de nómina y planta, porque es la fuente que la
 * plataforma consulta a diario. Pero el padrón es quien origina esa
 * clasificación —viene de Recursos Humanos y separa sindicalizados de confianza
 * por hoja—, así que cuando difieren, alguien tiene que mirarlo. Aplicar la
 * carga no cambia ninguno de los dos campos.
 *
 * La planta merece una nota aparte: en el libro su columna se rotula `AREA`,
 * pero trae tres valores para mil seiscientas filas y son centros de trabajo.
 * El área operativa de la matriz es otra cosa y no se compara con ésta.
 */
function renderDivergencias(plan: PlanDePadron): Html | string {
  const c = plan.cuadre;
  const total = c.nominasDivergentes + c.plantasDivergentes;
  if (total === 0) return "";
  const m = plan.muestras;

  const filas = [
    ...m.nominasDivergentes.map((d) => ({ campo: "Tipo de nómina", ...d })),
    ...m.plantasDivergentes.map((d) => ({ campo: "Planta", ...d })),
  ];
  const restantes = total - filas.length;

  return html`
    <section class="tarjeta">
      <div class="seccion-cabecera">
        <h2>El padrón y la base no coinciden</h2>
        <p class="seccion-subtitulo">
          ${cuenta(c.nominasDivergentes, "trabajador", "trabajadores")} con otro tipo de nómina y
          ${cuenta(c.plantasDivergentes, "trabajador", "trabajadores")} en otra planta.
          <strong>Aplicar no cambia ninguno de los dos.</strong>
        </p>
      </div>
      <p class="texto-nota">
        Ambos campos los escribe la matriz. El padrón registra otro valor para estos trabajadores y
        la carga no elige entre las dos fuentes.
      </p>
      <div class="tabla-contenedor">
        <table class="tabla-kcm">
          <thead>
            <tr>
              <th scope="col">Nómina</th>
              <th scope="col">Campo</th>
              <th scope="col">Dice el padrón</th>
              <th scope="col">Tiene la base</th>
            </tr>
          </thead>
          <tbody>
            ${filas.map(
              (fila) => html`
                <tr>
                  <td class="celda-mono">${fila.numeroTrabajador}</td>
                  <td>${fila.campo}</td>
                  <td>${fila.enPadron}</td>
                  <td class="texto-atenuado">${fila.enBase}</td>
                </tr>
              `,
            )}
          </tbody>
        </table>
      </div>
      ${restantes > 0 ? html`<p class="texto-nota">Y ${restantes} divergencias más.</p>` : ""}
      ${
        c.traeColumnaPlanta
          ? ""
          : html`<p class="texto-nota">
              El libro no trae columna de planta: sólo se comparó el tipo de nómina.
            </p>`
      }
    </section>
  `;
}

/** Quién se movió de puesto, con número y valor antes y después. */
function renderCambiosDePuesto(plan: PlanDePadron): Html | string {
  const total = plan.cuadre.puestosCambiados;
  if (total === 0) return "";
  const muestra = plan.muestras.cambiosDePuesto;
  const restantes = total - muestra.length;
  return html`
    <section class="tarjeta">
      <div class="seccion-cabecera">
        <h2>Cambios de puesto</h2>
        <p class="seccion-subtitulo">
          Informativo: el padrón no reasigna puestos. La ocupación específica del DC-3 depende del
          puesto.
        </p>
      </div>
      <div class="tabla-contenedor">
        <table class="tabla-kcm">
          <thead>
            <tr>
              <th scope="col">Nómina</th>
              <th scope="col">Antes</th>
              <th scope="col">Ahora</th>
              <th scope="col">Catálogo</th>
            </tr>
          </thead>
          <tbody>
            ${muestra.map(
              (cambio) => html`
                <tr>
                  <td class="celda-mono">${cambio.numeroTrabajador}</td>
                  <td class="texto-atenuado">${cambio.antes}</td>
                  <td>${cambio.ahora}</td>
                  <td>
                    ${
                      cambio.fueraDeCatalogo
                        ? html`<span class="insignia insignia-aviso">Fuera del catálogo</span>`
                        : html`<span class="insignia insignia-completado">Declarado</span>`
                    }
                  </td>
                </tr>
              `,
            )}
          </tbody>
        </table>
      </div>
      ${restantes > 0 ? html`<p class="texto-nota">Y ${restantes} cambios de puesto más.</p>` : ""}
    </section>
  `;
}

/** Los cuatro números que se leen primero, cada uno con de qué está hecho. */
function renderResumen(plan: PlanDePadron): Html {
  const c = plan.cuadre;
  const porEscribir =
    c.curpPorEscribir + c.altasPorCorregir + c.induccionesNuevas + c.cnoPorEscribir;
  return html`<div class="kpi-tira">
    ${renderKpi(
      "Activos en el archivo",
      c.activosEnArchivo,
      `${String(c.reconocidos)} reconocidos por la matriz · ${String(c.sinIncidencias)} sin incidencias`,
      c.desconocidos > 0 ? "aviso" : "ok",
    )}
    ${renderKpi(
      "Números que la base no conoce",
      c.desconocidos,
      c.desconocidos > 0
        ? "Quedan fuera de la carga: barra la matriz antes de aplicar"
        : "El archivo corresponde con la matriz",
      c.desconocidos > 0 ? "alerta" : "ok",
    )}
    ${renderKpi(
      "Por escribir",
      porEscribir,
      `${String(c.curpPorEscribir)} CURP · ${String(c.altasPorCorregir)} fechas de alta · ${String(c.induccionesNuevas)} inducciones${c.traeColumnaCno ? ` · ${String(c.cnoPorEscribir)} claves de ocupación` : ""}`,
    )}
    ${renderKpi(
      "Por revisar a mano",
      c.induccionesDivergentes + c.puestosNuevos + c.cnoEnConflicto,
      `${cuenta(c.induccionesDivergentes, "inducción con otra fecha", "inducciones con otra fecha")} · ${cuenta(c.puestosNuevos, "puesto fuera del catálogo", "puestos fuera del catálogo")} · ${cuenta(c.cnoEnConflicto, "adscripción con claves distintas", "adscripciones con claves distintas")}`,
      c.induccionesDivergentes + c.puestosNuevos + c.cnoEnConflicto > 0 ? "aviso" : "ok",
    )}
  </div>`;
}

/**
 * Lo que el archivo mueve, en dos tablas.
 *
 * Antes eran catorce fichas seguidas y cuatro listas en prosa debajo. El
 * problema no era el espacio sino que cada cifra exigía recordar su regla —un
 * ausente no se da de baja, una inducción divergente no se corrige, un puesto no
 * se reasigna— y esa regla es justo la que hay que tener presente al decidir.
 */
function renderCambiosDelPadron(plan: PlanDePadron): Html {
  const c = plan.cuadre;
  const m = plan.muestras;
  return html`
    <section class="tarjeta">
      <div class="seccion-cabecera">
        <h2>Cambios contra el padrón de la base</h2>
        <p class="seccion-subtitulo">
          Sólo lo que este archivo movería. Lo que ya coincide no aparece.
        </p>
      </div>

      <h3>Trabajadores</h3>
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
              concepto: "Reconocidos en la base",
              cuantos: c.reconocidos,
              significa: "Reciben CURP y fecha de alta si el archivo las trae y difieren.",
            })}
            ${renderFilaDeEfecto({
              concepto: "Números que la base no conoce",
              cuantos: c.desconocidos,
              muestra: renderMuestraDeNominas(m.desconocidos, c.desconocidos),
              significa:
                "Ninguno: no existen en la base. Suele indicar una matriz más atrasada que el padrón.",
              alerta: true,
            })}
            ${renderFilaDeEfecto({
              concepto: "En la base y no en el archivo",
              cuantos: c.ausentes,
              muestra: renderMuestraDeNominas(m.ausentes, c.ausentes),
              significa: "Ninguno: las bajas se registran en otras hojas.",
            })}
            ${renderFilaDeEfecto({
              concepto: "Cambios de puesto",
              cuantos: c.puestosCambiados,
              significa: "Informativo: el padrón no reasigna puestos.",
            })}
            ${renderFilaDeEfecto({
              concepto: "Puestos fuera del catálogo",
              cuantos: c.puestosNuevos,
              muestra: c.puestosNuevos === 0 ? undefined : html`${m.puestosNuevos.join(", ")}`,
              significa:
                "No bloquean la carga; sí la emisión del DC-3 hasta asignarles clave de ocupación.",
              alerta: true,
            })}
          </tbody>
        </table>
      </div>

      <h3>Escrituras en la base</h3>
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
              concepto: "CURP",
              cuantos: c.curpPorEscribir,
              significa: "Dato exigido por el DC-3 que la matriz no trae.",
            })}
            ${renderFilaDeEfecto({
              concepto: "Fechas de alta",
              cuantos: c.altasPorCorregir,
              significa: `Se corrigen las que difieren; ${String(c.altasQueCoinciden)} ya coinciden y no se tocan.`,
            })}
            ${renderFilaDeEfecto({
              concepto: "Inducciones nuevas",
              cuantos: c.induccionesNuevas,
              significa:
                "La fecha de alta es la de INDUCCIÓN A LA EMPRESA. Entran con procedencia ROSTER_ALTA.",
            })}
            ${renderFilaDeEfecto({
              concepto: "Inducciones con otra fecha",
              cuantos: c.induccionesDivergentes,
              significa:
                "No se modifican: esa fecha imprime el DC-3 y su corrección es decisión del departamento.",
              alerta: true,
            })}
            ${
              c.traeColumnaCno
                ? html`${renderFilaDeEfecto({
                    concepto: "Claves de ocupación",
                    cuantos: c.cnoPorEscribir,
                    significa: `Se guardan en cada trabajador; ${String(c.cnoQueCoinciden)} ya coinciden. Imprimen la ocupación específica del DC-3.`,
                  })}
                  ${renderFilaDeEfecto({
                    concepto: "Adscripciones con más de una clave",
                    cuantos: c.cnoEnConflicto,
                    muestra:
                      c.cnoEnConflicto === 0
                        ? undefined
                        : html`${m.cnoEnConflicto.map((texto) => html`${texto}<br />`)}`,
                    significa:
                      "Mismo puesto y área con claves distintas. No bloquea la carga; suele indicar un error de captura.",
                    alerta: true,
                  })}`
                : ""
            }
          </tbody>
        </table>
      </div>

      ${
        c.traeColumnaCno
          ? html`<p class="texto-nota">
              La clave de ocupación se guarda en el trabajador, no en el puesto: un mismo puesto en
              dos áreas admite dos claves.
            </p>`
          : html`<p class="texto-nota">
              El libro no trae la columna <code>Clave de ocupación</code>. Sin ella, la ocupación
              específica del DC-3 queda en blanco. Se agrega al final de las dos hojas de activos y
              puede llegar vacía.
            </p>`
      }
      ${renderIncidencias(plan.muestras.incidencias)}
    </section>
  `;
}

function renderRevision(
  plan: PlanDePadron,
  comparacion: ComparacionConLaAnterior | undefined,
): Html {
  return html`
    <section class="tarjeta">
      <h2>Revisión de ${plan.nombreArchivo}</h2>
      <p class="texto-nota">
        ${
          plan.origen.tipo === "PUENTE_VBA"
            ? html`Barrido por <code>${plan.origen.actor}</code> y recibido`
            : html`Subido por ${plan.origen.actor} y leído`
        }
        el ${hora(plan.leidoEn)}. Huella SHA-256 <code>${plan.sha256.slice(0, 16)}…</code>. Sin
        escrituras en la base.
      </p>

      ${renderComparacionDeCarga(comparacion)} ${renderVeredicto(plan)} ${renderResumen(plan)}

      <form method="POST" action="/padron/aplicar" class="formulario">
        <input type="hidden" name="planId" value="${plan.planId}" />
        <button type="submit" ${plan.sinCambios ? "disabled" : ""}>
          ${plan.sinCambios ? "No hay nada que aplicar" : "Aplicar a la base"}
        </button>
      </form>
      <form method="POST" action="/padron/descartar" class="formulario">
        <button type="submit" class="boton-secundario">Descartar y empezar de nuevo</button>
      </form>
      <p class="texto-nota">
        La revisión caduca a los 30 minutos. Al caducar se vuelve a leer el archivo.
      </p>
    </section>
    ${renderColumnas(plan.hojas)} ${renderCambiosDelPadron(plan)} ${renderDivergencias(plan)}
    ${renderCambiosDePuesto(plan)}
  `;
}

function renderResultado(resultado: ResultadoDePadron): Html {
  return html`
    <section class="tarjeta">
      <h2>Padrón aplicado</h2>
      <p class="texto-nota">
        ${resultado.plan.nombreArchivo}, aplicado el ${hora(resultado.aplicadoEn)}.
        ${
          resultado.plan.origen.tipo === "PUENTE_VBA"
            ? html`Barrido por <code>${resultado.plan.origen.actor}</code>.`
            : html`Subido por ${resultado.plan.origen.actor}.`
        }
      </p>
      <div class="kpi-tira">
        ${renderKpi(
          "CURP escritas",
          resultado.curp,
          "Exigido por el DC-3 y ausente en la matriz",
          "ok",
        )}
        ${renderKpi(
          "Fechas de alta corregidas",
          resultado.altas,
          `Con ${String(resultado.inducciones)} registros de inducción`,
          "ok",
        )}
        ${renderKpi(
          "Claves de ocupación asignadas",
          resultado.ocupaciones,
          "Guardadas en el trabajador, con actor aprobador",
          "ok",
        )}
      </div>
    </section>
  `;
}

function renderFormulario(datos: DatosDePadron): Html {
  if (datos.sinBase === true) {
    return html`
      <section class="tarjeta">
        <h2>Barrer el padrón semanal</h2>
        <p class="aviso-error" role="alert">
          Sin base de datos conectada no hay a dónde aplicar el padrón.
        </p>
      </section>
    `;
  }
  return html`
    <section class="tarjeta">
      <h2>Barrer el padrón semanal</h2>
      <p class="texto-nota">
        El barrido lee el <code>sem NN CAP.xlsx</code> de la PC del departamento por el puente VBA y
        devuelve columnas, trabajadores y diferencias contra la base.
        <strong>La lectura no escribe.</strong>
      </p>

      ${
        datos.orden
          ? html`
              <p class="aviso" role="status">
                <strong>Barrido encargado</strong> el ${hora(datos.orden.solicitadaEn)} por
                ${datos.orden.solicitadaPor}. El libro controlador lo recoge en su próxima consulta.
                La orden caduca a los 30 minutos.
              </p>
              <form method="POST" action="/padron/cancelar" class="formulario">
                <button type="submit" class="boton-secundario">Cancelar encargo</button>
              </form>
            `
          : html`
              <form method="POST" action="/padron/barrido" class="formulario">
                <button type="submit">Solicitar barrido</button>
              </form>
            `
      }

      <p class="texto-nota">
        El botón encarga el barrido; lo ejecuta el libro controlador en la PC del departamento. Con
        la vigilancia activa (<code>KcmIniciarVigilancia</code>) esa PC consulta cada pocos minutos;
        sin ella, el barrido corre al pulsar <strong>Barrer padrón</strong> en
        <code>KCM_CONFIG</code>.
      </p>
    </section>

    <section class="tarjeta">
      <h2>Carga manual del archivo</h2>
      <p class="texto-nota">
        El archivo <code>sem NN CAP.xlsx</code> con sus hojas <code>SND ACTIVOS</code> y
        <code>EMP ACTIVOS</code>. No requiere el puente.
      </p>
      <form method="POST" action="/padron" enctype="multipart/form-data" class="formulario">
        <label>
          Archivo del padrón
          <input type="file" name="archivo" accept=".xlsx" required />
        </label>
        <button type="submit">Revisar sin aplicar</button>
      </form>
      <p class="texto-nota">
        La carga no escribe: primero se muestra qué cambiaría. El libro se lee en memoria y sólo
        queda su huella SHA-256.
      </p>
    </section>
  `;
}

export function renderRosterPage(datos: DatosDePadron): string {
  const contenido = html`
    ${datos.error ? html`<p class="aviso-error" role="alert">${datos.error}</p>` : ""}
    ${datos.resultado ? renderResultado(datos.resultado) : ""}
    ${datos.plan ? renderRevision(datos.plan, datos.comparacion) : renderFormulario(datos)}
    ${
      datos.plan
        ? ""
        : html`
            <section class="tarjeta">
              <h2>Aportación del padrón</h2>
              <p class="texto-nota">
                La <strong>CURP</strong>, exigida por el DC-3 y ausente en la matriz, y la
                <strong>fecha de alta</strong>, que corresponde a INDUCCIÓN A LA EMPRESA y genera
                los registros de inducción con procedencia <code>ROSTER_ALTA</code>.
              </p>
              <p class="texto-nota">
                La misma operación existe por consola:
                <code>node scripts/ingest-roster.js &lt;ruta&gt; --aplicar</code>, para archivos que
                el navegador no admita subir.
              </p>
            </section>
          `
    }
  `;

  return renderLayout({
    titulo: "Padrón semanal",
    rutaActiva: "/padron",
    subtitulo: "Carga del padrón activo y cuadre contra la matriz",
    entorno: datos.entorno,
    contenido,
    ...(datos.plan
      ? { estado: html`<span class="insignia insignia-aviso">Revisión sin aplicar</span>` }
      : datos.orden
        ? { estado: html`<span class="insignia insignia-pendiente">Barrido encargado</span>` }
        : {}),
  });
}
