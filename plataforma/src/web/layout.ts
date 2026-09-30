import type { DeploymentRole, EnvironmentName } from "../config/environment.ts";
import { hojaDeEstilos, simboloKcm } from "./estaticos.ts";
import { html, rawHtml, renderDocument, type Html } from "./kit/html.ts";

const NOMBRE_DE_LA_PLATAFORMA = "Plataforma KCM";

const ENTORNO_VISIBLE: Readonly<Record<EnvironmentName, string>> = {
  production: "",
  staging: "Entorno de ensayo",
  development: "Entorno de pruebas",
};

export type TemaVisual = "plataforma" | "quiosco";

export interface OpcionesDeDiseno {
  readonly titulo: string;
  readonly subtitulo: string;
  readonly entorno: EnvironmentName;
  readonly papel?: DeploymentRole;
  readonly contenido: Html;
  readonly tituloDocumento?: string;
  readonly estado?: Html;
  readonly tema?: TemaVisual;
  readonly rutaActiva?: string;
  readonly sinRail?: boolean;
  readonly recargaCada?: number;
  readonly modulo?: Html;
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
  readonly subpestanas?: readonly Subpestana[];
  readonly prefijo?: string;
}

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

const PANTALLAS_EXTERNAS: readonly { readonly nombre: string; readonly href: string }[] = [
  { nombre: "Quiosco de sala", href: "/quiosco" },
  { nombre: "Agenda pública", href: "/agenda" },
];

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
    nombre: "Ocupaciones",
    href: "/ocupaciones",
    icono: ICONO_OCUPACIONES,
  },
  {
    grupo: "Capacitación y DNC",
    nombre: "DC-3",
    href: "/dc3",
    icono: ICONO_DC3,
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
