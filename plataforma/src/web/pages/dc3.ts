import type { AppConfig } from "../../config/environment.ts";
import type { Dc3JobSnapshot, Dc3JobStatus } from "../../domain/dc3/tarea.ts";
import type { Dc3Candidate, Dc3PlanSummary, Dc3PlanTab } from "../../ports/dc3-constancia.port.ts";
import { html, type Html, rawHtml } from "../kit/html.ts";
import { renderLayout } from "../layout.ts";

export interface Dc3PageInput {
  readonly config: AppConfig;
  readonly job: Dc3JobSnapshot;
  /** Cursos con obligación DC-3. Vacío cuando no hay base conectada. */
  readonly courses: readonly { readonly courseKey: string; readonly courseName: string }[];
  /** Áreas del padrón. Se piden al mismo repositorio que las sirve en `/trabajadores`. */
  readonly areas: readonly string[];
  readonly candidates: readonly Dc3Candidate[];
  /** Los del plan: sólo quienes ya pueden imprimir. Lista aparte de la búsqueda. */
  readonly planCandidates: readonly Dc3Candidate[];
  readonly selected: {
    readonly courseKey?: string | undefined;
    readonly area?: string | undefined;
    readonly payrollType?: string | undefined;
    readonly query?: string | undefined;
  };
  /** Tope de renglones aplicado, para poder decir que la lista está recortada. */
  readonly limit: number;
  /** Tope del plan, que es más alto que el de la búsqueda. */
  readonly planLimit: number;
  readonly sinBase: boolean;
  /** La pantalla se abrió en modo plan: se enumera a todo el que ya puede imprimir. */
  readonly enPlan: boolean;
  /** Pestaña del plan que se está viendo. */
  readonly pestana: Dc3PlanTab;
  /** Cuentas del plan. Sólo viene en modo plan. */
  readonly plan?: Dc3PlanSummary | undefined;
  /** Claves `nomina:curso` ya emitidas, para no repetir sin saberlo. */
  readonly emitidas?: ReadonlySet<string> | undefined;
  readonly aviso?: string | undefined;
  readonly error?: string | undefined;
}

