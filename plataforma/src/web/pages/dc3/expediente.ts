/**
 * El expediente DC-3 de una persona.
 *
 * Es la pantalla de ventanilla: alguien pide su constancia, o un supervisor
 * pregunta por la de uno de los suyos, y la pregunta es siempre la misma:
 * «¿qué tiene y qué le falta?». Aquí están todos sus cursos DC-3 juntos, con lo
 * que cada constancia imprimiría, lo que ya salió y quién lo emitió, y los
 * botones para emitir o reimprimir sin salir de la pantalla.
 *
 * Los cursos anteriores al corte —1 de enero de 2026— se enseñan para
 * consulta y se pueden emitir uno por uno, pero no cuentan como pendientes.
 */

import { areaTematica } from "../../../domain/dc3/constancia.ts";
import type { AppConfig } from "../../../config/environment.ts";
import type {
  Dc3CandidateDetail,
  Dc3EmissionRecord,
  Dc3EmissionSummary,
} from "../../../ports/dc3-constancia.port.ts";
import { html, type Html } from "../../kit/html.ts";
import { renderLayout } from "../../layout.ts";
import {
  ANIO_DEL_CORTE,
  ICONO_DESCARGA,
  ICONO_IMPRESORA,
  type AcuseDeEmision,
  claveDeRenglon,
  enPlanta,
  etiquetaCortaDeCurso,
  etiquetaNomina,
  fechaCorta,
  fichaDeCurso,
  idDeClave,
  marcaDeEmitida,
  ojoDeVistaPrevia,
  renderAcuse,
  renderBarraDeModulo,
  terminoDe,
} from "./kit.ts";

export interface Dc3ExpedienteInput {
  readonly config: AppConfig;
  readonly workerNumber: string;
  /** Un renglón por curso DC-3. Vacío si la persona no está activa. */
  readonly cursos: readonly Dc3CandidateDetail[];
  /** Lo asentado de cada constancia de la persona, por clave. */
  readonly emisiones: ReadonlyMap<string, Dc3EmissionSummary>;
  /** Todas sus emisiones, de la más reciente a la más vieja. */
  readonly historial: readonly Dc3EmissionRecord[];
  readonly porEmitir?: number | undefined;
  readonly acuse?: AcuseDeEmision | undefined;
  readonly error?: string | undefined;
}

type EstadoDeCurso = "emitida" | "emitida-blancos" | "lista" | "faltan" | "sin-curso" | "anterior";

/**
 * Lo que le falta a una constancia sin contar la ocupación específica. Es la
 * misma regla que parte la bandeja en «listas» y «con datos por completar»: la
 * ocupación falta hoy en el padrón entero, y contarla dejaría a todo el mundo en
 * la segunda situación. Se sigue diciendo que sale en blanco; no cambia el estado.
 */
function faltantesPropios(curso: Dc3CandidateDetail): readonly string[] {
  return curso.missing.filter((falta) => falta !== "ocupación específica");
}

function estadoDe(
  curso: Dc3CandidateDetail,
  emision: Dc3EmissionSummary | undefined,
): EstadoDeCurso {
  if (emision) return emision.anyComplete ? "emitida" : "emitida-blancos";
  if (!curso.completionDate) return "sin-curso";
  if (curso.beforeCutoff) return "anterior";
  return faltantesPropios(curso).length === 0 ? "lista" : "faltan";
}

const ROTULO_DE_ESTADO: Readonly<Record<EstadoDeCurso, { texto: string; clase: string }>> = {
  emitida: { texto: "Emitida", clase: "insignia-completado" },
  "emitida-blancos": { texto: "Emitida con blancos", clase: "insignia-aviso" },
  lista: { texto: "Lista para emitir", clase: "insignia-programado" },
  faltan: { texto: "Datos por completar", clase: "insignia-aviso" },
  "sin-curso": { texto: "Sin registro del curso", clase: "insignia-inactivo" },
  anterior: { texto: `Anterior a ${ANIO_DEL_CORTE}`, clase: "insignia-inactivo" },
};

