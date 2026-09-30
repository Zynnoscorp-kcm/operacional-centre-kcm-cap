import type { EnvironmentName } from "../../config/environment.ts";
import type { Ocupacion, Subarea } from "../../domain/ocupaciones/catalogo.ts";
import type { HojaDeEstilos } from "../estaticos.ts";
import { html, type Html } from "../kit/html.ts";
import { renderLayout } from "../layout.ts";

export interface BusquedaEnCatalogo {
  readonly texto: string;
  readonly subarea: string;
  readonly realizada: boolean;
  readonly total: number;
  readonly ocupaciones: readonly Ocupacion[];
}

export interface DatosDeOcupaciones {
  readonly entorno: EnvironmentName;
  readonly iaDisponible: boolean;
  readonly busqueda: BusquedaEnCatalogo;
  readonly subareas: readonly Subarea[];
  readonly tamanoDelCatalogo: number;
  readonly limiteDeBusqueda: number;
  readonly guion?: HojaDeEstilos | undefined;
}

function cifra(valor: number): string {
  return valor.toLocaleString("es-MX");
}

function renderFormulario(datos: DatosDeOcupaciones): Html {
  return html`<section class="tarjeta" aria-labelledby="titulo-clasificacion">
    <div class="seccion-cabecera">
      <span class="capta-rotulo">Clasificación</span>
      <h2 id="titulo-clasificacion">Clasificar ocupaciones con IA</h2>
      <p>
        El padrón semanal regresa con la clave de ocupación llena en los trabajadores activos que no
        la traían, para revisarlo antes de aplicarlo desde <a href="/padron">Padrón</a>.
      </p>
    </div>
    ${
      datos.iaDisponible
        ? html`<form class="formulario" id="form-clasificar">
              <label>
                Archivo del padrón
                <input type="file" name="archivo" accept=".xlsx" required />
              </label>
              <button type="submit" id="btn-clasificar">Clasificar faltantes</button>
            </form>
            <noscript>
              <p class="aviso-error">
                La clasificación necesita JavaScript activo en el navegador.
              </p>
            </noscript>
            <div id="progreso-ia" class="tarjeta-aviso-ia avance-ia" hidden>
              <p id="progreso-texto" class="avance-ia-titulo" aria-live="polite"></p>
              <div class="barra-progreso">
                <div class="barra-progreso-relleno" id="barra-relleno"></div>
              </div>
              <p class="texto-nota avance-ia-detalle" id="progreso-detalle"></p>
              <details id="progreso-casos" class="avance-ia-casos" hidden>
                <summary></summary>
                <ul></ul>
              </details>
              <button type="button" id="btn-cancelar" class="boton-secundario" hidden>
                Cancelar
              </button>
            </div>
            <p class="texto-nota nota-bajo-tira">
              Al modelo sólo viajan el puesto y el centro de costos; ningún dato personal sale de la
              plataforma. Cada caso tarda cerca de medio minuto, y cerrar o recargar la pestaña
              detiene la clasificación.
            </p>`
        : html`<p class="texto-vacio">
            El agente de ocupaciones no está disponible en esta instalación. La búsqueda en el
            catálogo sí funciona.
          </p>`
    }
  </section>`;
}

function renderOpcionesDeSubarea(subareas: readonly Subarea[], elegida: string): Html {
  const porArea = new Map<string, Subarea[]>();
  for (const subarea of subareas) {
    const lista = porArea.get(subarea.area);
    if (lista) lista.push(subarea);
    else porArea.set(subarea.area, [subarea]);
  }
  return html`${[...porArea.values()].map(
    (lista) =>
      html`<optgroup label="${lista[0]?.area ?? ""} · ${lista[0]?.denominacionDelArea ?? ""}">
        ${lista.map(
          (subarea) =>
            html`<option value="${subarea.clave}" ${subarea.clave === elegida ? "selected" : ""}>
              ${subarea.clave} · ${subarea.denominacion}
            </option>`,
        )}
      </optgroup>`,
  )}`;
}

