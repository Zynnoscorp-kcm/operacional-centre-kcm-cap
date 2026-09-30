import type { AppConfig } from "../../config/environment.ts";
import type {
  Dc3Candidate,
  Dc3CandidateOrder,
  Dc3EmissionSummary,
  Dc3PlanSummary,
  Dc3PlanTab,
} from "../../ports/dc3-constancia.port.ts";
import { html, type Html } from "../kit/html.ts";
import { renderLayout } from "../layout.ts";
import {
  ANIO_DEL_CORTE,
  ICONO_COMBINAR,
  ICONO_DESCARGA,
  ICONO_IMPRESORA,
  SITUACIONES,
  VISTAS_DE_EMISION,
  type AcuseDeEmision,
  type FiltrosDc3,
  chipsDeFiltro,
  claveDeRenglon,
  enlaceDeEmision,
  etiquetaCortaDeCurso,
  fechaCorta,
  fichaDeCurso,
  fichaDeEmision,
  marcaDeEmitida,
  idDeClave,
  ojoDeVistaPrevia,
  renderAcuse,
  renderBarraDeModulo,
} from "./dc3/kit.ts";

export interface Dc3PageInput {
  readonly config: AppConfig;
  readonly courses: readonly { readonly courseKey: string; readonly courseName: string }[];
  readonly areas: readonly string[];
  readonly candidates: readonly Dc3Candidate[];
  readonly total: number;
  readonly pagina: number;
  readonly porPagina: number;
  readonly selected: FiltrosDc3;
  readonly sinBase: boolean;
  readonly pestana: Dc3PlanTab;
  readonly orden: Dc3CandidateOrder;
  readonly plan?: Dc3PlanSummary | undefined;
  readonly porCurso?: readonly { readonly courseKey: string; readonly total: number }[] | undefined;
  readonly emisiones?: ReadonlyMap<string, Dc3EmissionSummary> | undefined;
  readonly marcados: boolean;
  readonly porEmitir?: number | undefined;
  readonly topeDeTanda: number;
  readonly topeDeZip: number;
  readonly acuse?: AcuseDeEmision | undefined;
  readonly aviso?: string | undefined;
  readonly error?: string | undefined;
}

const TITULOS: Readonly<Record<Dc3PlanTab, string>> = {
  listos: "Listas para emitir",
  incompletos: "Con datos por completar",
  "sin-curso": "Sin registro del curso",
};

const ORDENES: readonly {
  readonly clave: Dc3CandidateOrder;
  readonly titulo: string;
  readonly ayuda: string;
  readonly combinar?: boolean;
}[] = [
  { clave: "nombre", titulo: "Alfabético", ayuda: "Por nombre del trabajador" },
  {
    clave: "personal",
    titulo: "Confianza y sindicalizados",
    ayuda:
      "Por tipo de personal: confianza primero y sindicalizados después, " +
      "cada grupo por número de nómina de menor a mayor",
    combinar: true,
  },
];

export function renderDc3Page(input: Dc3PageInput): string {
  const contenido: Html = html`
    ${input.acuse ? renderAcuse(input.acuse) : ""}
    ${input.aviso ? html`<p class="aviso">${input.aviso}</p>` : ""}
    ${input.error ? html`<p class="aviso-error" role="alert">${input.error}</p>` : ""}
    ${input.sinBase ? renderSinBase() : renderBandeja(input)}
  `;

  return renderLayout({
    titulo: "Constancias DC-3",
    rutaActiva: "/dc3",
    subtitulo:
      input.porEmitir === undefined
        ? "Por emitir"
        : `${String(input.porEmitir)} por emitir desde ${ANIO_DEL_CORTE}`,
    entorno: input.config.environment,
    papel: input.config.role,
    modulo: renderBarraDeModulo({
      activa: "bandeja",
      porEmitir: input.porEmitir,
      busqueda: input.selected.query,
    }),
    ...(input.acuse?.descarga && input.acuse.emitidas > 0
      ? { descarga: input.acuse.descarga }
      : {}),
    contenido,
  });
}

function renderSinBase(): Html {
  return html`<section class="tarjeta">
    <p class="texto-vacio">Sin conexión con la base de datos: no hay padrón del que emitir.</p>
  </section>`;
}