export function renderDc3Page(input: Dc3PageInput): string {
  const hayFiltro = Boolean(
    input.selected.courseKey ||
    input.selected.area ||
    input.selected.payrollType ||
    input.selected.query,
  );

  const content = html`${input.aviso ? html`<p class="aviso">${input.aviso}</p>` : ""}
    ${input.error ? html`<p class="aviso-error" role="alert">${input.error}</p>` : ""}

    <!--
      Emisión por trabajador. Va antes del lote porque es lo que se usa a diario:
      alguien pide su constancia en ventanilla. El lote de mil setecientas es una
      operación excepcional y vive más abajo.
    -->
    <section class="tarjeta tarjeta-busqueda" aria-labelledby="titulo-individual">
      <div class="seccion-cabecera">
        <h2 id="titulo-individual">Emitir por trabajador</h2>
        <p class="seccion-subtitulo">Cursos con obligación DC-3.</p>
      </div>

      ${
        input.sinBase
          ? html`<p class="texto-vacio">
              Sin base de datos conectada no hay padrón del que emitir.
            </p>`
          : html`
              <form method="GET" action="/dc3" class="formulario-busqueda" role="search">
                <!--
                  Filtrar desde aquí no debe echar a nadie del plan: si estaba
                  abierto, el filtro se aplica a sus pestañas y se vuelve a ellas.
                -->
                ${
                  input.enPlan
                    ? html`<input type="hidden" name="plan" value="1" />
                        <input type="hidden" name="pestana" value="${input.pestana}" />`
                    : ""
                }
                <div class="campo-busqueda">
                  <label for="dc3-query" class="etiqueta-formulario"
                    >Buscar por nómina o nombre</label
                  >
                  <input
                    type="search"
                    id="dc3-query"
                    name="q"
                    value="${input.selected.query ?? ""}"
                    placeholder="Ej. 01234 o JUAN PEREZ"
                    class="input-kcm"
                  />
                </div>

                <div class="campo-busqueda">
                  <label for="dc3-curso" class="etiqueta-formulario">Curso</label>
                  <select id="dc3-curso" name="curso" class="select-kcm">
                    <option value="">Todos los cursos</option>
                    ${input.courses.map(
                      (curso) =>
                        html`<option
                          value="${curso.courseKey}"
                          ${input.selected.courseKey === curso.courseKey ? "selected" : ""}
                        >
                          ${acortar(curso.courseName)}
                        </option>`,
                    )}
                  </select>
                </div>

                <div class="campo-busqueda">
                  <label for="dc3-area" class="etiqueta-formulario">Filtrar por área</label>
                  <select id="dc3-area" name="area" class="select-kcm">
                    <option value="">Todas las áreas</option>
                    ${input.areas.map(
                      (area) =>
                        html`<option
                          value="${area}"
                          ${input.selected.area === area ? "selected" : ""}
                        >
                          ${area}
                        </option>`,
                    )}
                  </select>
                </div>

                <div class="campo-busqueda">
                  <label for="dc3-nomina" class="etiqueta-formulario">Tipo de personal</label>
                  <select id="dc3-nomina" name="payrollType" class="select-kcm">
                    <option value="">Sindicalizados y confianza</option>
                    <option value="NS" ${input.selected.payrollType === "NS" ? "selected" : ""}>
                      Sindicalizados (NS)
                    </option>
                    <option value="NQ" ${input.selected.payrollType === "NQ" ? "selected" : ""}>
                      Empleados de confianza (NQ)
                    </option>
                  </select>
                </div>

                <div class="acciones-busqueda">
                  <button type="submit" class="boton-kcm">Filtrar</button>
                  ${
                    hayFiltro
                      ? html`<a
                          href="${input.enPlan ? enlaceDePlan({}, input.pestana) : "/dc3"}"
                          class="boton-secundario"
                          >Limpiar filtros</a
                        >`
                      : ""
                  }
                </div>
              </form>

              <div class="tabla-contenedor">
                <table>
                  <thead>
                    <tr>
                      <th>Nómina</th>
                      <th>Trabajador</th>
                      <th>Área</th>
                      <th>Personal</th>
                      <th>Curso</th>
                      <th>Fecha</th>
                      <th>Constancia</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${
                      input.candidates.length
                        ? input.candidates.map(renderCandidato)
                        : html`<tr>
                            <td colspan="7">
                              ${
                                hayFiltro
                                  ? "Sin trabajadores activos que coincidan con los filtros."
                                  : "Seleccione curso, área o tipo de personal para ver candidatos."
                              }
                            </td>
                          </tr>`
                    }
                  </tbody>
                </table>
              </div>

              ${
                input.candidates.length >= input.limit
                  ? html`<p class="texto-nota">
                      Lista recortada a ${input.limit} renglones. Afine los filtros para ver el
                      resto.
                    </p>`
                  : ""
              }
              <p class="texto-nota">
                Los recuadros sin dato se emiten en blanco para llenarse a mano. Al capturar el
                dato, la constancia se emite completa.
              </p>
            `
      }
    </section>

    <section class="tarjeta" aria-labelledby="titulo-lote">
      <div class="seccion-cabecera cabecera-fila">
        <div>
          <h2 id="titulo-lote">Emisión por lote</h2>
          <p class="seccion-subtitulo">
            Inducción, QMS y LOTO para toda la planta. Repetir la emisión no duplica constancias.
          </p>
        </div>
        <span class="insignia ${insigniaDeEstado(input.job.status)}">
          ${etiquetaDeEstado(input.job.status)}
        </span>
      </div>

      ${renderPasosDelLote(input.job.status)}

      <p class="texto-nota">${input.job.message}</p>

      <h3 class="seccion-subtitulo">Resultado del último plan</h3>
      <dl class="kpi-tira">
        <div class="kpi">
          <dt class="kpi-etiqueta">Detectados</dt>
          <dd class="kpi-dato"><span class="kpi-cifra">${input.job.detected}</span></dd>
          <p class="kpi-pista">Candidatos detectados por el plan.</p>
        </div>
        <div class="kpi kpi-ok">
          <dt class="kpi-etiqueta">Listos</dt>
          <dd class="kpi-dato"><span class="kpi-cifra">${input.job.ready}</span></dd>
          <p class="kpi-pista">Con metadatos legales completos.</p>
        </div>
        <div class="kpi kpi-alerta">
          <dt class="kpi-etiqueta">Bloqueados</dt>
          <dd class="kpi-dato"><span class="kpi-cifra">${input.job.blocked}</span></dd>
          <p class="kpi-pista">Con datos legales incompletos.</p>
        </div>
        <div class="kpi">
          <dt class="kpi-etiqueta">Generados</dt>
          <dd class="kpi-dato">
            <span class="kpi-cifra">${input.job.generated}</span>
            <span class="kpi-unidad">y ${input.job.repeated} ya emitidas</span>
          </dd>
          <p class="kpi-pista">Documentos generados en la última corrida.</p>
        </div>
        <div class="kpi kpi-aviso">
          <dt class="kpi-etiqueta">Con campos en blanco</dt>
          <dd class="kpi-dato"><span class="kpi-cifra">${input.job.partialDocuments}</span></dd>
          <p class="kpi-pista">Se reemplazan al capturar el dato.</p>
        </div>
      </dl>
    </section>

    <section class="tarjeta" id="plan" aria-labelledby="titulo-plan">
      <div class="seccion-cabecera">
        <h2 id="titulo-plan">Plan de emisión</h2>
        <p class="seccion-subtitulo">
          Trabajadores con constancia pendiente, partidos en tres situaciones. Cada renglón se emite
          por separado: esta pantalla no genera nada por su cuenta.
        </p>
      </div>

      ${
        input.sinBase
          ? html`<p class="texto-vacio">Sin base de datos conectada no hay plan que revisar.</p>`
          : !input.enPlan
            ? html`<p class="texto-vacio">
                  Pulse <strong>Revisar</strong> en el paso 1 para enumerar a los trabajadores con
                  constancia pendiente.
                </p>
                <p class="texto-nota">
                  <a class="boton boton-primario" href="${enlaceDePlan(input.selected, "listos")}"
                    >Revisar el plan</a
                  >
                </p>`
            : html`
                <nav class="subpestanas" aria-label="Situación del candidato">
                  ${PESTANAS_DEL_PLAN.map(
                    (opcion) =>
                      html`<a
                        class="subpestana"
                        href="${enlaceDePlan(input.selected, opcion.clave)}"
                        ${input.pestana === opcion.clave ? html`aria-current="page"` : ""}
                        >${opcion.titulo}
                        ${input.plan ? html`(${opcion.cuenta(input.plan)})` : ""}</a
                      >`,
                  )}
                </nav>

                <p class="texto-nota">${PESTANA_ACTUAL(input.pestana).explicacion}</p>

                ${
                  input.plan && input.plan.withoutOccupation > 0
                    ? html`<p class="aviso">
                        A ${input.plan.withoutOccupation} de estos renglones les falta la clave de
                        ocupación específica del CNO, que llega con el padrón semanal. Ese recuadro
                        sale en blanco aunque el renglón esté listo por lo demás.
                      </p>`
                    : ""
                }

                <div class="tabla-contenedor">
                  <table>
                    <thead>
                      <tr>
                        <th>Nómina</th>
                        <th>Trabajador</th>
                        <th>Área</th>
                        <th>Puesto</th>
                        <th>Curso</th>
                        <th>${input.pestana === "sin-curso" ? "Situación" : "Fecha"}</th>
                        ${input.pestana === "listos" ? "" : html`<th>Recuadros en blanco</th>`}
                        <th>Constancia</th>
                      </tr>
                    </thead>
                    <tbody>
                      ${
                        input.planCandidates.length
                          ? input.planCandidates.map((fila) =>
                              renderRenglonDelPlan(fila, input.pestana, input.emitidas),
                            )
                          : html`<tr>
                              <td colspan="8">
                                Nadie está en esta situación con los filtros aplicados.
                              </td>
                            </tr>`
                      }
                    </tbody>
                  </table>
                </div>

                ${
                  input.planCandidates.length >= input.planLimit
                    ? html`<p class="texto-nota">
                        Se enumeran ${input.planLimit} de
                        ${PESTANA_ACTUAL(input.pestana).cuenta(
                          input.plan ?? {
                            ready: 0,
                            incomplete: 0,
                            withoutDate: 0,
                            withoutOccupation: 0,
                          },
                        )}
                        renglones. Use los filtros de arriba —curso, área o personal— para recorrer
                        el resto por partes.
                      </p>`
                    : ""
                }
                <p class="texto-nota">
                  Cada emisión queda registrada en la bitácora con actor, fecha y curso, así que un
                  renglón ya emitido se marca como tal la próxima vez que abra el plan.
                </p>
              `
      }
    </section>`;

  return renderLayout({
    titulo: "Constancias DC-3",
    rutaActiva: "/dc3",
    subtitulo: "Emisión individual y por lote",
    entorno: input.config.environment,
    contenido: content,
  });
}

