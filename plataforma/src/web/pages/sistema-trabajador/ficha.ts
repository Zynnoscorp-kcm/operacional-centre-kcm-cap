/**
 * Ficha individual del trabajador.
 *
 * Contesta tres preguntas, en el orden en que se hacen: ¿quién es y cómo va?
 * —la cabecera, con sus cuatro cifras—, ¿qué le falta? —la lista de cursos del
 * puesto, con lo que pide acción arriba— y ¿qué ha tomado y cuándo? —la
 * trayectoria, de lo más reciente a su ingreso—. La telaraña pone a la persona
 * contra su área, para leer si un rezago es propio o del área entera.
 *
 * Lo que no ayuda a decidir no está: ni claves de curso, ni niveles de regla, ni
 * la procedencia técnica de cada registro. Esos datos siguen en el perfil que
 * publica la API; la pantalla los dice en palabras o no los dice.
 */

import type { EnvironmentName } from "../../../config/environment.ts";
import { plantLabel } from "../../../domain/sistema-trabajador/planta.ts";
import type {
  CourseTrajectoryEntry,
  Dc3WorkerLogEntry,
  DerivedWorkerProfile,
  DncStatus,
  WorkerCourseEvaluation,
} from "../../../domain/sistema-trabajador/tipos.ts";
import { fechaCorta } from "../../kit/fechas.ts";
import { html, type Html } from "../../kit/html.ts";
import { renderLayout } from "../../layout.ts";
import { nombreCorto, renderRadarDnc } from "./telarana-dnc.ts";

export interface DatosPerfilTrabajador {
  readonly profile: DerivedWorkerProfile;
  readonly entorno: EnvironmentName;
}

/** Cómo se dice cada estado, con su tono. El orden es el de la lista: lo que pide acción, arriba. */
const ESTADOS: Readonly<
  Record<DncStatus, { readonly texto: string; readonly tono: string; readonly orden: number }>
> = {
  REFORZAR: { texto: "Por reforzar", tono: "reforzar", orden: 0 },
  PENDIENTE: { texto: "Pendiente", tono: "pendiente", orden: 1 },
  PROGRAMADO: { texto: "Programado", tono: "programado", orden: 2 },
  DATOS_INSUFICIENTES: { texto: "Sin datos", tono: "datos_insuficientes", orden: 3 },
  COMPLETADO: { texto: "Acreditado", tono: "completado", orden: 4 },
  NO_APLICA: { texto: "No aplica", tono: "no_aplica", orden: 5 },
};

const PROCEDENCIA: Readonly<Record<string, string>> = {
  XLSB_IMPORT: "Registro de la matriz de capacitación",
  SESSION_RELEASE: "Sesión liberada en la plataforma",
  MANUAL_ADJUSTMENT: "Ajuste manual",
};

/** Hitos que la trayectoria enseña de entrada; el resto, al desplegar. */
const HITOS_A_LA_VISTA = 8;

export function renderWorkerProfilePage(datos: DatosPerfilTrabajador): string {
  const { profile, entorno } = datos;
  const { worker } = profile;
  const aplicables = profile.courseEvaluations.filter((curso) => curso.isApplicable);

  const contenido = html`
    ${renderCabecera(profile, aplicables)}
    <div class="dnc-cuerpo">
      <div class="dnc-columna">
        ${
          aplicables.length >= 3
            ? html`<section class="tarjeta dnc-tarjeta" aria-labelledby="titulo-radar">
                <header class="dnc-tarjeta-cabecera">
                  <h3 id="titulo-radar" class="dnc-titulo">Perfil frente a su área</h3>
                  <p class="dnc-subtitulo">Dónde va por delante y dónde se quedó atrás.</p>
                </header>
                ${renderRadarDnc({
                  evaluaciones: aplicables,
                  area: profile.areaComparison,
                  persona: nombreCorto(worker.name),
                })}
                ${renderClaves()}
              </section>`
            : ""
        }
        ${renderTrayectoria(profile)}
      </div>
      <div class="dnc-columna">
        ${renderCursos(aplicables)} ${renderConstancias(profile.dc3Log, String(worker.employeeId))}
      </div>
    </div>
  `;

  return renderLayout({
    titulo: "Ficha del trabajador",
    tituloDocumento: `${worker.employeeId} · ${worker.name}`,
    subtitulo: worker.department || "Directorio de trabajadores",
    entorno,
    contenido,
    rutaActiva: "/trabajadores",
  });
}

