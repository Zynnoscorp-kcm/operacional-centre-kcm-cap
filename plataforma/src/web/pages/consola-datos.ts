import type { AppConfig } from "../../config/environment.ts";
import {
  ORIGENES_DE_CAMPO,
  TIPOS_DE_CAMPO,
  type DeclaredField,
  type TablePreview,
  type TableSummary,
} from "../../domain/consola-interna/tipos.ts";
import { html, type Html } from "../kit/html.ts";
import { renderLayout } from "../layout.ts";

const SIN_BASE = "Sin conexión con la base de datos: no hay tablas que consultar.";

export function renderDeclaredFieldsPage(input: {
  readonly config: AppConfig;
  readonly fields: readonly DeclaredField[];
  readonly requiereSesion: boolean;
  readonly notice?: string;
  readonly error?: string;
}): string {
  const aprobados = input.fields.filter((campo) => campo.approvedForRules).length;

  const contenido = html`<section class="tarjeta">
      <div class="seccion-cabecera">
        <h2>Campos declarados</h2>
        <p>Datos adicionales por trabajador, cada uno con su origen y su vigencia.</p>
      </div>

      ${input.notice ? html`<p class="aviso">${input.notice}</p>` : ""}
      ${input.error ? html`<p class="aviso-error" role="alert">${input.error}</p>` : ""}

      <p class="texto-nota">Declarar un campo no cambia la estructura de la base de datos.</p>

      <div class="kpi-tira">
        ${renderKpi("Campos declarados", input.fields.length)}
        ${renderKpi("Aprobados para reglas", aprobados)}
        ${renderKpi("En observación", input.fields.length - aprobados)}
      </div>

      <div class="tabla-contenedor">
        <table class="tabla-kcm">
          <thead>
            <tr>
              <th>Campo</th>
              <th>Tipo</th>
              <th>Origen</th>
              <th>Descripción</th>
              <th>Valores vigentes</th>
              <th>Estado</th>
              <th>Acción</th>
            </tr>
          </thead>
          <tbody>
            ${
              input.fields.length === 0
                ? html`<tr>
                    <td colspan="7" class="texto-vacio">Sin campos declarados.</td>
                  </tr>`
                : input.fields.map((campo) => renderCampo(campo, input.requiereSesion))
            }
          </tbody>
        </table>
      </div>
    </section>

    <section class="tarjeta">
      <h2>Declarar un campo nuevo</h2>
      <p class="texto-secundario">
        El campo se crea sin aprobar. No se usa en reglas DNC ni en cobertura hasta su aprobación.
      </p>

      <form class="formulario" method="post" action="/campos">
        <label
          >Nombre
          <input
            name="nombre"
            maxlength="60"
            pattern="[a-z][a-z0-9_]{2,59}"
            title="Minúsculas, dígitos y guión bajo; empieza con letra. Ejemplo: escolaridad_declarada"
            placeholder="escolaridad_declarada"
            spellcheck="false"
            required
        /></label>

        <label
          >Tipo de dato
          <select name="tipo" class="select-kcm" required>
            ${TIPOS_DE_CAMPO.map((tipo) => html`<option value="${tipo}">${tipo}</option>`)}
          </select></label
        >

        <label
          >Origen
          <select name="origen" class="select-kcm" required>
            ${ORIGENES_DE_CAMPO.map(
              (origen) =>
                html`<option value="${origen}" ${origen === "PLATAFORMA" ? html`selected` : ""}>
                  ${origen}
                </option>`,
            )}
          </select></label
        >

        <label
          >Descripción
          <textarea
            name="descripcion"
            maxlength="500"
            placeholder="Qué representa y de dónde sale su valor."
          ></textarea>
        </label>

        ${
          input.requiereSesion
            ? html`<p class="texto-secundario">
                Declarar un campo requiere
                <a href="/acceso?destino=/campos">iniciar sesión</a>; queda registrado quién lo
                hizo.
              </p>`
            : ""
        }

        <button class="boton-primario" type="submit">Declarar campo</button>
      </form>
    </section>`;

  return renderLayout({
    titulo: "Campos declarados",
    subtitulo: "Atributos por trabajador y su aprobación para reglas",
    rutaActiva: "/campos",
    entorno: input.config.environment,
    contenido,
  });
}

function renderCampo(campo: DeclaredField, requiereSesion: boolean): Html {
  return html`<tr>
    <td class="celda-mono celda-destacada">${campo.name}</td>
    <td><span class="insignia">${campo.dataType}</span></td>
    <td class="texto-secundario">${campo.source}</td>
    <td>${campo.description ?? "—"}</td>
    <td class="celda-numero">${campo.valuesInUse}</td>
    <td>
      ${
        campo.approvedForRules
          ? html`<span class="insignia insignia-completado">Aprobado para reglas</span><br />
              <span class="texto-secundario"
                >${campo.approvedBy ?? "—"} · ${(campo.approvedAt ?? "").slice(0, 10)}</span
              >`
          : html`<span class="insignia insignia-pendiente">Sin aprobar</span>`
      }
    </td>
    <td>
      ${
        campo.approvedForRules
          ? html`<span class="texto-atenuado">—</span>`
          : html`<form method="post" action="/campos/${campo.fieldId}/aprobar">
              <button class="boton-pequeno" type="submit">Aprobar para reglas</button>
              ${requiereSesion ? html`<span class="texto-atenuado">Requiere sesión</span>` : ""}
            </form>`
      }
    </td>
  </tr>`;
}

