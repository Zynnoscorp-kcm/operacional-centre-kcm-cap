/**
 * Envoltura común de la consola central.
 *
 * El armazón tiene dos piezas y nada más: un menú lateral angosto a la
 * izquierda y un lienzo a la derecha que ocupa todo lo que sobra. El lienzo
 * es la plataforma —barra de título, sub-pestañas y contenido—; el lateral sólo
 * lleva a sitios. Ninguna pantalla escribe `<!doctype>` por su cuenta ni vuelve
 * a dibujar el fondo.
 *
 * ── Por qué así ───────────────────────────────────────────────────────────
 *
 * El armazón anterior era un panel de vidrio esmerilado centrado sobre un fondo
 * de haces diagonales, con un rail de veinte entradas planas en seis grupos.
 * Dos cosas no funcionaban: el vidrio y los haces se leían por detrás de las
 * tablas de ocho y nueve columnas, y veinte entradas obligaban a recorrer el
 * rail entero para encontrar una. Ahora el fondo es plano, las tarjetas son
 * blancas, y las veinte funciones viven en once secciones: lo que antes eran
 * entradas hermanas —las cuatro vistas de trabajadores, las dos cargas, las
 * cuatro auditorías, las dos de base— son hoy sub-pestañas dentro de su sección.
 * No se retiró ninguna función; se dejaron de listar todas a la vez.
 */

import type { DeploymentRole, EnvironmentName } from "../config/environment.ts";
import { hojaDeEstilos, simboloKcm } from "./estaticos.ts";
import { html, rawHtml, renderDocument, type Html } from "./kit/html.ts";

const NOMBRE_DE_LA_PLATAFORMA = "Plataforma KCM";

/**
 * Cómo se dice el entorno en la barra. En producción no se dice nada: es lo
 * normal. En los otros dos se avisa en palabras, para que nadie confunda una
 * instalación de pruebas con la real.
 */
const ENTORNO_VISIBLE: Readonly<Record<EnvironmentName, string>> = {
  production: "",
  staging: "Entorno de ensayo",
  development: "Entorno de pruebas",
};

/** Oscuro para la sala y la agenda pública; claro para la consola central. */
export type TemaVisual = "plataforma" | "quiosco";

export interface OpcionesDeDiseno {
  /** Encabezado visible de la pantalla. */
  readonly titulo: string;
  readonly subtitulo: string;
  readonly entorno: EnvironmentName;
  /**
   * En qué máquina está parada la persona. Se enseña porque el reparto entre
   * nube y equipo del departamento sólo es manejable si se ve antes de
   * intentar algo: quien abre `/padron` un lunes necesita saber, sin leer
   * documentación, si está en la computadora que puede cargar el archivo.
   *
   * Opcional para no obligar a las veinte pantallas a declararlo: lo pasan las
   * que tienen operaciones repartidas.
   */
  readonly papel?: DeploymentRole;
  readonly contenido: Html;
  /**
   * Título del documento. Por omisión es «título · Plataforma KCM»; una
   * pantalla lo fija a mano cuando la pestaña necesita otro rótulo.
   */
  readonly tituloDocumento?: string;
  /** Se coloca a la derecha de la barra de título; la pantalla decide qué va ahí. */
  readonly estado?: Html;
  /** Por omisión, la consola central. */
  readonly tema?: TemaVisual;
  /**
   * Ruta de la pantalla, para marcar el menú y la sub-pestaña. Se compara con el
   * `href` de cada sección y de cada sub-pestaña.
   */
  readonly rutaActiva?: string;
  /**
   * Deja el lienzo sin menú lateral y a lo ancho completo.
   *
   * Cambia también la clase del cuerpo, y no es un detalle: la rejilla de la
   * consola declara dos columnas —244 px para el menú y el resto para el
   * lienzo—, así que al quitar el menú sin decírselo a la rejilla el lienzo
   * caía en la columna de 244 px y la pantalla entera se dibujaba dentro de esa
   * franja. Con `consola-sola` la rejilla pasa a una sola columna.
   */
  readonly sinRail?: boolean;
  /**
   * Segundos entre recargas automáticas de la pantalla.
   *
   * Sólo lo enciende el tablero de inicio, y por eso no viene por omisión: una
   * pantalla con formulario que se recarga sola borra lo que alguien esté
   * escribiendo —es la razón por la que la agenda pública lo rechazó—. Inicio no
   * tiene un solo campo, así que ahí es gratis, y es lo que permite ver que una
   * sesión se cerró en la sala sin ir a recargar a mano.
   *
   * Es un `<meta http-equiv="refresh">` y no un guion porque la consola declara
   * `default-src 'none'` sin `script-src`.
   */
  readonly recargaCada?: number;
  /**
   * Barra propia de un módulo, en lugar de la tira genérica de sub-pestañas.
   *
   * La usan las secciones que son una aplicación dentro de la consola —hoy,
   * DC-3—: su navegación lleva iconos, cifras y un buscador que la tira
   * genérica no sabe dibujar. El lateral sigue encendiendo la sección por su
   * prefijo.
   */
  readonly modulo?: Html;
  /**
   * Dirección que el navegador descarga al llegar la página.
   *
   * Es un `<meta http-equiv="refresh">` hacia una respuesta marcada como
   * adjunto: el navegador la baja y la página se queda donde está. Lo usa la
   * emisión, que vuelve a la lista con sus filtros y deja que el documento baje
   * solo; sin guiones no hay otra manera de hacer las dos cosas con un clic.
   * Excluye `recargaCada`: sólo cabe una instrucción de ese tipo por documento.
   */
  readonly descarga?: string;
}

