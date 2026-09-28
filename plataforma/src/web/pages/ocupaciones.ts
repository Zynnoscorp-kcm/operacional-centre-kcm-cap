/**
 * Ocupaciones: la clave del Catálogo Nacional de Ocupaciones que pide el DC-3.
 *
 * La pantalla existe para acortar la revisión de la copia del padrón que deja
 * «Clasificar faltantes» en Excel. Ahí las celdas en amarillo esperan a alguien
 * que decida, y decidir pedía abrir el archivo de la Secretaría —4 737 renglones—
 * y recorrerlo. Aquí se hace en el mismo sitio y en dos gestos:
 *
 * 1. **Buscar en el catálogo**, por palabras, por el comienzo de la clave o por
 *    subárea. No usa modelo ni gasta consultas: es el archivo de la Secretaría,
 *    ya leído.
 * 2. **Consultar al agente** un puesto con su centro de costos. Dos modelos lo
 *    resuelven por separado y la pantalla enseña lo que eligió cada uno.
 *
 * La leyenda de colores de la copia va al lado de la consulta porque es lo que
 * se tiene enfrente al llegar aquí.
 *
 * El recorrido de cada consulta —qué modelo contestó, cuánto tardó, qué
 * decidió— queda plegado en un `<details>`: sirve para auditar, no para decidir.
 */

import type { EnvironmentName } from "../../config/environment.ts";
import type { Ocupacion, Subarea } from "../../domain/ocupaciones/catalogo.ts";
import type {
  EstadoDeSugerencia,
  PasoDeTraza,
  PropuestaValidada,
} from "../../domain/ocupaciones/comunes.ts";
import type { Confianza } from "../../domain/ocupaciones/instrucciones.ts";
import type { SugerenciaDeOcupacion } from "../../domain/ocupaciones/servicio.ts";
import { html, type Html } from "../kit/html.ts";
import { renderLayout } from "../layout.ts";

export interface BusquedaEnCatalogo {
  readonly texto: string;
  readonly subarea: string;
  /** Falso mientras nadie haya buscado: entonces no se dibuja la tabla. */
  readonly realizada: boolean;
  readonly total: number;
  readonly ocupaciones: readonly Ocupacion[];
}

export interface DatosDeOcupaciones {
  readonly entorno: EnvironmentName;
  /** Falso cuando la plataforma no tiene con qué consultar al agente. */
  readonly consultaDisponible: boolean;
  readonly consulta?: { readonly puesto: string; readonly centroDeCostos: string };
  readonly sugerencia?: SugerenciaDeOcupacion;
  readonly error?: string;
  readonly busqueda: BusquedaEnCatalogo;
  readonly subareas: readonly Subarea[];
  readonly tamanoDelCatalogo: number;
  /** Cuántas filas enseña la búsqueda como máximo. */
  readonly limiteDeBusqueda: number;
}

const ESTADO: Readonly<
  Record<
    EstadoDeSugerencia,
    { readonly rotulo: string; readonly insignia: string; readonly kpi: string }
  >
> = {
  sugerida: { rotulo: "Sugerida", insignia: "insignia insignia-completado", kpi: "kpi kpi-ok" },
  revisar: { rotulo: "A revisar", insignia: "insignia insignia-aviso", kpi: "kpi kpi-aviso" },
  sin_respuesta: {
    rotulo: "Sin respuesta",
    insignia: "insignia insignia-inactivo",
    kpi: "kpi kpi-alerta",
  },
};

const CONFIANZA: Readonly<Record<Confianza, string>> = {
  alta: "Alta",
  media: "Media",
  baja: "Baja",
};

/** Los nodos del agente, dichos como pasos. */
const PASOS: Readonly<Record<string, string>> = {
  principal_subareas: "Primer modelo · subárea",
  principal_ocupacion: "Primer modelo · ocupación",
  principal_validacion: "Primer modelo · comprobación",
  verificador_subareas: "Segundo modelo · subárea",
  verificador_ocupacion: "Segundo modelo · ocupación",
  verificador_validacion: "Segundo modelo · comprobación",
  conciliacion: "Resultado",
};

function cifra(valor: number): string {
  return valor.toLocaleString("es-MX");
}

function segundos(milisegundos: number): string {
  return `${(milisegundos / 1000).toFixed(1)} s`;
}

/** La razón del agente como oración: empieza con mayúscula. */
function oracion(texto: string): string {
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}