function renderCatalogo(datos: DatosDeOcupaciones): Html {
  const { busqueda } = datos;
  const hayFiltros = busqueda.texto !== "" || busqueda.subarea !== "";
  return html`<section class="tarjeta" aria-labelledby="titulo-catalogo">
    <div class="seccion-cabecera">
      <span class="capta-rotulo">Catálogo</span>
      <h2 id="titulo-catalogo">Buscar en el catálogo</h2>
      <p>
        Las ${cifra(datos.tamanoDelCatalogo)} ocupaciones del catálogo de la Secretaría del Trabajo,
        por palabra, por el comienzo de la clave o por subárea.
      </p>
    </div>

    <form
      method="get"
      action="/ocupaciones"
      class="formulario-busqueda formulario-secundario"
      role="search"
    >
      <div class="campo-busqueda campo-busqueda-ancho">
        <label for="catalogo-texto" class="etiqueta-formulario">Palabras o clave</label>
        <input
          type="search"
          id="catalogo-texto"
          name="q"
          class="input-kcm"
          value="${busqueda.texto}"
          placeholder="Ej. mecánico mantenimiento o 5520"
        />
      </div>
      <div class="campo-busqueda">
        <label for="catalogo-subarea" class="etiqueta-formulario">Subárea del DC-3</label>
        <select id="catalogo-subarea" name="subarea" class="select-kcm">
          <option value="">Todas</option>
          ${renderOpcionesDeSubarea(datos.subareas, busqueda.subarea)}
        </select>
      </div>
      <div class="acciones-busqueda">
        <button type="submit">Buscar</button>
        ${hayFiltros ? html`<a href="/ocupaciones" class="boton-secundario">Limpiar</a>` : ""}
      </div>
    </form>

    ${busqueda.realizada ? renderResultadosDelCatalogo(datos) : ""}
  </section>`;
}

function renderResultadosDelCatalogo(datos: DatosDeOcupaciones): Html {
  const { busqueda } = datos;
  if (busqueda.total === 0) {
    return html`<p class="texto-vacio">Ninguna ocupación coincide con la búsqueda.</p>`;
  }
  const recortada = busqueda.total > busqueda.ocupaciones.length;
  return html`<p class="texto-nota">
      ${
        recortada
          ? `Se muestran ${cifra(busqueda.ocupaciones.length)} de ${cifra(busqueda.total)}; más palabras acotan la búsqueda.`
          : `${cifra(busqueda.total)} ${busqueda.total === 1 ? "ocupación" : "ocupaciones"}`
      }
    </p>
    <div class="tabla-contenedor">
      <table class="tabla-kcm">
        <thead>
          <tr>
            <th scope="col">Clave</th>
            <th scope="col">Ocupación</th>
            <th scope="col">Subárea del DC-3</th>
            <th scope="col">N.º STPS</th>
          </tr>
        </thead>
        <tbody>
          ${busqueda.ocupaciones.map((ocupacion) => {
            const subarea = datos.subareas.find((item) => item.clave === ocupacion.subarea);
            return html`<tr>
              <td class="celda-codigo">${ocupacion.codigo}</td>
              <td>${ocupacion.descripcion}</td>
              <td>${ocupacion.subarea} · ${subarea?.denominacion ?? ""}</td>
              <td class="celda-numero">${ocupacion.consecutivo}</td>
            </tr>`;
          })}
        </tbody>
      </table>
    </div>
    <p class="texto-nota nota-bajo-tira">
      La clave de nueve o diez dígitos es la que lleva el padrón. N.º STPS es el consecutivo del
      archivo de la Secretaría.
    </p>`;
}

export function renderOccupationsPage(datos: DatosDeOcupaciones): string {
  const contenido = html`
    ${renderFormulario(datos)} ${renderCatalogo(datos)}
    ${datos.guion ? html`<script src="${datos.guion.ruta}"></script>` : ""}
  `;

  return renderLayout({
    titulo: "Ocupaciones",
    subtitulo: "Clasificación automática de la clave de ocupación con IA",
    rutaActiva: "/ocupaciones",
    entorno: datos.entorno,
    estado: datos.iaDisponible
      ? html`<span class="insignia insignia-completado">IA disponible</span>`
      : html`<span class="insignia insignia-inactivo">IA apagada</span>`,
    contenido,
  });
}