export function renderDc3ExpedientePage(input: Dc3ExpedienteInput): string {
  const persona = input.cursos[0];
  const volver = `/dc3/trabajador/${input.workerNumber}`;

  const contenido: Html = persona
    ? html`
        ${input.acuse ? renderAcuse(input.acuse) : ""}
        ${input.error ? html`<p class="aviso-error" role="alert">${input.error}</p>` : ""}
        ${renderCabecera(persona, input, volver)}
        <div class="expediente-cursos">
          ${input.cursos.map((curso) => renderCurso(curso, input))}
        </div>
        ${renderHistorial(input.historial)}
        ${input.cursos.map((curso) => renderConfirmacion(curso, input, volver))}
      `
    : html`<section class="tarjeta">
        <p class="texto-vacio">
          No hay un trabajador activo con la nómina
          <span class="celda-mono">${input.workerNumber}</span>.
        </p>
        <p class="texto-centro">
          <a class="boton-secundario" href="/dc3">Volver a Por emitir</a>
        </p>
      </section>`;

  return renderLayout({
    titulo: "Constancias DC-3",
    tituloDocumento: `${input.workerNumber} · DC-3 · Plataforma KCM`,
    rutaActiva: "/dc3/trabajador",
    subtitulo: persona ? `Expediente de ${persona.workerName}` : "Expediente",
    entorno: input.config.environment,
    papel: input.config.role,
    modulo: renderBarraDeModulo({
      activa: "trabajador",
      porEmitir: input.porEmitir,
      busqueda: input.workerNumber,
      ...(persona
        ? { trabajador: { numero: persona.workerNumber, nombre: persona.workerName } }
        : {}),
    }),
    ...(input.acuse?.descarga && input.acuse.emitidas > 0
      ? { descarga: input.acuse.descarga }
      : {}),
    contenido,
  });
}

function iniciales(nombre: string): string {
  return nombre
    .split(/\s+/u)
    .filter(Boolean)
    .slice(0, 2)
    .map((palabra) => palabra.charAt(0))
    .join("");
}

function renderCabecera(
  persona: Dc3CandidateDetail,
  input: Dc3ExpedienteInput,
  volver: string,
): Html {
  const emitibles = input.cursos.filter(
    (curso) =>
      curso.completionDate && !curso.beforeCutoff && !input.emisiones.has(claveDeRenglon(curso)),
  );
  const emitidas = input.cursos.filter((c) => input.emisiones.has(claveDeRenglon(c))).length;
  const ocupacion = persona.occupation.trim();

  return html`<section class="tarjeta expediente-cabecera" aria-labelledby="titulo-expediente">
    <div class="expediente-identidad">
      <span class="avatar-placeholder" aria-hidden="true">${iniciales(persona.workerName)}</span>
      <div class="expediente-nombre">
        <h2 id="titulo-expediente" class="perfil-nombre">
          ${persona.workerName}${marcaDeEmitida(
            emitidas > 0,
            `${String(emitidas)} constancia(s) DC-3 ya emitida(s)`,
          )}
        </h2>
        <p class="perfil-puesto">
          <span class="insignia insignia-nomina">Nómina ${persona.workerNumber}</span>
          ${persona.position || "Sin puesto"} · ${persona.area || "Sin área"} ·
          ${etiquetaNomina(persona.payrollType)}
        </p>
      </div>
      <a class="boton-pequeno boton-secundario" href="/trabajadores/${persona.workerNumber}"
        >Ficha del trabajador</a
      >
    </div>

    <dl class="expediente-datos">
      <div class="expediente-dato">
        <dt>CURP</dt>
        <dd>
          ${
            persona.hasCurp
              ? html`<span class="dato-ok">Registrada</span>`
              : html`<span class="dato-falta">Sin registrar: el recuadro sale en blanco</span>`
          }
        </dd>
      </div>
      <div class="expediente-dato">
        <dt>Ocupación específica (CNO)</dt>
        <dd>
          ${
            ocupacion
              ? html`<span class="dato-ok">${ocupacion}</span>`
              : html`<span class="dato-falta"
                  >Sin clave en el padrón: el recuadro sale en blanco</span
                >`
          }
        </dd>
      </div>
      <div class="expediente-dato">
        <dt>Constancias</dt>
        <dd>${emitidas} de ${input.cursos.length} emitidas</dd>
      </div>
    </dl>

    ${
      emitibles.length >= 2
        ? html`<form method="post" action="/dc3/emitir-tanda" class="expediente-tanda">
            <input type="hidden" name="volver" value="${volver}" />
            <input type="hidden" name="pestana" value="incompletos" />
            ${emitibles.map(
              (curso) =>
                html`<input type="hidden" name="clave" value="${claveDeRenglon(curso)}" />`,
            )}
            <button type="submit" name="formato" value="pdf" class="boton-kcm">
              Emitir las ${emitibles.length} pendientes
            </button>
            <button type="submit" name="entrega" value="1" class="boton-kcm">
              ${ICONO_IMPRESORA} Imprimir con relación
            </button>
            <span class="texto-nota"
              >${emitibles.map((curso) => etiquetaCortaDeCurso(curso.courseName)).join(", ")}</span
            >
          </form>`
        : ""
    }
  </section>`;
}