function renderBandeja(input: Dc3PageInput): Html {
  return html`
    <div class="bandeja">
      ${renderFacetas(input)}
      <section class="tarjeta bandeja-lista" id="plan" aria-labelledby="titulo-plan">
        ${renderCabeceraDeLista(input)}
        ${chipsDeFiltro(input.selected, { pestana: input.pestana, orden: input.orden }, input.courses)}
        ${renderNotas(input)} ${renderLista(input)}
      </section>
    </div>
  `;
}

function direccionActual(input: Dc3PageInput): string {
  return enlaceDeEmision(input.selected, {
    pestana: input.pestana,
    orden: input.orden,
    pagina: input.pagina,
    ancla: false,
  });
}

function camposDeFiltros(selected: FiltrosDc3, conArea: boolean): Html {
  return html`
    ${selected.query ? html`<input type="hidden" name="q" value="${selected.query}" />` : ""}
    ${
      selected.courseKey
        ? html`<input type="hidden" name="curso" value="${selected.courseKey}" />`
        : ""
    }
    ${conArea && selected.area ? html`<input type="hidden" name="area" value="${selected.area}" />` : ""}
    ${
      conArea && selected.payrollType
        ? html`<input type="hidden" name="payrollType" value="${selected.payrollType}" />`
        : ""
    }
    ${
      selected.emission && selected.emission !== "pendientes"
        ? html`<input type="hidden" name="emision" value="${selected.emission}" />`
        : ""
    }
    ${selected.period ? html`<input type="hidden" name="periodo" value="${selected.period}" />` : ""}
  `;
}

function renderFacetas(input: Dc3PageInput): Html {
  const { selected, pestana, orden, plan } = input;
  const destino = { pestana, orden };
  const vista = selected.emission ?? "pendientes";
  const cuentaDeCurso = new Map((input.porCurso ?? []).map((c) => [c.courseKey, c.total]));
  const todosLosCursos = [...cuentaDeCurso.values()].reduce((suma, n) => suma + n, 0);

  const opcion = (
    href: string,
    texto: string,
    activa: boolean,
    cuenta?: number,
    tono?: string,
  ): Html =>
    html`<a class="faceta-opcion" href="${href}" ${activa ? html`aria-current="true"` : ""}
      >${tono ? html`<span class="faceta-punto ${tono}" aria-hidden="true"></span>` : ""}<span
        class="faceta-texto"
        >${texto}</span
      >${cuenta === undefined ? "" : html`<span class="faceta-cuenta">${cuenta}</span>`}</a
    >`;

  return html`<nav class="facetas" aria-label="Filtros de la lista">
    <div class="faceta">
      <p class="faceta-titulo">Situación</p>
      ${SITUACIONES.map((s) =>
        opcion(
          enlaceDeEmision(selected, { pestana: s.clave, orden }),
          s.titulo,
          pestana === s.clave,
          plan ? s.cuenta(plan) : undefined,
          s.tono,
        ),
      )}
    </div>

    ${
      pestana === "sin-curso"
        ? ""
        : html`<div class="faceta">
            <p class="faceta-titulo">Fecha del curso</p>
            ${opcion(
              enlaceDeEmision({ ...selected, period: undefined }, destino),
              `Desde ${ANIO_DEL_CORTE}`,
              selected.period === undefined,
              plan?.fromCutoff,
            )}
            ${opcion(
              enlaceDeEmision({ ...selected, period: "anteriores" }, destino),
              "Años anteriores",
              selected.period === "anteriores",
              plan?.beforeCutoff,
            )}
          </div>`
    }

    <div class="faceta">
      <p class="faceta-titulo">Curso</p>
      ${opcion(
        enlaceDeEmision({ ...selected, courseKey: undefined }, destino),
        "Todos",
        !selected.courseKey,
        input.porCurso ? todosLosCursos : undefined,
      )}
      ${input.courses.map((curso) =>
        opcion(
          enlaceDeEmision({ ...selected, courseKey: curso.courseKey }, destino),
          etiquetaCortaDeCurso(curso.courseName),
          selected.courseKey === curso.courseKey,
          input.porCurso ? (cuentaDeCurso.get(curso.courseKey) ?? 0) : undefined,
        ),
      )}
    </div>

    <div class="faceta">
      <p class="faceta-titulo">Constancia</p>
      ${VISTAS_DE_EMISION.map((v) =>
        opcion(
          enlaceDeEmision(
            { ...selected, emission: v.clave === "pendientes" ? undefined : v.clave },
            destino,
          ),
          v.titulo,
          vista === v.clave,
        ),
      )}
    </div>

    <form method="GET" action="/dc3" class="faceta faceta-formulario">
      ${pestana !== "listos" ? html`<input type="hidden" name="pestana" value="${pestana}" />` : ""}
      <input type="hidden" name="orden" value="${orden}" />
      ${camposDeFiltros(selected, false)}
      <label class="faceta-campo" for="dc3-area">
        <span class="faceta-titulo">Área</span>
        <select id="dc3-area" name="area" class="select-kcm">
          <option value="">Todas las áreas</option>
          ${input.areas.map(
            (area) =>
              html`<option value="${area}" ${selected.area === area ? "selected" : ""}>
                ${area}
              </option>`,
          )}
        </select>
      </label>
      <label class="faceta-campo" for="dc3-nomina">
        <span class="faceta-titulo">Tipo de personal</span>
        <select id="dc3-nomina" name="payrollType" class="select-kcm">
          <option value="">Sindicalizados y confianza</option>
          <option value="NS" ${selected.payrollType === "NS" ? "selected" : ""}>
            Sindicalizados (NS)
          </option>
          <option value="NQ" ${selected.payrollType === "NQ" ? "selected" : ""}>
            Empleados de confianza (NQ)
          </option>
        </select>
      </label>
      <button type="submit" class="boton-secundario boton-pequeno faceta-aplicar">Aplicar</button>
    </form>
  </nav>`;
}