interface Subpestana {
  readonly nombre: string;
  readonly href: string;
}

interface SeccionDeMenu {
  readonly grupo: string;
  readonly nombre: string;
  readonly href: string;
  readonly icono: Html;
  /**
   * Las pantallas hermanas de la sección. Se dibujan como tira de pestañas
   * arriba del contenido, no como entradas del lateral: son la misma función
   * mirada de varias maneras.
   */
  readonly subpestanas?: readonly Subpestana[];
  /**
   * Las rutas que empiezan así también encienden la sección. Lo declaran los
   * módulos con barra propia, cuyas pantallas no son sub-pestañas del armazón.
   */
  readonly prefijo?: string;
}

/**
 * Iconos. Son trazos de 20×20 en `currentColor`, escritos a mano y en línea:
 * la política de contenido no admite un paquete de iconos por CDN, y un `<svg>`
 * en el marcado no es un script ni una hoja externa. Ninguno lleva atributo
 * `style`, que la política tampoco dejaría aplicar.
 */
function icono(trazo: string): Html {
  return rawHtml(
    '<svg viewBox="0 0 20 20" width="19" height="19" fill="none" stroke="currentColor" ' +
      'stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" ' +
      `focusable="false">${trazo}</svg>`,
  );
}

const ICONO_INICIO = icono(
  '<path d="M3 9.4 10 3.4l7 6"/><path d="M4.9 8.6V16a1 1 0 0 0 1 1h8.2a1 1 0 0 0 1-1V8.6"/>',
);
const ICONO_SESIONES = icono(
  '<rect x="3" y="4.6" width="14" height="12.4" rx="2.4"/><path d="M6.9 2.9v3.4M13.1 2.9v3.4M3 8.7h14"/><path d="M7.7 12.4l1.6 1.7 3.2-3.4"/>',
);
const ICONO_SALAS = icono(
  '<path d="M5.4 3.3h9.2v13.3H5.4z"/><path d="M11.9 10.1v1.1"/><path d="M3.4 16.6h13.2"/>',
);
const ICONO_PRELIBERACION = icono(
  '<path d="M7.6 3.4h4.8v2.2H7.6z"/><path d="M12.4 4.5h2a1.4 1.4 0 0 1 1.4 1.4v9.7a1.4 1.4 0 0 1-1.4 1.4H5.6a1.4 1.4 0 0 1-1.4-1.4V5.9a1.4 1.4 0 0 1 1.4-1.4h2"/><path d="M7.4 11.4l1.7 1.7 3.5-3.6"/>',
);
const ICONO_LIBERACION = icono(
  '<path d="M10 12.9V3.6"/><path d="M6.5 7.1 10 3.5l3.5 3.6"/><path d="M4.1 12.4v2.7a1.4 1.4 0 0 0 1.4 1.4h9a1.4 1.4 0 0 0 1.4-1.4v-2.7"/>',
);
const ICONO_TRABAJADORES = icono(
  '<circle cx="8" cy="7.3" r="2.9"/><path d="M3.3 16.3a4.8 4.8 0 0 1 9.4 0"/><path d="M13.4 4.9a2.7 2.7 0 0 1 0 5.3"/><path d="M14.3 12.1a4.3 4.3 0 0 1 2.4 3.4"/>',
);
const ICONO_CARGAS = icono(
  '<ellipse cx="10" cy="5.2" rx="6" ry="2.4"/><path d="M4 5.2v9.5c0 1.3 2.7 2.4 6 2.4s6-1.1 6-2.4V5.2"/><path d="M4 9.9c0 1.3 2.7 2.4 6 2.4s6-1.1 6-2.4"/>',
);
const ICONO_DC3 = icono(
  '<path d="M11.4 2.9H6.3a1.4 1.4 0 0 0-1.4 1.4v11.4a1.4 1.4 0 0 0 1.4 1.4h7.4a1.4 1.4 0 0 0 1.4-1.4V6.5z"/><path d="M11.4 2.9v3.6h3.7"/><path d="M7.6 11h4.8M7.6 13.6h3.2"/>',
);
const ICONO_OCUPACIONES = icono(
  '<rect x="3" y="6.2" width="14" height="10.4" rx="2"/><path d="M7.4 6.2V4.8a1.4 1.4 0 0 1 1.4-1.4h2.4a1.4 1.4 0 0 1 1.4 1.4v1.4"/><path d="M3 10.9h14"/><path d="M9.2 10.9v1.4h1.6v-1.4"/>',
);
const ICONO_EXCEL = icono(
  '<path d="M3.4 7.6h13.2M13.6 4.8l3 2.8-3 2.8"/><path d="M16.6 13.2H3.4M6.4 10.4l-3 2.8 3 2.8"/>',
);
const ICONO_AUDITORIA = icono(
  '<path d="M10 2.9 4.7 5v4.6c0 3.2 2.2 6 5.3 7.4 3.1-1.4 5.3-4.2 5.3-7.4V5z"/><path d="M7.8 9.8l1.7 1.7 3.1-3.3"/>',
);
const ICONO_BASE = icono(
  '<rect x="3.2" y="3.7" width="13.6" height="5" rx="1.6"/><rect x="3.2" y="11.3" width="13.6" height="5" rx="1.6"/><path d="M6.3 6.2h.6M6.3 13.8h.6"/>',
);
const ICONO_SALIR = icono(
  '<path d="M12.2 5.5V4.2a1.4 1.4 0 0 0-1.4-1.4H5.5a1.4 1.4 0 0 0-1.4 1.4v11.6a1.4 1.4 0 0 0 1.4 1.4h5.3a1.4 1.4 0 0 0 1.4-1.4v-1.3"/><path d="M8.8 10h8M14.4 7.4 17 10l-2.6 2.6"/>',
);
const ICONO_PANTALLA = icono(
  '<rect x="2.8" y="4" width="14.4" height="9.6" rx="1.8"/><path d="M7.2 17h5.6M10 13.6V17"/>',
);

