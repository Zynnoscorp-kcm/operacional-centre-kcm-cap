/**
 * Datos del formato: qué imprime la constancia, de dónde sale cada dato y qué
 * sale en blanco.
 *
 * La pregunta que más se repite frente a una constancia es «¿por qué salió este
 * recuadro vacío?». Aquí está la respuesta entera, y es de sólo lectura: los
 * datos se completan donde viven —el padrón y el catálogo de cursos—, no desde
 * una pantalla. Lo que sí se puede hacer aquí es llevarse la lista de lo que
 * falta a quien lo tiene que dar.
 */

import type { AppConfig } from "../../../config/environment.ts";
import { nombreDeAreaTematica } from "../../../domain/dc3/areas-tematicas.ts";
import type { FormatoVisibleDc3 } from "../../../domain/dc3/constancia.ts";
import type {
  Dc3CourseMetadata,
  Dc3DataGaps,
  Dc3OccupationGap,
} from "../../../ports/dc3-constancia.port.ts";
import { html, type Html } from "../../kit/html.ts";
import { renderLayout } from "../../layout.ts";
import { ANIO_DEL_CORTE, fechaCorta, fichaDeCurso, renderBarraDeModulo } from "./kit.ts";

export interface Dc3DatosInput {
  readonly config: AppConfig;
  readonly cursos: readonly Dc3CourseMetadata[];
  readonly formato: FormatoVisibleDc3;
  readonly huecos?: Dc3DataGaps | undefined;
  readonly combinaciones: readonly Dc3OccupationGap[];
  readonly porEmitir?: number | undefined;
  readonly sinBase: boolean;
}

const REGLAS_DE_FECHA: Readonly<Record<string, string>> = {
  FECHA_ALTA: "Fecha de alta del trabajador",
  FECHA_MATRIZ: "Fecha del curso en la matriz",
  FECHA_SESION: "Fecha de la sesión",
};

function falta(texto = "Sin dato"): Html {
  return html`<span class="dato-falta">${texto}</span>`;
}

function renderCursos(cursos: readonly Dc3CourseMetadata[]): Html {
  if (cursos.length === 0) {
    return html`<p class="texto-vacio">Ningún curso tiene constancia DC-3 asignada.</p>`;
  }
  return html`<div class="tabla-contenedor">
    <table class="tabla-kcm">
      <thead>
        <tr>
          <th scope="col">Curso</th>
          <th scope="col">Duración</th>
          <th scope="col">Área temática</th>
          <th scope="col">Agente capacitador</th>
          <th scope="col">Fecha que imprime</th>
          <th scope="col">Periodo</th>
        </tr>
      </thead>
      <tbody>
        ${cursos.map((curso) => {
          const nombreDeArea = nombreDeAreaTematica(curso.thematicAreaKey, curso.thematicAreaName);
          return html`<tr>
            <td>${fichaDeCurso(curso.courseName)}</td>
            <td>
              ${curso.durationHours === null ? falta() : `${String(curso.durationHours)} h`}
              ${
                curso.durationDays
                  ? html`<span class="persona-meta">en ${curso.durationDays} jornadas</span>`
                  : ""
              }
            </td>
            <td>
              ${
                curso.thematicAreaKey
                  ? html`<span class="celda-mono">${curso.thematicAreaKey}</span>
                      ${nombreDeArea || falta("Sin nombre")}`
                  : falta()
              }
            </td>
            <td>${curso.trainingAgent ?? falta()}</td>
            <td>${REGLAS_DE_FECHA[curso.dateRule] ?? curso.dateRule}</td>
            <td>
              ${
                curso.periodDays === 0
                  ? "Un solo día"
                  : `Termina ${String(curso.periodDays)} ${curso.periodDays === 1 ? "día" : "días"} después`
              }
            </td>
          </tr>`;
        })}
      </tbody>
    </table>
  </div>`;
}

function renderFormato(formato: FormatoVisibleDc3): Html {
  const hay = (presente: boolean): Html =>
    presente ? html`<span class="dato-ok">Incluido</span>` : falta("No disponible");

  return html`<dl class="definiciones-dc3">
    <div>
      <dt>Razón social</dt>
      <dd>${formato.razonSocial}</dd>
    </div>
    ${formato.firmas.map(
      (firma) =>
        html`<div>
          <dt>${firma.rotulo.replace(/\s+\d\/$/u, "")}</dt>
          <dd>${firma.nombre}</dd>
        </div>`,
    )}
    <div>
      <dt>Logotipo de la empresa</dt>
      <dd>${hay(formato.logotipos.empresa)}</dd>
    </div>
    <div>
      <dt>Logotipo del sindicato</dt>
      <dd>${hay(formato.logotipos.sindicato)} · sólo en las del personal sindicalizado</dd>
    </div>
  </dl>`;
}

function renderPeriodo(formato: FormatoVisibleDc3): Html {
  return html`<dl class="definiciones-dc3">
    <div>
      <dt>Constancias desde</dt>
      <dd>${fechaCorta(formato.corte)}</dd>
    </div>
    <div>
      <dt>Fecha de cada constancia</dt>
      <dd>
        La primera vez que el trabajador tomó el curso desde esa fecha. Si no lo ha tomado desde
        entonces, la más reciente de años anteriores.
      </dd>
    </div>
    <div>
      <dt>Inducción</dt>
      <dd>La fecha de alta del trabajador.</dd>
    </div>
    <div>
      <dt>Años anteriores</dt>
      <dd>
        No cuentan como pendientes. Se consultan y se emiten desde
        <a href="/dc3?periodo=anteriores">Por emitir · Años anteriores</a>.
      </dd>
    </div>
  </dl>`;
}

export function renderDc3DatosPage(input: Dc3DatosInput): string {
  const contenido: Html = html`
    <section class="tarjeta" aria-labelledby="titulo-cursos-formato">
      <div class="seccion-cabecera">
        <h2 id="titulo-cursos-formato">Lo que imprime cada curso</h2>
        <p>Un dato vacío sale en blanco en todas las constancias del curso.</p>
      </div>
      ${
        input.sinBase
          ? html`<p class="texto-vacio">Sin conexión con la base de datos.</p>`
          : renderCursos(input.cursos)
      }
    </section>

    <div class="rejilla-dos">
      <section class="tarjeta" aria-labelledby="titulo-empresa">
        <div class="seccion-cabecera">
          <h2 id="titulo-empresa">Formato oficial</h2>
          <p>Razón social, firmas y membrete de todas las constancias.</p>
        </div>
        ${renderFormato(input.formato)}
      </section>

      <section class="tarjeta" aria-labelledby="titulo-periodo">
        <div class="seccion-cabecera">
          <h2 id="titulo-periodo">Periodo de las constancias</h2>
          <p>Desde ${ANIO_DEL_CORTE}, con consulta de años anteriores.</p>
        </div>
        ${renderPeriodo(input.formato)}
      </section>
    </div>
  `;

  return renderLayout({
    titulo: "Constancias DC-3",
    rutaActiva: "/dc3/datos",
    subtitulo: "Datos del formato",
    entorno: input.config.environment,
    papel: input.config.role,
    modulo: renderBarraDeModulo({ activa: "datos", porEmitir: input.porEmitir }),
    contenido,
  });
}