function renderCabeceraDeLista(input: Dc3PageInput): Html {
  const primero = input.total === 0 ? 0 : (input.pagina - 1) * input.porPagina + 1;
  const ultimo = Math.min(input.total, input.pagina * input.porPagina);
  const cabeEnUnaEmision = input.total > 0 && input.total <= input.topeDeTanda;
  const deAnteriores = input.selected.period === "anteriores" && input.pestana !== "sin-curso";

  return html`<header class="bandeja-cabecera">
    <div class="bandeja-titulo">
      <h2 id="titulo-plan">
        ${TITULOS[input.pestana]}${deAnteriores ? html` · años anteriores` : ""}
      </h2>
      <p class="bandeja-cuenta">
        ${
          input.total === 0
            ? "Ninguna con estos filtros"
            : html`<strong>${input.total}</strong>
                ${input.total === 1 ? "constancia" : "constancias"}${
                  input.total > input.porPagina ? html` · ${primero}–${ultimo}` : ""
                }`
        }
        ${
          input.orden === "personal"
            ? " · confianza primero, después sindicalizados; cada grupo por nómina"
            : ""
        }
      </p>
    </div>
    <div class="bandeja-herramientas">
      <nav class="segmentado" aria-label="Orden de la lista">
        ${ORDENES.map(
          (opcion) =>
            html`<a
              class="segmento"
              href="${enlaceDeEmision(input.selected, { pestana: input.pestana, orden: opcion.clave })}"
              title="${opcion.ayuda}"
              ${input.orden === opcion.clave ? html`aria-current="true"` : ""}
              >${opcion.combinar ? ICONO_COMBINAR : ""}${opcion.titulo}</a
            >`,
        )}
      </nav>
      ${botonDeCsv(input)}
      ${
        cabeEnUnaEmision
          ? html`<button
              type="button"
              class="boton-pequeno boton-lista solo-con-popover"
              popovertarget="emitir-lista"
            >
              ${ICONO_IMPRESORA}
              ${input.total === 1 ? "Emitir" : html`Emitir todas (${input.total})`}
            </button>`
          : ""
      }
    </div>
  </header>`;
}