/**
 * Las dos pantallas que no son secciones de la consola: corren en otra
 * computadora y se abren, no se administran. Van al pie del lateral y no en el
 * menú porque nadie «navega» a ellas desde su escritorio; se dejan a mano
 * porque al retirar la retícula de la portada se quedaron sin puerta.
 */
const PANTALLAS_EXTERNAS: readonly { readonly nombre: string; readonly href: string }[] = [
  { nombre: "Quiosco de sala", href: "/quiosco" },
  { nombre: "Agenda pública", href: "/agenda" },
];

/**
 * Las doce secciones de la consola, en el orden en que se recorren durante una
 * semana de trabajo: primero lo que se opera a diario, luego lo que cierra una
 * sesión, luego el padrón y sus tableros, y al final las dos consolas técnicas.
 *
 * El quiosco de sala no está aquí a propósito: corre en la computadora de la
 * sala de capacitación, es una pantalla externa y no una sección a la que se
 * navegue desde el escritorio. Sale de `/quiosco` con su propia envoltura.
 */
const MENU: readonly SeccionDeMenu[] = [
  { grupo: "Operación", nombre: "Inicio", href: "/", icono: ICONO_INICIO },
  { grupo: "Operación", nombre: "Sesiones", href: "/sesiones", icono: ICONO_SESIONES },
  { grupo: "Operación", nombre: "Salas", href: "/salas", icono: ICONO_SALAS },
  {
    grupo: "Cierre y liberación",
    nombre: "Preliberación",
    href: "/preliberacion",
    icono: ICONO_PRELIBERACION,
  },
  {
    grupo: "Cierre y liberación",
    nombre: "Liberación",
    href: "/liberacion",
    icono: ICONO_LIBERACION,
  },
  {
    grupo: "Cierre y liberación",
    nombre: "Auditoría",
    href: "/auditoria",
    icono: ICONO_AUDITORIA,
    subpestanas: [
      { nombre: "Operación", href: "/auditoria" },
      { nombre: "Sesiones", href: "/auditoria/sesiones" },
      { nombre: "Salas", href: "/auditoria/salas" },
      { nombre: "Liberaciones", href: "/auditoria/liberaciones" },
    ],
  },
  {
    grupo: "Capacitación y DNC",
    nombre: "Trabajadores",
    href: "/trabajadores",
    icono: ICONO_TRABAJADORES,
    subpestanas: [
      { nombre: "Directorio", href: "/trabajadores" },
      { nombre: "Cobertura por curso", href: "/trabajadores/cursos" },
      { nombre: "Cobertura DNC", href: "/trabajadores/cobertura" },
      { nombre: "Departamentos", href: "/trabajadores/departamentos" },
    ],
  },
  {
    grupo: "Capacitación y DNC",
    nombre: "Cargas",
    href: "/matriz",
    icono: ICONO_CARGAS,
    // Van juntas y en el orden en que se usan: la matriz trae el historial de
    // fechas, el padrón la CURP y el alta. Sincronía va después de las dos
    // porque coteja lo que ambas dejaron aplicado. Control de cambios avisa de
    // cada envío completo y el historial va al final porque se consulta
    // después, cuando hay que explicar qué entró y de dónde.
    subpestanas: [
      { nombre: "Barrido de matriz", href: "/matriz" },
      { nombre: "Padrón semanal", href: "/padron" },
      { nombre: "Sincronía", href: "/sincronia" },
      { nombre: "Control de cambios", href: "/cambios" },
      { nombre: "Historial", href: "/cargas" },
    ],
  },
  {
    grupo: "Capacitación y DNC",
    // Antes de DC-3 porque la alimenta: la clave de ocupación es el recuadro
    // que le faltaba a la constancia.
    nombre: "Ocupaciones",
    href: "/ocupaciones",
    icono: ICONO_OCUPACIONES,
  },
  {
    grupo: "Capacitación y DNC",
    nombre: "DC-3",
    href: "/dc3",
    icono: ICONO_DC3,
    // Sin sub-pestañas: DC-3 es un módulo con barra propia —secciones, la cifra
    // de lo que falta emitir y el buscador del expediente—, que dibuja cada
    // una de sus pantallas. El prefijo mantiene encendida la sección.
    prefijo: "/dc3",
  },
  { grupo: "Sistema", nombre: "Conexión Excel", href: "/excel", icono: ICONO_EXCEL },
  {
    grupo: "Sistema",
    nombre: "Base de datos",
    href: "/base",
    icono: ICONO_BASE,
    subpestanas: [
      { nombre: "Explorador", href: "/base" },
      { nombre: "Campos declarados", href: "/campos" },
    ],
  },
];