/**
 * Los tres botones del lote, que eran tres formularios sueltos apilados sin
 * separación y con el mismo aspecto.
 *
 * El problema no era sólo que se encimaran: era que sus nombres no decían el
 * orden. Hay que ejecutar el primero para que las cifras y la tabla de abajo
 * tengan algo que enseñar —el plan es de sólo lectura y no emite nada—, y los
 * otros dos se parecen tanto entre sí que no se distingue cuál firma documentos
 * incompletos. Van numerados, con una línea de qué hace cada uno, y sólo el
 * primero se ofrece como acción principal.
 */
/**
 * Las tres situaciones del plan. El orden es el del trabajo: primero a quien se
 * le puede dar la constancia buena, luego a quien la recibiría incompleta, y al
 * final a quien todavía no ha tomado el curso.
 */
const PESTANAS_DEL_PLAN = [
  {
    clave: "listos" as const,
    titulo: "Listos",
    explicacion:
      "Tomaron el curso y tienen CURP y los datos legales del curso. Sólo les falta lo que diga el aviso de abajo, si lo hay.",
    cuenta: (plan: Dc3PlanSummary) => plan.ready,
  },
  {
    clave: "incompletos" as const,
    titulo: "Incompletos",
    explicacion:
      "Tomaron el curso, pero a la constancia le faltaría algún dato legal. Emitirla la entrega con esos recuadros en blanco, para llenarse a mano; al capturar el dato se emite completa.",
    cuenta: (plan: Dc3PlanSummary) => plan.incomplete,
  },
  {
    clave: "sin-curso" as const,
    titulo: "Sin el curso",
    explicacion:
      "No tienen registro de haber tomado el curso. Emitir aquí entrega el formato rotulado con la identidad del trabajador y la fecha en blanco: sirve para llenarlo a mano, no acredita nada por sí solo.",
    cuenta: (plan: Dc3PlanSummary) => plan.withoutDate,
  },
] as const;