function renderCabecera(
  profile: DerivedWorkerProfile,
  aplicables: readonly WorkerCourseEvaluation[],
): Html {
  const { worker, metrics, photo, seniority } = profile;
  const planta = plantLabel(worker.plant);
  const lugar = [worker.position || "Sin puesto", worker.area || worker.department || "Sin área"];
  const meta = [
    `Nómina ${String(worker.employeeId)}`,
    etiquetaNomina(worker.payrollType),
    planta,
    seniority.isAvailable ? seniority.formatted : "",
    worker.active ? "" : "Baja",
  ].filter(Boolean);

  return html`<section class="tarjeta dnc-cabecera" aria-labelledby="titulo-perfil">
    <div class="dnc-identidad">
      <span class="dnc-avatar" aria-hidden="true">${photo.initials}</span>
      <div class="dnc-datos">
        <h2 id="titulo-perfil" class="dnc-nombre">${worker.name}</h2>
        <p class="dnc-lugar">${lugar.join(" · ")}</p>
        <p class="dnc-meta">${meta.join(" · ")}</p>
      </div>
    </div>

    <dl class="dnc-conteos">
      ${conteo("Acreditados", metrics.completados, "completado")}
      ${conteo("Por reforzar", metrics.reforzar, "reforzar")}
      ${conteo("Programados", metrics.programados, "programado")}
      ${conteo("Pendientes", metrics.pendientes, "pendiente")}
    </dl>

    ${renderAvance(metrics.completados, aplicables.length)}
  </section>`;
}

function conteo(rotulo: string, cifra: number, tono: string): Html {
  return html`<div class="dnc-conteo">
    <dt class="dnc-conteo-rotulo">
      <span class="dnc-punto dnc-tono-${tono}" aria-hidden="true"></span>${rotulo}
    </dt>
    <dd class="dnc-conteo-cifra">${cifra}</dd>
  </div>`;
}

/**
 * El avance como anillo: cuántos cursos exigibles tiene acreditados y vigentes,
 * de cuántos. Es una cuenta, no un porcentaje de cumplimiento: ése se publica
 * cuando el departamento apruebe las reglas.
 */
function renderAvance(acreditados: number, exigibles: number): Html {
  if (exigibles === 0) return html``;
  const proporcion = acreditados / exigibles;
  const circunferencia = 2 * Math.PI * 22;
  const trazo = (circunferencia * proporcion).toFixed(1);
  const hueco = (circunferencia - circunferencia * proporcion).toFixed(1);

  return html`<div
    class="dnc-avance"
    role="img"
    aria-label="${acreditados} de ${exigibles} cursos exigibles acreditados"
  >
    <svg class="dnc-avance-anillo" viewBox="0 0 56 56" aria-hidden="true" focusable="false">
      <circle class="dnc-avance-fondo" cx="28" cy="28" r="22" />
      ${
        acreditados > 0
          ? html`<circle
              class="dnc-avance-trazo"
              cx="28"
              cy="28"
              r="22"
              stroke-dasharray="${trazo} ${hueco}"
              transform="rotate(-90 28 28)"
            />`
          : ""
      }
    </svg>
    <span class="dnc-avance-cifra"
      >${acreditados}<span class="dnc-avance-de">/${exigibles}</span></span
    >
  </div>`;
}

const CLAVES_DE_COLOR: readonly (readonly [string, string])[] = [
  ["completado", "Acreditado"],
  ["reforzar", "Por reforzar"],
  ["programado", "Programado"],
  ["pendiente", "Pendiente"],
];