function renderNotas(input: Dc3PageInput): Html {
  const notas: Html[] = [];
  if (ocupacionComun(input)) {
    notas.push(
      html`<p class="nota-lista">
        El recuadro de <strong>ocupación específica</strong> sale en blanco: el padrón aún no
        incluye esa clave. <a href="/dc3/datos#ocupacion">Cómo se completa</a>
      </p>`,
    );
  } else if (input.plan && input.plan.withoutOccupation > 0 && input.pestana !== "sin-curso") {
    notas.push(
      html`<p class="nota-lista">
        ${input.plan.withoutOccupation} sin clave de ocupación específica: ese recuadro sale en
        blanco. <a href="/dc3/datos#ocupacion">Cómo se completa</a>
      </p>`,
    );
  }
  if (input.total > input.topeDeTanda) {
    notas.push(
      html`<p class="nota-lista nota-tenue">
        Se emiten hasta ${input.topeDeTanda} constancias de una vez; filtrada por curso o por área,
        la lista completa cabe en una sola emisión.
      </p>`,
    );
  }
  return html`${notas}`;
}

function ocupacionComun(input: Dc3PageInput): boolean {
  const plan = input.plan;
  if (!plan || input.pestana === "sin-curso") return false;
  const deLaPestana = input.pestana === "listos" ? plan.ready : plan.incomplete;
  return deLaPestana > 0 && plan.withoutOccupation >= deLaPestana;
}

function renderLista(input: Dc3PageInput): Html {
  const volver = direccionActual(input);
  const sinOcupacionComun = ocupacionComun(input);

  return html`<form method="post" action="/dc3/emitir-tanda" class="formulario-tanda">
      <input type="hidden" name="volver" value="${volver}" />
      <input type="hidden" name="pestana" value="${input.pestana}" />

      <div class="tabla-contenedor">
        <table class="tabla-kcm tabla-plan tabla-bandeja">
          <thead>
            <tr>
              <th scope="col" class="columna-casilla">
                <span class="solo-lectores">Marcar</span>
              </th>
              <th scope="col">Trabajador</th>
              <th scope="col">Curso y fecha</th>
              <th scope="col">Estado</th>
              <th scope="col" class="columna-acciones">
                <span class="solo-lectores">Constancia</span>
              </th>
            </tr>
          </thead>
          <tbody>
            ${
              input.candidates.length
                ? input.candidates.map((fila) => renderRenglon(fila, input, sinOcupacionComun))
                : html`<tr>
                    <td colspan="5" class="texto-vacio">No hay constancias con estos filtros.</td>
                  </tr>`
            }
          </tbody>
        </table>
      </div>

      ${renderPieDeTabla(input)} ${renderBarraDeSeleccion(input)}
    </form>

    ${input.candidates.map((fila) => renderConfirmacion(fila, input, volver))}
    ${renderConfirmacionDeLista(input, volver)}`;
}

function renderRenglon(fila: Dc3Candidate, input: Dc3PageInput, sinOcupacionComun: boolean): Html {
  const clave = claveDeRenglon(fila);
  const cola = `${encodeURIComponent(fila.workerNumber)}/${encodeURIComponent(fila.courseKey)}`;
  const enBlanco = input.pestana !== "listos";
  const vistaPrevia = `/dc3/vista-previa/${cola}${enBlanco ? "?enBlanco=1" : ""}`;
  const confirmar =
    `/dc3/constancia/${cola}${enBlanco ? "?enBlanco=1&" : "?"}` +
    `pestana=${input.pestana}&volver=${encodeURIComponent(direccionActual(input))}`;
  const faltantes = fila.missing.filter(
    (falta) => !(sinOcupacionComun && falta === "ocupación específica"),
  );
  const emision = input.emisiones?.get(clave);
  const estado: Html[] = [
    ...(emision ? [fichaDeEmision(emision)] : []),
    ...faltantes.map((falta) => html`<span class="chip-falta">Sin ${falta}</span>`),
  ];

  return html`<tr>
    <td class="columna-casilla">
      <input
        type="checkbox"
        name="clave"
        value="${clave}"
        class="casilla-kcm"
        ${input.marcados ? "checked" : ""}
        aria-label="Marcar a ${fila.workerName} para emitir"
      />
    </td>
    <td class="celda-persona">
      <a class="persona-nombre" href="/dc3/trabajador/${fila.workerNumber}">${fila.workerName}</a
      >${marcaDeEmitida(Boolean(emision))}
      <span
        class="persona-meta"
        title="${fila.area || "Sin área"} · ${fila.position || "Sin puesto"}"
        ><span class="celda-mono">${fila.workerNumber}</span> · ${fila.area || "Sin área"} ·
        ${fila.position || "Sin puesto"}</span
      >
    </td>
    <td class="celda-curso">
      ${fichaDeCurso(fila.courseName)}
      <span class="celda-fecha">
        ${
          fila.completionDate
            ? fechaCorta(fila.completionDate)
            : html`<span class="texto-atenuado">Sin fecha registrada</span>`
        }
      </span>
    </td>
    <td class="celda-estado">
      ${estado.length ? estado : html`<span class="insignia">Por emitir</span>`}
    </td>
    <td class="columna-acciones">
      <div class="acciones-renglon">
        ${ojoDeVistaPrevia(vistaPrevia)}
        <button
          type="button"
          class="boton-pequeno boton-emitir solo-con-popover ${enBlanco ? "boton-peligro" : ""}"
          popovertarget="${idDeClave("emitir", clave)}"
          aria-label="Emitir la constancia de ${fila.workerName}, ${etiquetaCortaDeCurso(fila.courseName)}"
        >
          Emitir
        </button>
        <a
          class="boton-pequeno boton-emitir sin-popover ${enBlanco ? "boton-peligro" : ""}"
          href="${confirmar}"
          >Emitir</a
        >
      </div>
    </td>
  </tr>`;
}