/** El modelo sin el proveedor ni la marca de plan: `nemotron-3-super-120b-a12b`. */
function modeloCorto(modelo: string): string {
  return modelo.replace(/^[^/]+\//u, "").replace(/:free$/u, "");
}

// ------------------------------------------------------------ la consulta

function renderConsulta(datos: DatosDeOcupaciones): Html {
  const puesto = datos.consulta?.puesto ?? "";
  const centro = datos.consulta?.centroDeCostos ?? "";
  return html`<section class="tarjeta" aria-labelledby="titulo-consulta">
    <div class="seccion-cabecera">
      <span class="capta-rotulo">Consulta</span>
      <h2 id="titulo-consulta">Consultar una ocupación</h2>
      <p>Dos modelos la resuelven por separado. Cuando eligen la misma clave, queda sugerida.</p>
    </div>
    ${datos.error ? html`<p class="aviso-error" role="alert">${datos.error}</p>` : ""}
    ${
      datos.consultaDisponible
        ? html`<form method="post" action="/ocupaciones" class="formulario-busqueda">
              <div class="campo-busqueda campo-busqueda-ancho">
                <label for="ocupacion-puesto" class="etiqueta-formulario">Puesto</label>
                <input
                  id="ocupacion-puesto"
                  name="puesto"
                  class="input-kcm"
                  value="${puesto}"
                  maxlength="120"
                  placeholder="Ej. *OPERARIO 2°"
                  required
                />
              </div>
              <div class="campo-busqueda campo-busqueda-ancho">
                <label for="ocupacion-centro" class="etiqueta-formulario">Centro de costos</label>
                <input
                  id="ocupacion-centro"
                  name="centroDeCostos"
                  class="input-kcm"
                  value="${centro}"
                  maxlength="120"
                  placeholder="Ej. HIGIENICOS"
                  required
                />
              </div>
              <div class="acciones-busqueda">
                <button type="submit">Consultar</button>
              </div>
            </form>
            <p class="texto-nota nota-bajo-tira">
              Cada consulta tarda cerca de un minuto y usa cuatro de las cincuenta consultas diarias
              del plan gratuito. Sólo viajan el puesto y el centro de costos.
            </p>`
        : html`<p class="texto-vacio">
            La consulta al agente no está disponible en esta instalación. La búsqueda en el catálogo
            sí.
          </p>`
    }
  </section>`;
}

function renderLeyenda(): Html {
  return html`<section class="tarjeta" aria-labelledby="titulo-leyenda">
    <div class="seccion-cabecera">
      <span class="capta-rotulo">Clasificar faltantes</span>
      <h2 id="titulo-leyenda">La copia del padrón</h2>
      <p>
        Clasificar faltantes, en el libro de Excel, escribe la clave de quien no la tiene en una
        copia del padrón. Cada celda lleva un color y una nota con el motivo.
      </p>
    </div>
    <ul class="lista-tablero">
      <li class="lista-fila">
        <span class="foco foco-verde"></span>
        <span class="lista-cuerpo">
          <span class="lista-titulo">Verde · sugerida</span>
          <span class="lista-pista">Los dos modelos eligieron la misma clave.</span>
        </span>
      </li>
      <li class="lista-fila">
        <span class="foco foco-ambar"></span>
        <span class="lista-cuerpo">
          <span class="lista-titulo">Amarillo · a revisar</span>
          <span class="lista-pista"
            >No coincidieron o alguno dudó; la nota trae las dos claves.</span
          >
        </span>
      </li>
      <li class="lista-fila">
        <span class="foco foco-rojo"></span>
        <span class="lista-cuerpo">
          <span class="lista-titulo">Rojo · sin respuesta</span>
          <span class="lista-pista">La celda queda vacía.</span>
        </span>
      </li>
    </ul>
    <p class="texto-nota nota-bajo-tira">
      Una celda vacía y sin color no cupo en la corrida; la siguiente la toma, empezando por los
      puestos con más trabajadores. Padrón de la semana envía la copia ya revisada.
    </p>
  </section>`;
}

// ------------------------------------------------------------ el resultado

function renderPropuesta(rotulo: string, propuesta: PropuestaValidada | null): Html {
  return html`<dt>${rotulo}</dt>
    <dd>
      ${
        propuesta
          ? html`${propuesta.codigo} ${propuesta.descripcion} ·
            ${CONFIANZA[propuesta.confianza].toLowerCase()}`
          : html`<span class="texto-atenuado">Sin propuesta</span>`
      }
    </dd>`;
}

function renderRecorrido(pasos: readonly PasoDeTraza[], sugerencia: SugerenciaDeOcupacion): Html {
  return html`<details class="plegable">
    <summary>Recorrido de la consulta</summary>
    <div class="tabla-contenedor">
      <table class="tabla-kcm">
        <thead>
          <tr>
            <th scope="col">Paso</th>
            <th scope="col">Modelo</th>
            <th scope="col">Tiempo</th>
            <th scope="col">Lo que decidió</th>
          </tr>
        </thead>
        <tbody>
          ${pasos.map(
            (paso) =>
              html`<tr>
                <td>${PASOS[paso.nodo] ?? paso.nodo}</td>
                <td class="celda-mono">${paso.modelo ? modeloCorto(paso.modelo) : "—"}</td>
                <td class="celda-numero">${paso.modelo ? segundos(paso.milisegundos) : "—"}</td>
                <td>${paso.nota}</td>
              </tr>`,
          )}
        </tbody>
      </table>
    </div>
    <p class="texto-nota">
      Versión del agente ${sugerencia.version} · configuración ${sugerencia.huella}
    </p>
  </details>`;
}

function renderResultado(sugerencia: SugerenciaDeOcupacion): Html {
  const estado = ESTADO[sugerencia.estado];
  const propuesta = sugerencia.sugerencia;
  return html`<section class="tarjeta" aria-labelledby="titulo-resultado">
    <div class="seccion-cabecera cabecera-fila">
      <h3 id="titulo-resultado">${sugerencia.caso.puesto} · ${sugerencia.caso.centroDeCostos}</h3>
      <span class="${estado.insignia}">${estado.rotulo}</span>
    </div>

    ${
      propuesta
        ? html`<div class="kpi-tira kpi-tira-compacta">
              <div class="${estado.kpi}">
                <span class="kpi-etiqueta">Clave de ocupación</span>
                <span class="kpi-dato"><span class="kpi-cifra">${propuesta.codigo}</span></span>
                <span class="kpi-pista">${propuesta.descripcion}</span>
              </div>
              <div class="kpi">
                <span class="kpi-etiqueta">Subárea del DC-3</span>
                <span class="kpi-dato"><span class="kpi-cifra">${propuesta.subarea}</span></span>
                <span class="kpi-pista">${propuesta.denominacionDeSubarea}</span>
              </div>
              <div class="kpi">
                <span class="kpi-etiqueta">Confianza</span>
                <span class="kpi-dato"
                  ><span class="kpi-cifra">${CONFIANZA[propuesta.confianza]}</span></span
                >
                <span class="kpi-pista"
                  >${propuesta === sugerencia.principal ? "Del primer modelo" : "Del segundo modelo"}</span
                >
              </div>
            </div>
            <p class="texto-nota"><strong>Motivo.</strong> ${propuesta.motivo}</p>
            <p class="texto-nota">
              <strong>${estado.rotulo}.</strong> ${oracion(sugerencia.razon)}
            </p>`
        : html`<p class="texto-vacio">Ningún modelo dejó una clave válida: ${sugerencia.razon}.</p>`
    }

    <dl class="definiciones">
      ${
        propuesta?.alternativa
          ? html`<dt>Alternativa</dt>
              <dd>${propuesta.alternativa.codigo} ${propuesta.alternativa.descripcion}</dd>`
          : ""
      }
      ${renderPropuesta("Primer modelo", sugerencia.principal)}
      ${renderPropuesta("Segundo modelo", sugerencia.verificador)}
    </dl>
    ${
      propuesta
        ? html`<div class="acciones-fila nota-bajo-tira">
            <a
              class="boton-pequeno boton-secundario"
              href="/ocupaciones?subarea=${propuesta.subarea}#titulo-catalogo"
              target="_blank"
              rel="noopener"
              >Ver las ocupaciones de ${propuesta.subarea} en otra pestaña</a
            >
          </div>`
        : ""
    }
    ${renderRecorrido(sugerencia.traza, sugerencia)}
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
    <div class="rejilla-dos">${renderConsulta(datos)} ${renderLeyenda()}</div>
    ${datos.sugerencia ? renderResultado(datos.sugerencia) : ""} ${renderCatalogo(datos)}
  `;

  return renderLayout({
    titulo: "Ocupaciones",
    subtitulo: "Clave del Catálogo Nacional de Ocupaciones para el DC-3",
    rutaActiva: "/ocupaciones",
    entorno: datos.entorno,
    estado: datos.consultaDisponible
      ? html`<span class="insignia insignia-completado">Consulta disponible</span>`
      : html`<span class="insignia insignia-inactivo">Consulta apagada</span>`,
    contenido,
  });
}
