import type { DeploymentRole, EnvironmentName } from "../../config/environment.ts";
import type { HojaLeida, PlanDePadron, ResultadoDePadron } from "../../domain/padron/tipos.ts";
import type { ComparacionConLaAnterior } from "../../domain/cargas/tipos.ts";
import { personasConCambios, renderPanelDeCambios } from "../kit/panel-de-cambios.ts";
import { momento } from "../kit/fechas.ts";
import { html, type Html } from "../kit/html.ts";
import { renderLayout } from "../layout.ts";

export interface DatosDePadron {
  readonly entorno: EnvironmentName;
  readonly papel?: DeploymentRole;
  readonly error?: string | undefined;
  readonly plan?: PlanDePadron | undefined;
  readonly resultado?: ResultadoDePadron | undefined;
  readonly comparacion?: ComparacionConLaAnterior | undefined;
  readonly sinBase?: boolean;
}

const NOMBRE_DE_CAMPO: Readonly<Record<string, string>> = {
  employeeId: "Número de trabajador",
  displayName: "Nombre",
  position: "Puesto",
  curp: "CURP",
  hireDate: "Fecha de alta",
  cnoKey: "Clave de ocupación",
};

function hora(iso: string): string {
  return momento(iso);
}

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

function renderColumnas(hojas: readonly HojaLeida[]): Html | string {
  if (hojas.length === 0) return "";
  const columnas = hojas.flatMap((hoja) => hoja.columns);
  const detectadas = columnas.filter((columna) => columna.present).length;
  return html`
    <details class="tarjeta plegable">
      <summary>Columnas del archivo · ${detectadas} de ${columnas.length} detectadas</summary>
      ${hojas.map(
        (hoja) => html`
          <p class="texto-nota">
            <strong>${hoja.sheetName}</strong>: ${hoja.acceptedRows} trabajadores
          </p>
          <div class="tabla-contenedor">
            <table class="tabla-kcm">
              <thead>
                <tr>
                  <th scope="col">Campo</th>
                  <th scope="col">Encabezado en el libro</th>
                  <th scope="col">Col.</th>
                </tr>
              </thead>
              <tbody>
                ${hoja.columns.map(
                  (columna) => html`
                    <tr>
                      <td>${NOMBRE_DE_CAMPO[columna.field] ?? columna.field}</td>
                      <td>
                        ${
                          columna.present
                            ? columna.header
                            : html`<span class="texto-atenuado">No viene</span>`
                        }
                      </td>
                      <td class="celda-mono">${columna.present ? columna.columnName : "—"}</td>
                    </tr>
                  `,
                )}
              </tbody>
            </table>
          </div>
        `,
      )}
    </details>
  `;
}

function renderRevision(plan: PlanDePadron): Html {
  const c = plan.cuadre;
  return html`
    ${renderPanelDeCambios({
      titulo: `${plan.nombreArchivo} · ${hora(plan.leidoEn)}`,
      rotuloAltas: "No están en la base",
      rotuloBajas: "No vienen en el padrón",
      detalle: plan.detalle,
      cifras: [
        { valor: c.bajas ?? 0, rotulo: "se dan de baja", tono: "baja" },
        { valor: c.ausentes - (c.bajas ?? 0), rotulo: "no vienen en el padrón", tono: "aviso" },
        { valor: c.reactivados ?? 0, rotulo: "vuelven a estar activos", tono: "alta" },
        {
          valor: plan.detalle ? personasConCambios(plan.detalle) : c.puestosCambiados,
          rotulo: "con cambios",
          tono: "cambio",
        },
        { valor: c.curpPorEscribir, rotulo: "CURP", tono: "cambio" },
        { valor: c.altasPorCorregir, rotulo: "fechas de alta", tono: "cambio" },
        { valor: c.datosPorEscribir ?? 0, rotulo: "datos personales", tono: "cambio" },
        { valor: c.cnoPorEscribir, rotulo: "claves de ocupación", tono: "cambio" },
        { valor: c.induccionesNuevas, rotulo: "inducciones nuevas", tono: "alta" },
        { valor: c.desconocidos, rotulo: "no están en la base", tono: "aviso" },
        { valor: c.puestosNuevos, rotulo: "puestos fuera del catálogo", tono: "aviso" },
      ],
    })}
    <div class="acciones-formulario">
      <form method="POST" action="/padron/aplicar" class="formulario">
        <input type="hidden" name="planId" value="${plan.planId}" />
        <button type="submit" ${plan.sinCambios ? "disabled" : ""}>
          ${plan.sinCambios ? "No hay nada que aplicar" : "Aplicar los cambios"}
        </button>
      </form>
      <form method="POST" action="/padron/descartar" class="formulario">
        <button type="submit" class="boton-secundario">Descartar</button>
      </form>
    </div>
    ${renderColumnas(plan.hojas)}
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
          "Guardadas en el trabajador, con quién las aprobó",
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
          Sin conexión con la base de datos: el padrón no tiene dónde aplicarse.
        </p>
      </section>
    `;
  }
  return html`
    <section class="tarjeta">
      <h2>Carga manual del archivo</h2>
      <p class="texto-nota">
        El archivo <code>sem NN CAP.xlsx</code>, con sus hojas <code>SND ACTIVOS</code> y
        <code>EMP ACTIVOS</code>.
      </p>
      <form method="POST" action="/padron" enctype="multipart/form-data" class="formulario">
        <label>
          Archivo del padrón
          <input type="file" name="archivo" accept=".xlsx" required />
        </label>
        <button type="submit">Revisar sin aplicar</button>
      </form>
    </section>
  `;
}

export function renderRosterPage(datos: DatosDePadron): string {
  const contenido = html`
    ${datos.error ? html`<p class="aviso-error" role="alert">${datos.error}</p>` : ""}
    ${datos.resultado ? renderResultado(datos.resultado) : ""}
    ${datos.plan ? renderRevision(datos.plan) : renderFormulario(datos)}
    ${
      datos.plan
        ? ""
        : html`
            <section class="tarjeta">
              <h2>Qué aporta el padrón</h2>
              <p class="texto-nota">
                La <strong>CURP</strong> y la <strong>clave de ocupación</strong> que imprime la
                constancia DC-3, y la <strong>fecha de alta</strong>, que registra la inducción a la
                empresa. La matriz no trae ninguno de los tres.
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
    ...(datos.papel ? { papel: datos.papel } : {}),
    contenido,
    ...(datos.plan
      ? { estado: html`<span class="insignia insignia-aviso">Revisión sin aplicar</span>` }
      : {}),
  });
}