function renderCurso(curso: Dc3CandidateDetail, input: Dc3ExpedienteInput): Html {
  const clave = claveDeRenglon(curso);
  const emision = input.emisiones.get(clave);
  const estado = estadoDe(curso, emision);
  const rotulo = ROTULO_DE_ESTADO[estado];
  const cola = `${encodeURIComponent(curso.workerNumber)}/${encodeURIComponent(curso.courseKey)}`;
  // Rojo sólo cuando la constancia sale sin fecha o sin un dato de la persona;
  // la ocupación, que falta a todos, no la vuelve una emisión distinta.
  const enBlanco = !curso.completionDate || faltantesPropios(curso).length > 0;
  const termino = terminoDe(curso);
  const area = areaTematica(curso);
  const principal = !emision && estado !== "anterior";

  return html`<article
    class="tarjeta curso-expediente curso-${estado}"
    aria-label="${curso.courseName}"
  >
    <header class="curso-expediente-cabecera">
      ${fichaDeCurso(curso.courseName)}
      <span class="insignia ${rotulo.clase}">${rotulo.texto}</span>${marcaDeEmitida(
        Boolean(emision),
      )}
    </header>
    <h3 class="curso-expediente-nombre" title="${curso.courseName}">${curso.courseName}</h3>

    <dl class="curso-datos">
      <div>
        <dt>Fecha del curso</dt>
        <dd>
          ${curso.completionDate ? fechaCorta(curso.completionDate) : "Sin registro"}${
            termino && termino !== curso.completionDate ? html` al ${fechaCorta(termino)}` : ""
          }
        </dd>
      </div>
      <div>
        <dt>Duración</dt>
        <dd>
          ${curso.durationHours === null ? html`<span class="dato-falta">Sin dato</span>` : `${String(curso.durationHours)} h`}
        </dd>
      </div>
      <div>
        <dt>Área temática</dt>
        <dd>${area || html`<span class="dato-falta">Sin dato</span>`}</dd>
      </div>
      <div>
        <dt>Agente capacitador</dt>
        <dd>${curso.trainingAgent || html`<span class="dato-falta">Sin dato</span>`}</dd>
      </div>
    </dl>

    ${
      emision
        ? html`<p class="curso-emision">
            ${emision.count === 1 ? "Emitida" : html`Emitida ${emision.count} veces; la última`} el
            ${fechaCorta(enPlanta(emision.lastAt).dia)} a las ${enPlanta(emision.lastAt).hora}, por
            <strong>${emision.lastActor}</strong
            >${emision.lastPartial ? ", con recuadros en blanco" : ""}.
          </p>`
        : ""
    }
    ${
      curso.missing.length > 0
        ? html`<p class="curso-blancos">Recuadros en blanco: ${curso.missing.join(", ")}.</p>`
        : ""
    }

    <div class="curso-acciones">
      <button
        type="button"
        class="boton-pequeno ${principal ? (enBlanco ? "boton-peligro" : "boton-kcm") : "boton-secundario"} solo-con-popover"
        popovertarget="${idDeClave("emitir", clave)}"
      >
        ${emision ? "Emitir de nuevo" : "Emitir"}
      </button>
      <a
        class="boton-pequeno sin-popover ${enBlanco ? "boton-peligro" : ""}"
        href="/dc3/constancia/${cola}?${curso.completionDate ? "" : "enBlanco=1&"}volver=${encodeURIComponent(`/dc3/trabajador/${curso.workerNumber}`)}"
        >${emision ? "Emitir de nuevo" : "Emitir"}</a
      >
      ${
        emision
          ? html`<a
              class="boton-pequeno boton-secundario"
              href="/dc3/documentos?claves=${encodeURIComponent(clave)}"
              title="Descarga la constancia otra vez, sin registrar una emisión nueva"
              >${ICONO_DESCARGA} Reimprimir</a
            >`
          : ""
      }
      ${ojoDeVistaPrevia(`/dc3/vista-previa/${cola}${curso.completionDate ? "" : "?enBlanco=1"}`)}
    </div>
  </article>`;
}

