import type { AppConfig } from "../../../config/environment.ts";
import type { Dc3Candidate, Dc3EmissionSummary } from "../../../ports/dc3-constancia.port.ts";
import { html, type Html } from "../../kit/html.ts";
import { renderLayout } from "../../layout.ts";
import {
  ANIO_DEL_CORTE,
  claveDeRenglon,
  etiquetaCortaDeCurso,
  marcaDeEmitida,
  renderBarraDeModulo,
} from "./kit.ts";

export interface PersonaEncontrada {
  readonly workerNumber: string;
  readonly workerName: string;
  readonly area: string;
  readonly position: string;
  readonly cursos: readonly Dc3Candidate[];
}

export interface Dc3BusquedaInput {
  readonly config: AppConfig;
  readonly consulta: string;
  readonly personas: readonly PersonaEncontrada[];
  readonly recortada: boolean;
  readonly emisiones: ReadonlyMap<string, Dc3EmissionSummary>;
  readonly porEmitir?: number | undefined;
  readonly sinBase: boolean;
}

export function agruparPorPersona(filas: readonly Dc3Candidate[]): PersonaEncontrada[] {
  const personas = new Map<string, PersonaEncontrada & { cursos: Dc3Candidate[] }>();
  for (const fila of filas) {
    const persona = personas.get(fila.workerNumber);
    if (persona) {
      persona.cursos.push(fila);
      continue;
    }
    personas.set(fila.workerNumber, {
      workerNumber: fila.workerNumber,
      workerName: fila.workerName,
      area: fila.area,
      position: fila.position,
      cursos: [fila],
    });
  }
  return [...personas.values()];
}

function fichaDeCursoDePersona(
  curso: Dc3Candidate,
  emisiones: ReadonlyMap<string, Dc3EmissionSummary>,
): Html {
  const emision = emisiones.get(claveDeRenglon(curso));
  const etiqueta = etiquetaCortaDeCurso(curso.courseName);
  if (emision) {
    return html`<span class="estado-curso estado-emitida" title="${curso.courseName}: emitida"
      >${etiqueta} · emitida ✓</span
    >`;
  }
  if (!curso.completionDate) {
    return html`<span
      class="estado-curso estado-sin-curso"
      title="${curso.courseName}: sin registro del curso"
      >${etiqueta} · sin registro</span
    >`;
  }
  if (curso.beforeCutoff) {
    return html`<span
      class="estado-curso estado-sin-curso"
      title="${curso.courseName}: curso anterior a ${ANIO_DEL_CORTE}"
      >${etiqueta} · anterior a ${ANIO_DEL_CORTE}</span
    >`;
  }
  return html`<span class="estado-curso estado-pendiente" title="${curso.courseName}: por emitir"
    >${etiqueta} · por emitir</span
  >`;
}

export function renderDc3BusquedaPage(input: Dc3BusquedaInput): string {
  const contenido: Html = input.sinBase
    ? html`<section class="tarjeta">
        <p class="texto-vacio">
          Sin conexión con la base de datos: no hay padrón en el que buscar.
        </p>
      </section>`
    : html`<section class="tarjeta" aria-labelledby="titulo-busqueda-dc3">
        <div class="seccion-cabecera">
          <h2 id="titulo-busqueda-dc3">
            ${
              input.personas.length === 0
                ? html`Sin resultados para «${input.consulta}»`
                : html`${input.personas.length}
                  ${input.personas.length === 1 ? "persona coincide" : "personas coinciden"} con
                  «${input.consulta}»`
            }
          </h2>
          ${
            input.personas.length === 0
              ? html`<p>Se busca por número de nómina y nombre entre los trabajadores activos.</p>`
              : ""
          }
        </div>
        ${
          input.personas.length > 0
            ? html`<ul class="lista-personas">
                ${input.personas.map(
                  (persona) =>
                    html`<li class="persona-fila">
                      <a class="persona-enlace" href="/dc3/trabajador/${persona.workerNumber}">
                        <span class="persona-nombre"
                          >${persona.workerName}${marcaDeEmitida(
                            persona.cursos.some((curso) =>
                              input.emisiones.has(claveDeRenglon(curso)),
                            ),
                          )}</span
                        >
                        <span class="persona-meta"
                          ><span class="celda-mono">${persona.workerNumber}</span> ·
                          ${persona.area || "Sin área"} · ${persona.position || "Sin puesto"}</span
                        >
                      </a>
                      <span class="persona-cursos">
                        ${persona.cursos.map((curso) => fichaDeCursoDePersona(curso, input.emisiones))}
                      </span>
                    </li>`,
                )}
              </ul>`
            : ""
        }
        ${
          input.recortada
            ? html`<p class="texto-nota">
                Se muestran las primeras coincidencias. Un nombre más completo acota la búsqueda.
              </p>`
            : ""
        }
      </section>`;

  return renderLayout({
    titulo: "Constancias DC-3",
    rutaActiva: "/dc3/buscar",
    subtitulo: "Búsqueda de trabajadores",
    entorno: input.config.environment,
    papel: input.config.role,
    modulo: renderBarraDeModulo({
      activa: "trabajador",
      porEmitir: input.porEmitir,
      busqueda: input.consulta,
    }),
    contenido,
  });
}