function PESTANA_ACTUAL(clave: Dc3PlanTab): (typeof PESTANAS_DEL_PLAN)[number] {
  return PESTANAS_DEL_PLAN.find((p) => p.clave === clave) ?? PESTANAS_DEL_PLAN[0];
}

/** El enlace de una pestaña conserva los filtros que ya estaban puestos. */
function enlaceDePlan(selected: Dc3PageInput["selected"], pestana: Dc3PlanTab): string {
  const parametros = new URLSearchParams({ plan: "1", pestana });
  if (selected.query) parametros.set("q", selected.query);
  if (selected.courseKey) parametros.set("curso", selected.courseKey);
  if (selected.area) parametros.set("area", selected.area);
  if (selected.payrollType) parametros.set("payrollType", selected.payrollType);
  return `/dc3?${parametros.toString()}#plan`;
}

interface Paso {
  readonly titulo: string;
  readonly texto: string;
  readonly boton: string;
  readonly clase: string;
  /** Los pasos que emiten mandan un job; el que sólo revisa abre una pantalla. */
  readonly campos?: readonly { readonly nombre: string; readonly valor: string }[];
  readonly enlace?: string;
}

function renderPasosDelLote(estado: Dc3JobStatus): Html {
  const corriendo = estado === "EN_COLA" || estado === "EJECUTANDO";

  const pasos: readonly Paso[] = [
    {
      titulo: "Revisar el plan",
      texto: "Enumera a los trabajadores con constancia pendiente. No emite documentos.",
      boton: "Revisar",
      clase: "boton boton-primario",
      enlace: "/dc3?plan=1&pestana=listos#plan",
    },
    {
      titulo: "Emitir las completas",
      texto: "Genera sólo las constancias que tienen todos sus datos legales aprobados.",
      boton: "Emitir",
      clase: "boton boton-secundario",
      campos: [{ nombre: "mode", valor: "generate" }],
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
          ${
            paso.enlace
              ? html`<a class="${paso.clase} paso-accion" href="${paso.enlace}">${paso.boton}</a>`
              : html`<form method="post" action="/api/dc3/jobs" class="paso-accion">
                  ${(paso.campos ?? []).map(
                    (campo) =>
                      html`<input type="hidden" name="${campo.nombre}" value="${campo.valor}" />`,
                  )}
                  <button type="submit" class="${paso.clase}" ${corriendo ? html`disabled` : ""}>
                    ${paso.boton}
                  </button>
                </form>`
          }
        </li>`,
    )}
  </ol>`;
}

/** El estado del job, como insignia y no como cifra: no es un número. */
function insigniaDeEstado(estado: Dc3JobStatus): string {
  if (estado === "COMPLETADO") return "insignia-completado";
  if (estado === "EN_COLA" || estado === "EJECUTANDO") return "insignia-programado";
  if (estado === "BLOQUEADO" || estado === "ERROR") return "insignia-aviso";
  return "insignia-inactivo";
}

function etiquetaDeEstado(estado: Dc3JobStatus): string {
  switch (estado) {
    case "SIN_CONFIGURACION":
      return "Sin configuración legal";
    case "EN_COLA":
      return "En cola";
    case "EJECUTANDO":
      return "Ejecutando";
    case "BLOQUEADO":
      return "Bloqueado";
    case "COMPLETADO":
      return "Completado";
    case "ERROR":
      return "Con error";
  }
}

/**
 * El ojo de vista previa. Compone la constancia y la abre sin registrarla: sirve
 * para revisar como va a salir antes de comprometerse. Va en pestana aparte para
 * no perder la posicion en el plan, que puede ser larga.
 *
 * El trazo es el mismo estilo de icono que usa el menu lateral: en linea, porque
 * la politica de contenido no admite un paquete de iconos por CDN.
 */
function ojoDeVistaPrevia(enlace: string): Html {
  return html`<a
    class="boton-pequeno boton-icono"
    href="${enlace}"
    target="_blank"
    rel="noopener"
    title="Previsualizar sin emitir ni registrar"
    aria-label="Previsualizar sin emitir ni registrar"
    >${ICONO_OJO}</a
  >`;
}

const ICONO_OJO = rawHtml(
  '<svg viewBox="0 0 20 20" width="15" height="15" fill="none" stroke="currentColor" ' +
    'stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" ' +
    'focusable="false"><path d="M1.8 10S4.9 4.6 10 4.6 18.2 10 18.2 10 15.1 15.4 10 15.4 1.8 10 1.8 10Z"/>' +
    '<circle cx="10" cy="10" r="2.4"/></svg>',
);

function renderCandidato(fila: Dc3Candidate): Html {
  const cola = `${encodeURIComponent(fila.workerNumber)}/${encodeURIComponent(fila.courseKey)}`;
  const enlace = `/dc3/constancia/${cola}`;
  const vistaPrevia = `/dc3/vista-previa/${cola}`;

  return html`<tr>
    <td class="celda-mono">${fila.workerNumber}</td>
    <td>
      <a href="/trabajadores/${fila.workerNumber}">${fila.workerName}</a>
      ${fila.hasCurp ? "" : html`<br /><span class="insignia insignia-pendiente">Sin CURP</span>`}
    </td>
    <td>${fila.area || "—"}</td>
    <td>${etiquetaNomina(fila.payrollType)}</td>
    <td>${acortar(fila.courseName)}</td>
    <td class="celda-mono">${fila.completionDate ?? "—"}</td>
    <td>
      ${
        fila.completionDate
          ? html`${ojoDeVistaPrevia(vistaPrevia)}
              <a class="boton-pequeno" href="${enlace}">Emitir DC-3</a>
              <a
                class="boton-pequeno boton-secundario"
                href="${enlace}?editable=1"
                title="Recuadros faltantes como campos escribibles en el visor."
                >Editable</a
              >`
          : html`<span
              class="texto-atenuado"
              title="Sin fecha del curso no hay nada que certificar."
              >Sin fecha</span
            >`
      }
    </td>
  </tr>`;
}

/**
 * El renglón del plan. Es el mismo candidato que la búsqueda de arriba, pero
 * enseña el puesto —que en el plan sirve para reconocer a la persona— y dice si
 * su constancia ya salió alguna vez, que es lo que evita emitir dos veces sin
 * darse cuenta.
 */
function renderRenglonDelPlan(
  fila: Dc3Candidate,
  pestana: Dc3PlanTab,
  emitidas?: ReadonlySet<string>,
): Html {
  const cola = `${encodeURIComponent(fila.workerNumber)}/${encodeURIComponent(fila.courseKey)}`;
  const base = `/dc3/constancia/${cola}`;
  // El botón rojo declara que la constancia sale con recuadros vacíos, la fecha
  // incluida cuando el curso no se ha tomado. Sin esa bandera el servidor se
  // niega a emitir sin fecha, y así debe seguir siendo por omisión.
  const sufijo = pestana === "listos" ? "" : "?enBlanco=1";
  const vistaPrevia = `/dc3/vista-previa/${cola}${sufijo}`;
  // La pestaña viaja con la emisión para que el acuse sepa a dónde devolver a
  // quien emitió. Volver siempre a «listos» desde la pestaña de incompletos
  // obligaría a rehacer el camino en cada renglón.
  const enlace = `${base}${sufijo ? `${sufijo}&` : "?"}pestana=${pestana}`;
  const yaEmitida = emitidas?.has(`${fila.workerNumber}:${fila.courseKey}`) ?? false;

  const boton =
    pestana === "listos"
      ? html`<a class="boton-pequeno" href="${enlace}">Emitir DC-3</a>`
      : html`<a
          class="boton-pequeno boton-peligro"
          href="${enlace}"
          title="La constancia sale con los recuadros que falten en blanco, para llenarse a mano."
          >Emitir</a
        >`;

  return html`<tr>
    <td class="celda-mono">${fila.workerNumber}</td>
    <td>
      <a href="/trabajadores/${fila.workerNumber}">${fila.workerName}</a>
      ${fila.hasCurp ? "" : html`<br /><span class="insignia insignia-pendiente">Sin CURP</span>`}
    </td>
    <td>${fila.area || "—"}</td>
    <td>${fila.position || "—"}</td>
    <td>${acortar(fila.courseName)}</td>
    <td class="celda-mono">
      ${fila.completionDate ?? html`<span class="texto-atenuado">No lo ha cursado</span>`}
    </td>
    ${
      pestana === "listos"
        ? ""
        : html`<td class="texto-secundario">
            ${
              [...fila.missing, ...(fila.completionDate ? [] : ["fecha del curso"])].join(", ") ||
              "—"
            }
          </td>`
    }
    <td>
      ${yaEmitida ? html`<span class="insignia insignia-completado">Ya emitida</span> ` : ""}${ojoDeVistaPrevia(vistaPrevia)}
      ${boton}
    </td>
  </tr>`;
}

/** Las mismas etiquetas del directorio: la clave sola no la lee nadie. */
function etiquetaNomina(tipo: string | null): string {
  const clave = (tipo ?? "").trim().toUpperCase();
  if (clave === "NS") return "Sindicalizado";
  if (clave === "NQ") return "Confianza";
  return clave || "—";
}

/** El nombre DC-3 de LOTO tiene 150 caracteres y rompe cualquier columna. */
function acortar(nombre: string): string {
  return nombre.length > 44 ? `${nombre.slice(0, 43)}…` : nombre;
}