function renderConfirmacion(
  curso: Dc3CandidateDetail,
  input: Dc3ExpedienteInput,
  volver: string,
): Html {
  const clave = claveDeRenglon(curso);
  const id = idDeClave("emitir", clave);
  const blancos = [...curso.missing, ...(curso.completionDate ? [] : ["fecha del curso"])];
  const yaSalio = input.emisiones.has(clave);

  return html`<div popover id="${id}" class="confirmacion" aria-labelledby="${id}-titulo">
    <p class="confirmacion-titulo" id="${id}-titulo">
      ${yaSalio ? "¿Emitir otra vez la constancia?" : "¿Emitir y descargar la constancia?"}
    </p>
    <p class="confirmacion-quien">
      <strong>${curso.workerName}</strong> · ${etiquetaCortaDeCurso(curso.courseName)}
    </p>
    ${
      yaSalio
        ? html`<p class="confirmacion-que">
            Ya se emitió antes. Emitirla de nuevo deja un registro más; «Reimprimir» la descarga sin
            registrarla otra vez.
          </p>`
        : ""
    }
    ${
      blancos.length > 0
        ? html`<p class="confirmacion-aviso">Recuadros en blanco: ${blancos.join(", ")}.</p>`
        : ""
    }
    <form
      method="post"
      action="/dc3/constancia/${encodeURIComponent(curso.workerNumber)}/${encodeURIComponent(curso.courseKey)}"
      class="confirmacion-formulario"
    >
      <input type="hidden" name="volver" value="${volver}" />
      ${curso.completionDate ? "" : html`<input type="hidden" name="enBlanco" value="1" />`}
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

function renderHistorial(historial: readonly Dc3EmissionRecord[]): Html {
  return html`<section class="tarjeta" aria-labelledby="titulo-historial-persona">
    <div class="seccion-cabecera">
      <h2 id="titulo-historial-persona">Historial de emisiones</h2>
    </div>
    ${
      historial.length === 0
        ? html`<p class="texto-vacio">Sin constancias emitidas.</p>`
        : html`<div class="tabla-contenedor">
            <table class="tabla-kcm">
              <thead>
                <tr>
                  <th scope="col">Fecha</th>
                  <th scope="col">Curso</th>
                  <th scope="col">Resultado</th>
                  <th scope="col">Emitida por</th>
                </tr>
              </thead>
              <tbody>
                ${historial.map((emision) => {
                  const momento = enPlanta(emision.at);
                  return html`<tr>
                    <td class="celda-fecha">${fechaCorta(momento.dia)} · ${momento.hora}</td>
                    <td>${fichaDeCurso(emision.courseName ?? emision.courseKey)}</td>
                    <td>
                      ${
                        emision.partial
                          ? html`<span class="insignia insignia-aviso"
                              >Con recuadros en blanco</span
                            >`
                          : html`<span class="insignia insignia-completado">Completa</span>`
                      }
                    </td>
                    <td class="texto-secundario">${emision.actor}</td>
                  </tr>`;
                })}
              </tbody>
            </table>
          </div>`
    }
  </section>`;
}