/** La clave de colores de los rótulos, una vez y en palabras. */
function renderClaves(): Html {
  return html`<p class="dnc-claves">
    ${CLAVES_DE_COLOR.map(
      ([tono, texto]) =>
        html`<span class="dnc-clave"
          ><span class="dnc-punto dnc-tono-${tono}" aria-hidden="true"></span>${texto}</span
        >`,
    )}
  </p>`;
}

/** Los cursos que le exige su puesto: primero lo que pide acción. */
function renderCursos(aplicables: readonly WorkerCourseEvaluation[]): Html {
  const ordenados = [...aplicables].sort(
    (a, b) =>
      ESTADOS[a.status].orden - ESTADOS[b.status].orden ||
      a.canonicalCourseName.localeCompare(b.canonicalCourseName, "es-MX"),
  );

  return html`<section class="tarjeta dnc-tarjeta" aria-labelledby="titulo-cursos">
    <header class="dnc-tarjeta-cabecera">
      <h3 id="titulo-cursos" class="dnc-titulo">Cursos del puesto</h3>
      <p class="dnc-subtitulo">
        ${
          aplicables.length === 0
            ? "Ningún curso exigible para su departamento y área."
            : `${String(aplicables.length)} ${aplicables.length === 1 ? "curso exigible" : "cursos exigibles"}`
        }
      </p>
    </header>
    ${
      ordenados.length === 0
        ? ""
        : html`<ul class="dnc-cursos">
            ${ordenados.map(renderCurso)}
          </ul>`
    }
  </section>`;
}

function renderCurso(curso: WorkerCourseEvaluation): Html {
  const estado = ESTADOS[curso.status];
  return html`<li class="dnc-curso dnc-curso-${estado.tono}">
    <span class="dnc-curso-marca" aria-hidden="true"></span>
    <span class="dnc-curso-cuerpo">
      <span class="dnc-curso-nombre">${curso.canonicalCourseName}</span>
      <span class="dnc-curso-detalle">${detalleDeCurso(curso)}</span>
    </span>
    <span class="dnc-curso-estado dnc-tono-${estado.tono}">${estado.texto}</span>
  </li>`;
}

function detalleDeCurso(curso: WorkerCourseEvaluation): string {
  const ultima = curso.lastCompletionDate;
  const vence = curso.expirationDate;
  switch (curso.status) {
    case "COMPLETADO":
      return vence
        ? `Acreditado el ${fechaCorta(ultima)} · vigente hasta ${fechaCorta(vence)}`
        : `Acreditado el ${fechaCorta(ultima)}`;
    case "REFORZAR":
      return vence
        ? `Acreditado el ${fechaCorta(ultima)} · venció el ${fechaCorta(vence)}`
        : `Última acreditación el ${fechaCorta(ultima)}`;
    case "PROGRAMADO":
      return curso.scheduledSessionId
        ? `Inscrito en la sesión ${curso.scheduledSessionId}`
        : "Inscrito en una sesión por liberar";
    case "PENDIENTE":
      return "Sin registro del curso";
    case "DATOS_INSUFICIENTES":
      return "Sin datos suficientes para evaluarlo";
    case "NO_APLICA":
      return "No le aplica";
  }
}

interface Hito {
  readonly fecha: string;
  readonly titulo: string;
  readonly detalle: string;
  readonly tono: "acredito" | "constancia" | "ingreso";
}

/**
 * La trayectoria como línea de tiempo: acreditaciones, constancias DC-3 y el
 * ingreso, de lo más reciente a lo más viejo. Se ven los últimos hitos; el resto
 * se despliega sin salir de la ficha.
 */