function renderConfirmacion(fila: Dc3Candidate, input: Dc3PageInput, volver: string): Html {
  const clave = claveDeRenglon(fila);
  const id = idDeClave("emitir", clave);
  const enBlanco = input.pestana !== "listos";
  const blancos = [...fila.missing, ...(fila.completionDate ? [] : ["fecha del curso"])];

  return html`<div popover id="${id}" class="confirmacion" aria-labelledby="${id}-titulo">
    <p class="confirmacion-titulo" id="${id}-titulo">¿Emitir y descargar la constancia?</p>
    <p class="confirmacion-quien">
      <strong>${fila.workerName}</strong> · <span class="celda-mono">${fila.workerNumber}</span>
    </p>
    <p class="confirmacion-que">
      ${fila.courseName}${fila.completionDate ? html` · curso del ${fechaCorta(fila.completionDate)}` : ""}
    </p>
    ${
      blancos.length > 0
        ? html`<p class="confirmacion-aviso">Recuadros en blanco: ${blancos.join(", ")}.</p>`
        : ""
    }
    <form
      method="post"
      action="/dc3/constancia/${encodeURIComponent(fila.workerNumber)}/${encodeURIComponent(fila.courseKey)}"
      class="confirmacion-formulario"
    >
      <input type="hidden" name="volver" value="${volver}" />
      ${enBlanco ? html`<input type="hidden" name="enBlanco" value="1" />` : ""}
      ${
        blancos.length > 0
          ? html`<label class="casilla-con-rotulo">
              <input type="checkbox" name="editable" value="1" class="casilla-opcion" />
              Recuadros en blanco rellenables desde el visor de PDF
            </label>`
          : ""
      }
      <div class="confirmacion-acciones">
        <button type="submit" class="boton-exito">Sí, emitir y descargar</button>
        <button
          type="button"
          class="boton-pequeno"
          popovertarget="${id}"
          popovertargetaction="hide"
        >
          No
        </button>
      </div>
    </form>
  </div>`;
}

function renderConfirmacionDeLista(input: Dc3PageInput, volver: string): Html {
  if (input.total === 0 || input.total > input.topeDeTanda) return html``;

  return html`<div
    popover
    id="emitir-lista"
    class="confirmacion"
    aria-labelledby="emitir-lista-titulo"
  >
    <p class="confirmacion-titulo" id="emitir-lista-titulo">
      ¿Emitir ${input.total === 1 ? "la constancia" : html`las ${input.total} constancias`} de esta
      lista?
    </p>
    <p class="confirmacion-que">
      Quedan registradas y se descargan en un solo archivo, en el orden de la lista.
    </p>
    ${
      input.pestana === "sin-curso"
        ? html`<p class="confirmacion-aviso">
            Salen con la fecha del curso en blanco: son formatos para llenar a mano.
          </p>`
        : ""
    }
    <form method="post" action="/dc3/emitir-tanda" class="confirmacion-formulario">
      <input type="hidden" name="todo" value="1" />
      <input type="hidden" name="volver" value="${volver}" />
      <input type="hidden" name="pestana" value="${input.pestana}" />
      <input type="hidden" name="orden" value="${input.orden}" />
      ${camposDeFiltros(input.selected, true)}
      <div class="confirmacion-acciones">
        <button type="submit" name="formato" value="pdf" class="boton-exito">Sí, emitir</button>
        <button type="submit" name="entrega" value="1" class="boton-kcm">
          Imprimir con relación
        </button>
        ${
          input.total <= input.topeDeZip
            ? html`<button
                type="submit"
                name="formato"
                value="zip"
                class="boton-pequeno boton-secundario"
              >
                En ZIP
              </button>`
            : ""
        }
        <button
          type="button"
          class="boton-pequeno"
          popovertarget="emitir-lista"
          popovertargetaction="hide"
        >
          No
        </button>
      </div>
    </form>
  </div>`;
}

