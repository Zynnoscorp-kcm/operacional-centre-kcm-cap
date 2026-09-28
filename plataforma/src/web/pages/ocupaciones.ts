/**
 * Ocupaciones: clasificación automática con IA.
 *
 * El flujo:
 * 1. Subir el padrón (`sem NN CAP.xlsx`).
 * 2. La IA clasifica los trabajadores sin clave de ocupación.
 * 3. Se descarga el Excel con las claves llenas.
 * 4. Se revisa fuera de línea; si es correcto, se sube a `/padron`.
 *
 * La búsqueda en el catálogo se conserva como herramienta de verificación.
 */

import type { EnvironmentName } from "../../config/environment.ts";
import type { Ocupacion, Subarea } from "../../domain/ocupaciones/catalogo.ts";
import { html, type Html } from "../kit/html.ts";
import { renderLayout } from "../layout.ts";

export interface BusquedaEnCatalogo {
  readonly texto: string;
  readonly subarea: string;
  readonly realizada: boolean;
  readonly total: number;
  readonly ocupaciones: readonly Ocupacion[];
}

export interface ResultadoDeClasificacion {
  readonly faltantes: number;
  readonly consultados: number;
  readonly escritos: number;
  readonly conClave: number;
  readonly pendientes: { readonly casos: number; readonly trabajadores: number };
}

export interface DatosDeOcupaciones {
  readonly entorno: EnvironmentName;
  readonly iaDisponible: boolean;
  readonly error?: string;
  readonly resultado?: ResultadoDeClasificacion;
  readonly busqueda: BusquedaEnCatalogo;
  readonly subareas: readonly Subarea[];
  readonly tamanoDelCatalogo: number;
  readonly limiteDeBusqueda: number;
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
        Sube el padrón semanal. Los trabajadores activos sin clave de ocupación se clasifican
        automáticamente. El archivo regresa con las claves llenas para que lo revises antes de
        aplicarlo a la base desde <a href="/padron">Padrón</a>.
      </p>
    </div>
    ${datos.error ? html`<p class="aviso-error" role="alert">${datos.error}</p>` : ""}
    ${
      datos.iaDisponible
        ? html`<form
              method="POST"
              action="/ocupaciones"
              enctype="multipart/form-data"
              class="formulario"
            >
              <label>
                Archivo del padrón
                <input type="file" name="archivo" accept=".xlsx" required />
              </label>
              <button type="submit">Clasificar faltantes</button>
            </form>
            <p class="texto-nota nota-bajo-tira">
              Sólo viajan al modelo el puesto y el centro de costos; ningún dato personal sale de la
              plataforma. Puede tardar hasta un minuto.
            </p>`
        : html`<p class="texto-vacio">
            El agente de ocupaciones no está disponible en esta instalación. La búsqueda en el
            catálogo sí funciona.
          </p>`
    }
  </section>`;
}

function renderResultado(r: ResultadoDeClasificacion): Html {
  if (r.faltantes === 0) {
    return html`<section class="tarjeta">
      <p class="texto-nota">
        Todos los ${cifra(r.conClave)} trabajadores ya tienen clave de ocupación. No hay nada que
        clasificar.
      </p>
    </section>`;
  }
  return html`<section class="tarjeta">
    <h3>Clasificación sin resultado para descargar</h3>
    <div class="kpi-tira">
      <div class="kpi">
        <span class="kpi-etiqueta">Faltantes</span>
        <span class="kpi-dato"><span class="kpi-cifra">${r.faltantes}</span></span>
        <span class="kpi-pista">Trabajadores activos sin clave</span>
      </div>
      <div class="kpi">
        <span class="kpi-etiqueta">Consultados</span>
        <span class="kpi-dato"><span class="kpi-cifra">${r.consultados}</span></span>
        <span class="kpi-pista">Combinaciones únicas</span>
      </div>
      <div class="kpi kpi-aviso">
        <span class="kpi-etiqueta">Escritos</span>
        <span class="kpi-dato"><span class="kpi-cifra">${r.escritos}</span></span>
        <span class="kpi-pista">Ningún caso fue sugerido con confianza</span>
      </div>
    </div>
    ${
      r.pendientes.casos > 0
        ? html`<p class="texto-nota">
            Quedan ${cifra(r.pendientes.casos)} casos (${cifra(r.pendientes.trabajadores)}
            trabajadores) para la siguiente corrida.
          </p>`
        : ""
    }
  </section>`;
}

function renderLeyenda(): Html {
  return html`<section class="tarjeta" aria-labelledby="titulo-leyenda">
    <div class="seccion-cabecera">
      <span class="capta-rotulo">Cómo funciona</span>
      <h2 id="titulo-leyenda">Flujo de clasificación</h2>
    </div>
    <ul class="lista-tablero">
      <li class="lista-fila">
        <span class="foco foco-verde"></span>
        <span class="lista-cuerpo">
          <span class="lista-titulo">1. Subir el padrón</span>
          <span class="lista-pista"
            >El archivo <code>sem NN CAP.xlsx</code> con sus hojas de activos.</span
          >
        </span>
      </li>
      <li class="lista-fila">
        <span class="foco foco-ambar"></span>
        <span class="lista-cuerpo">
          <span class="lista-titulo">2. Clasificación con IA</span>
          <span class="lista-pista"
            >Dos modelos resuelven cada caso. Sólo se llenan las celdas vacías con claves
            sugeridas.</span
          >
        </span>
      </li>
      <li class="lista-fila">
        <span class="foco foco-verde"></span>
        <span class="lista-cuerpo">
          <span class="lista-titulo">3. Descargar y revisar</span>
          <span class="lista-pista"
            >Se descarga el Excel con las claves llenas. Nada se escribe en la base de datos.</span
          >
        </span>
      </li>
      <li class="lista-fila">
        <span class="foco foco-verde"></span>
        <span class="lista-cuerpo">
          <span class="lista-titulo">4. Aplicar desde Padrón</span>
          <span class="lista-pista"
            >Si las claves son correctas, se sube el archivo revisado a
            <a href="/padron">Padrón</a> para aplicar.</span
          >
        </span>
      </li>
    </ul>
  </section>`;
}

// ------------------------------------------------------------ el catálogo

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

// ------------------------------------------------------------ la pantalla

export function renderOccupationsPage(datos: DatosDeOcupaciones): string {
  const contenido = html`
    <div class="rejilla-dos">${renderFormulario(datos)} ${renderLeyenda()}</div>
    ${datos.resultado ? renderResultado(datos.resultado) : ""} ${renderCatalogo(datos)}
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