function renderTrayectoria(profile: DerivedWorkerProfile): Html {
  const { worker } = profile;
  const hitos: Hito[] = [
    ...profile.trajectory.map((registro: CourseTrajectoryEntry): Hito => ({
      fecha: registro.completionDate,
      titulo: `Acreditó · ${registro.courseName}`,
      detalle: PROCEDENCIA[registro.provenance] ?? "Registro de capacitación",
      tono: "acredito",
    })),
    ...profile.dc3Log
      .filter((constancia) => constancia.isIssued && constancia.issuedAt)
      .map((constancia: Dc3WorkerLogEntry): Hito => ({
        fecha: constancia.issuedAt ?? "",
        titulo: `Constancia DC-3 · ${constancia.courseName}`,
        detalle: "Emitida desde la plataforma",
        tono: "constancia",
      })),
  ].sort((a, b) => b.fecha.localeCompare(a.fecha));
  if (worker.hireDate) {
    hitos.push({
      fecha: worker.hireDate,
      titulo: "Ingreso a Kimberly-Clark de México",
      detalle: worker.area ? `Alta en ${worker.area}` : "Alta en la planta",
      tono: "ingreso",
    });
  }

  const visibles = hitos.slice(0, HITOS_A_LA_VISTA);
  const resto = hitos.slice(HITOS_A_LA_VISTA);

  return html`<section class="tarjeta dnc-tarjeta" aria-labelledby="titulo-trayectoria">
    <header class="dnc-tarjeta-cabecera">
      <h3 id="titulo-trayectoria" class="dnc-titulo">Trayectoria</h3>
      <p class="dnc-subtitulo">De lo más reciente a su ingreso.</p>
    </header>
    ${
      hitos.length === 0
        ? html`<p class="texto-vacio">Sin registros de capacitación.</p>`
        : html`<ol class="dnc-linea">
              ${visibles.map(renderHito)}
            </ol>
            ${
              resto.length > 0
                ? html`<details class="dnc-mas">
                    <summary>
                      Ver ${resto.length}
                      ${resto.length === 1 ? "registro anterior" : "registros anteriores"}
                    </summary>
                    <ol class="dnc-linea">
                      ${resto.map(renderHito)}
                    </ol>
                  </details>`
                : ""
            }`
    }
  </section>`;
}

function renderHito(hito: Hito): Html {
  return html`<li class="dnc-hito dnc-hito-${hito.tono}">
    <time class="dnc-hito-fecha" datetime="${hito.fecha}">${fechaCorta(hito.fecha)}</time>
    <span class="dnc-hito-titulo">${hito.titulo}</span>
    <span class="dnc-hito-detalle">${hito.detalle}</span>
  </li>`;
}

/** Las constancias DC-3 de la persona, en corto; el detalle vive en su expediente. */
function renderConstancias(registro: readonly Dc3WorkerLogEntry[], nomina: string): Html {
  return html`<section class="tarjeta dnc-tarjeta" aria-labelledby="titulo-dc3">
    <header class="dnc-tarjeta-cabecera dnc-cabecera-fila">
      <div>
        <h3 id="titulo-dc3" class="dnc-titulo">Constancias DC-3</h3>
        <p class="dnc-subtitulo">Emisión, reimpresión e historial en su expediente.</p>
      </div>
      <a class="boton-pequeno boton-secundario" href="/dc3/trabajador/${nomina}">Expediente DC-3</a>
    </header>
    ${
      registro.length === 0
        ? html`<p class="texto-vacio">Sin cursos con constancia DC-3 registrados.</p>`
        : html`<ul class="dnc-cursos">
            ${registro.map(renderConstancia)}
          </ul>`
    }
  </section>`;
}

function renderConstancia(constancia: Dc3WorkerLogEntry): Html {
  const emitida = constancia.isIssued;
  return html`<li class="dnc-curso ${emitida ? "dnc-curso-completado" : "dnc-curso-programado"}">
    <span class="dnc-curso-marca" aria-hidden="true"></span>
    <span class="dnc-curso-cuerpo">
      <span class="dnc-curso-nombre">${constancia.courseName}</span>
      <span class="dnc-curso-detalle"
        >${
          emitida && constancia.issuedAt
            ? `Emitida el ${fechaCorta(constancia.issuedAt)}`
            : "Todavía no se emite"
        }</span
      >
    </span>
    <span class="dnc-curso-estado ${emitida ? "dnc-tono-completado" : "dnc-tono-programado"}"
      >${emitida ? "Emitida" : "Por emitir"}</span
    >
  </li>`;
}

function etiquetaNomina(value: string | null | undefined): string {
  if (value === "NS") return "Sindicalizado";
  if (value === "NQ") return "Empleado de confianza";
  return value || "";
}