export function renderLayout(opciones: OpcionesDeDiseno): string {
  const tituloDocumento =
    opciones.tituloDocumento ?? `${opciones.titulo} · ${NOMBRE_DE_LA_PLATAFORMA}`;
  const tema = opciones.tema ?? "plataforma";
  const conMenu = !opciones.sinRail;
  const seccion = seccionActiva(opciones.rutaActiva);

  const documento = html`<html lang="es-MX" class="${claseDeTema(tema)}">
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <meta name="robots" content="noindex, nofollow" />
      <meta name="theme-color" content="${tema === "quiosco" ? "#0a0a0c" : "#eef1f7"}" />
      ${
        opciones.descarga
          ? html`<meta http-equiv="refresh" content="1;url=${opciones.descarga}" />`
          : opciones.recargaCada
            ? html`<meta http-equiv="refresh" content="${opciones.recargaCada}" />`
            : ""
      }
      <title>${tituloDocumento}</title>
      <link rel="stylesheet" href="${hojaDeEstilos.ruta}" />
      <link rel="icon" href="${simboloKcm.ruta}" type="${simboloKcm.tipo}" />
    </head>
    <body class="consola${conMenu ? "" : " consola-sola"}">
      <a class="salto-contenido" href="#contenido">Saltar al contenido</a>
      ${conMenu ? renderMenu(seccion) : ""}
      <div class="lienzo">
        <header class="barra">
          <div class="barra-identidad">
            <h1 class="barra-titulo">${opciones.titulo}</h1>
            <p class="barra-lede">${opciones.subtitulo}</p>
          </div>
          <div class="barra-acciones">
            ${opciones.estado ?? ""}
            ${
              ENTORNO_VISIBLE[opciones.entorno]
                ? html`<span class="insignia insignia-entorno"
                    >${ENTORNO_VISIBLE[opciones.entorno]}</span
                  >`
                : ""
            }
            ${
              opciones.papel === "nube"
                ? html`<span
                    class="insignia insignia-aviso"
                    title="Las cargas pesadas se hacen en la computadora del departamento"
                    >En la nube</span
                  >`
                : opciones.papel === "local"
                  ? html`<span
                      class="insignia insignia-completado"
                      title="Esta computadora puede hacer las cargas pesadas"
                      >Equipo del departamento</span
                    >`
                  : ""
            }
            <a class="barra-icono" href="/salir" title="Cerrar sesión">
              ${ICONO_SALIR}<span class="solo-lectores">Cerrar sesión</span>
            </a>
          </div>
        </header>
        ${
          opciones.modulo ??
          (seccion?.subpestanas ? renderSubpestanas(seccion, opciones.rutaActiva) : "")
        }
        <main class="contenido" id="contenido">${opciones.contenido}</main>
      </div>
    </body>
  </html>`;

  return renderDocument(documento);
}