export function renderTableCatalogPage(input: {
  readonly config: AppConfig;
  readonly tables: readonly TableSummary[];
  readonly sinBase: boolean;
}): string {
  const total = input.tables.reduce((suma, tabla) => suma + tabla.rows, 0);

  const contenido = html`<section class="tarjeta">
    <div class="seccion-cabecera">
      <h2>Tablas de la plataforma</h2>
      <p>Consulta de sólo lectura de lo que guarda la base de datos.</p>
    </div>

    <p class="texto-nota">
      Nada de lo que se consulta aquí cambia los datos. Las tablas con datos sensibles no se listan,
      y las columnas delicadas salen ocultas.
    </p>

    <div class="kpi-tira">
      ${renderKpi("Tablas visibles", input.tables.length)} ${renderKpi("Renglones en total", total)}
    </div>

    <div class="tabla-contenedor">
      <table class="tabla-kcm">
        <thead>
          <tr>
            <th>Tabla</th>
            <th>Renglones</th>
            <th>Descripción</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          ${
            input.tables.length === 0
              ? html`<tr>
                  <td colspan="4" class="texto-vacio">
                    ${input.sinBase ? SIN_BASE : "Sin tablas visibles."}
                  </td>
                </tr>`
              : input.tables.map(
                  (tabla) =>
                    html`<tr>
                      <td class="celda-mono celda-destacada">
                        ${tabla.name}
                        ${
                          tabla.appendOnly
                            ? html`<br /><span class="insignia insignia-declarada"
                                  >Sólo se agregan renglones</span
                                >`
                            : ""
                        }
                      </td>
                      <td class="celda-numero">${tabla.rows}</td>
                      <td class="texto-secundario">${tabla.comment ?? "—"}</td>
                      <td>
                        <a class="boton-pequeno" href="/base/${tabla.name}">Ver renglones</a>
                      </td>
                    </tr>`,
                )
          }
        </tbody>
      </table>
    </div>
  </section>`;

  return renderLayout({
    titulo: "Explorador de la base",
    subtitulo: "Tablas de la plataforma, en sólo lectura",
    rutaActiva: "/base",
    entorno: input.config.environment,
    contenido,
  });
}

export function renderTablePreviewPage(input: {
  readonly config: AppConfig;
  readonly preview: TablePreview;
}): string {
  const { preview } = input;
  const hasta = Math.min(preview.offset + preview.limit, preview.total);
  const anterior = Math.max(preview.offset - preview.limit, 0);
  const siguiente = preview.offset + preview.limit;

  const contenido = html`<section class="tarjeta">
    <p class="miga-de-pan"><a href="/base">← Todas las tablas</a></p>

    <div class="seccion-cabecera">
      <h2><code>kcm.${preview.table}</code></h2>
      <p>${preview.comment ?? "Sin descripción en el catálogo."}</p>
    </div>

    <p class="texto-secundario">
      Renglones ${preview.total === 0 ? 0 : preview.offset + 1}–${hasta} de ${preview.total}.
      ${
        preview.maskedColumns.length > 0
          ? html`Columnas ocultas: <code>${preview.maskedColumns.join(", ")}</code>.`
          : ""
      }
    </p>

    <div class="tabla-contenedor">
      <table class="tabla-kcm">
        <thead>
          <tr>
            ${preview.columns.map((columna) => html`<th>${columna}</th>`)}
          </tr>
        </thead>
        <tbody>
          ${
            preview.rows.length === 0
              ? html`<tr>
                  <td colspan="${preview.columns.length}" class="texto-vacio">
                    Sin renglones en este tramo.
                  </td>
                </tr>`
              : preview.rows.map(
                  (fila) =>
                    html`<tr>
                      ${fila.map(
                        (celda) =>
                          html`<td class="celda-mono">
                            ${celda === null ? html`<span class="texto-atenuado" title="Sin valor">—</span>` : celda}
                          </td>`,
                      )}
                    </tr>`,
                )
          }
        </tbody>
      </table>
    </div>

    <nav class="barra-accesos-rapidos" aria-label="Paginación">
      ${
        preview.offset > 0
          ? html`<a
              class="boton-acceso-rapido"
              href="/base/${preview.table}?limite=${preview.limit}&desde=${anterior}"
              >← Anteriores</a
            >`
          : ""
      }
      ${
        siguiente < preview.total
          ? html`<a
              class="boton-acceso-rapido"
              href="/base/${preview.table}?limite=${preview.limit}&desde=${siguiente}"
              >Siguientes →</a
            >`
          : ""
      }
    </nav>
  </section>`;

  return renderLayout({
    titulo: `Tabla ${preview.table}`,
    subtitulo: "Consulta de sólo lectura",
    rutaActiva: "/base",
    entorno: input.config.environment,
    contenido,
  });
}

function renderKpi(etiqueta: string, cifra: number): Html {
  return html`<div class="kpi">
    <span class="kpi-etiqueta">${etiqueta}</span>
    <span class="kpi-dato"><span class="kpi-cifra">${cifra}</span></span>
  </div>`;
}