function renderPieDeTabla(input: Dc3PageInput): Html {
  const paginas = Math.max(1, Math.ceil(input.total / input.porPagina));
  const hayRenglones = input.candidates.length > 0;
  const aqui = enlaceDeEmision(input.selected, {
    pestana: input.pestana,
    orden: input.orden,
    pagina: input.pagina,
  });
  const [ruta = "", ancla = ""] = aqui.split("#");
  const conMarcas = `${ruta}${ruta.includes("?") ? "&" : "?"}marcar=1#${ancla}`;

  return html`<div class="pie-de-tabla">
    <div class="pie-acciones">
      ${
        hayRenglones
          ? input.marcados
            ? html`<a class="boton-pequeno boton-secundario" href="${aqui}">Quitar las marcas</a>`
            : html`<a class="boton-pequeno boton-secundario" href="${conMarcas}"
                >Marcar esta página</a
              >`
          : ""
      }
    </div>

    <div class="paginacion">
      <span class="paginacion-cuenta">
        ${input.total === 0 ? "Sin renglones" : html`Página ${input.pagina} de ${paginas}`}
      </span>
      ${
        input.pagina > 1
          ? html`<a
              class="boton-pequeno boton-secundario"
              href="${enlaceDeEmision(input.selected, {
                pestana: input.pestana,
                orden: input.orden,
                pagina: input.pagina - 1,
              })}"
              >← Anteriores</a
            >`
          : ""
      }
      ${
        input.pagina < paginas
          ? html`<a
              class="boton-pequeno boton-secundario"
              href="${enlaceDeEmision(input.selected, {
                pestana: input.pestana,
                orden: input.orden,
                pagina: input.pagina + 1,
              })}"
              >Siguientes →</a
            >`
          : ""
      }
    </div>
  </div>`;
}

function renderBarraDeSeleccion(input: Dc3PageInput): Html {
  if (input.candidates.length === 0) return html``;
  return html`<div class="barra-seleccion" role="group" aria-label="Constancias marcadas">
    <p class="seleccion-cuenta">
      <span class="seleccion-numero" aria-hidden="true"></span>
      <span>marcadas</span>
    </p>
    <div class="seleccion-acciones">
      <button type="submit" name="formato" value="pdf" class="boton-kcm">Emitir</button>
      <button type="submit" name="entrega" value="1" class="boton-kcm">
        ${ICONO_IMPRESORA} Imprimir con relación
      </button>
      <button type="submit" name="formato" value="zip" class="boton-secundario boton-pequeno">
        En ZIP
      </button>
      ${
        input.marcados
          ? ""
          : html`<button type="reset" class="boton-enlace">Quitar las marcas</button>`
      }
    </div>
  </div>`;
}

function botonDeCsv(input: Dc3PageInput): Html {
  const destino = enlaceDeEmision(input.selected, {
    pestana: input.pestana,
    orden: input.orden,
    ancla: false,
  });
  const consulta = destino.includes("?") ? destino.slice(destino.indexOf("?") + 1) : "";
  const parametros = new URLSearchParams(consulta);
  if (!parametros.has("pestana")) parametros.set("pestana", input.pestana);

  return html`<a
    class="boton-pequeno boton-icono"
    href="/dc3/pendientes.csv?${parametros.toString()}"
    title="Descargar esta lista en CSV"
    aria-label="Descargar la lista en CSV"
    >${ICONO_DESCARGA}</a
  >`;
}