function claseDeTema(tema: TemaVisual): string {
  return tema === "quiosco" ? "tema-quiosco" : "tema-plataforma";
}

/**
 * La sección a la que pertenece una ruta. Una sub-pestaña marca a su sección,
 * de modo que estar en `/trabajadores/departamentos` deja encendido «Trabajadores»
 * en el lateral y «Comparativa de planta» en la tira de arriba.
 */
function seccionActiva(rutaActiva: string | undefined): SeccionDeMenu | undefined {
  if (rutaActiva === undefined) return undefined;
  return MENU.find(
    (seccion) =>
      seccion.href === rutaActiva ||
      (seccion.subpestanas ?? []).some((pestana) => pestana.href === rutaActiva) ||
      (seccion.prefijo !== undefined && rutaActiva.startsWith(`${seccion.prefijo}/`)),
  );
}

function renderMenu(activa: SeccionDeMenu | undefined): Html {
  const grupos = new Map<string, SeccionDeMenu[]>();
  for (const seccion of MENU) {
    const existentes = grupos.get(seccion.grupo);
    if (existentes) existentes.push(seccion);
    else grupos.set(seccion.grupo, [seccion]);
  }

  const secciones = [...grupos].map(
    ([grupo, entradas]) => html`
      <p class="lateral-grupo">${grupo}</p>
      ${entradas.map((entrada) => renderEntradaDeMenu(entrada, activa))}
    `,
  );

  return html`<aside class="lateral">
    <a class="lateral-marca" href="/">
      <img class="lateral-simbolo" src="${simboloKcm.ruta}" alt="" width="30" height="30" />
      <span class="lateral-marca-texto">
        <strong>Plataforma KCM</strong>
        <span>Kimberly-Clark de México</span>
      </span>
    </a>
    <nav class="lateral-nav" aria-label="Secciones de la plataforma">${secciones}</nav>
    <nav class="lateral-pie" aria-label="Pantallas de sala">
      <p class="lateral-grupo">Pantallas de sala</p>
      ${PANTALLAS_EXTERNAS.map(
        (pantalla) =>
          html`<a class="lateral-enlace" href="${pantalla.href}">
            <span class="lateral-icono">${ICONO_PANTALLA}</span>
            <span class="lateral-nombre">${pantalla.nombre}</span>
          </a>`,
      )}
    </nav>
  </aside>`;
}

function renderEntradaDeMenu(entrada: SeccionDeMenu, activa: SeccionDeMenu | undefined): Html {
  const esActiva = activa !== undefined && activa.href === entrada.href;
  return html`<a
    class="lateral-enlace"
    href="${entrada.href}"
    ${esActiva ? html`aria-current="page"` : ""}
  >
    <span class="lateral-icono">${entrada.icono}</span>
    <span class="lateral-nombre">${entrada.nombre}</span>
  </a>`;
}

function renderSubpestanas(seccion: SeccionDeMenu, rutaActiva: string | undefined): Html {
  const pestanas = (seccion.subpestanas ?? []).map((pestana) => {
    const esActiva = pestana.href === rutaActiva;
    return html`<a
      class="subpestana"
      href="${pestana.href}"
      ${esActiva ? html`aria-current="page"` : ""}
      >${pestana.nombre}</a
    >`;
  });

  return html`<nav class="subpestanas" aria-label="Vistas de ${seccion.nombre}">${pestanas}</nav>`;
}
