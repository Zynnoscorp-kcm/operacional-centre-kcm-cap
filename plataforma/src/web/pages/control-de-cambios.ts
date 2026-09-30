import type { EnvironmentName } from "../../config/environment.ts";
import type { CargaRegistrada, TipoDeCarga } from "../../domain/cargas/tipos.ts";
import { momento } from "../kit/fechas.ts";
import { renderPanelDeCambios, type CifraDelPanel } from "../kit/panel-de-cambios.ts";
import { html, type Html } from "../kit/html.ts";
import { renderLayout } from "../layout.ts";

const VIGENCIA_MS = 30 * 60 * 1000;

export type EstadoDelAviso = "PENDIENTE" | "APLICADA" | "RECHAZADA" | "SIN_APLICAR";

export interface AvisoDeCambio {
  readonly envio: CargaRegistrada;
  readonly estado: EstadoDelAviso;
  readonly desenlace?: CargaRegistrada;
}

export interface DatosDeControl {
  readonly entorno: EnvironmentName;
  readonly avisos: readonly AvisoDeCambio[];
}

export function armarAvisos(asientos: readonly CargaRegistrada[], ahora: Date): AvisoDeCambio[] {
  const cronologico = [...asientos].reverse();
  const avisos: AvisoDeCambio[] = [];
  const pendientePorFuente = new Set<TipoDeCarga>();

  for (let i = cronologico.length - 1; i >= 0; i--) {
    const envio = cronologico[i];
    if (!envio || envio.hecho !== "REVISADA") continue;
    const desenlace = cronologico
      .slice(i + 1)
      .find(
        (otro) =>
          otro.tipo === envio.tipo &&
          otro.hecho !== "REVISADA" &&
          otro.solicitudId !== undefined &&
          otro.solicitudId === envio.solicitudId,
      );
    let estado: EstadoDelAviso;
    if (desenlace) {
      estado = desenlace.hecho === "APLICADA" ? "APLICADA" : "RECHAZADA";
    } else if (
      !pendientePorFuente.has(envio.tipo) &&
      ahora.getTime() - new Date(envio.ocurridoEn).getTime() < VIGENCIA_MS
    ) {
      estado = "PENDIENTE";
    } else {
      estado = "SIN_APLICAR";
    }
    pendientePorFuente.add(envio.tipo);
    avisos.push({ envio, estado, ...(desenlace ? { desenlace } : {}) });
  }
  return avisos;
}

const ROTULO_DE_ESTADO: Readonly<Record<EstadoDelAviso, string>> = {
  PENDIENTE: "Espera aprobación",
  APLICADA: "Aplicada",
  RECHAZADA: "Rechazada",
  SIN_APLICAR: "No se aplicó",
};

const TONO_DE_ESTADO: Readonly<Record<EstadoDelAviso, string>> = {
  PENDIENTE: "insignia insignia-pendiente",
  APLICADA: "insignia insignia-completado",
  RECHAZADA: "insignia insignia-aviso",
  SIN_APLICAR: "insignia",
};

function cifra(asiento: CargaRegistrada, clave: string): number {
  const valor = asiento.resumen[clave];
  return typeof valor === "number" ? valor : 0;
}

function cifrasDe(envio: CargaRegistrada): CifraDelPanel[] {
  if (envio.tipo === "MATRIZ") {
    return [
      { valor: cifra(envio, "trabajadoresNuevos"), rotulo: "entran", tono: "alta" },
      { valor: cifra(envio, "trabajadoresAusentes"), rotulo: "ya no están", tono: "baja" },
      {
        valor:
          cifra(envio, "cambiosDePuesto") +
          cifra(envio, "cambiosDeArea") +
          cifra(envio, "cambiosDeDepartamento"),
        rotulo: "cambian de puesto o área",
        tono: "cambio",
      },
      { valor: cifra(envio, "fechasNuevas"), rotulo: "fechas nuevas", tono: "alta" },
      { valor: cifra(envio, "fechasCorregidas"), rotulo: "fechas cambian", tono: "cambio" },
      { valor: cifra(envio, "fechasRetiradas"), rotulo: "fechas se quitan", tono: "baja" },
      { valor: cifra(envio, "columnasNuevas"), rotulo: "cursos nuevos", tono: "alta" },
    ];
  }
  return [
    { valor: cifra(envio, "desconocidos"), rotulo: "no están en la base", tono: "alta" },
    { valor: cifra(envio, "ausentes"), rotulo: "ya no vienen", tono: "baja" },
    { valor: cifra(envio, "puestosCambiados"), rotulo: "cambian de puesto", tono: "cambio" },
    { valor: cifra(envio, "curpPorEscribir"), rotulo: "CURP nuevas", tono: "alta" },
    { valor: cifra(envio, "altasPorCorregir"), rotulo: "fechas de alta cambian", tono: "cambio" },
    { valor: cifra(envio, "induccionesNuevas"), rotulo: "inducciones nuevas", tono: "alta" },
  ];
}

function renderAviso(aviso: AvisoDeCambio): Html {
  const { envio, estado, desenlace } = aviso;
  const fuente = envio.tipo === "MATRIZ" ? "Matriz completa" : "Padrón semanal";
  const destino = envio.tipo === "MATRIZ" ? "/matriz" : "/padron";
  return renderPanelDeCambios({
    titulo: `${fuente} · ${momento(envio.ocurridoEn)}`,
    cifras: cifrasDe(envio),
    detalle: undefined,
    rotuloAltas: "",
    rotuloBajas: "",
    pie: html`<p class="panel-cambios-pie">
      <span class="${TONO_DE_ESTADO[estado]}">${ROTULO_DE_ESTADO[estado]}</span>
      ${envio.archivo}${
        desenlace
          ? ` · ${desenlace.hecho === "APLICADA" ? "aplicado" : "rechazado"} ${momento(desenlace.ocurridoEn)}`
          : ""
      }
      ${
        estado === "PENDIENTE"
          ? html`<a class="boton-primario" href="${destino}">Ver cambios y aplicar</a>`
          : ""
      }
    </p>`,
  });
}

function renderKpi(etiqueta: string, valor: number, pista: string, tono = ""): Html {
  return html`<div class="kpi${tono === "" ? "" : ` kpi-${tono}`}">
    <span class="kpi-etiqueta">${etiqueta}</span>
    <span class="kpi-dato"><span class="kpi-cifra">${valor}</span></span>
    <span class="kpi-pista">${pista}</span>
  </div>`;
}

export function renderChangeControlPage(datos: DatosDeControl): string {
  const pendientes = datos.avisos.filter((aviso) => aviso.estado === "PENDIENTE").length;
  const matrices = datos.avisos.filter((aviso) => aviso.envio.tipo === "MATRIZ").length;
  const padrones = datos.avisos.filter((aviso) => aviso.envio.tipo === "PADRON").length;

  const contenido = html`<div class="kpi-tira">
      ${renderKpi(
        "Esperan aprobación",
        pendientes,
        "Envíos con revisión abierta",
        pendientes > 0 ? "aviso" : "ok",
      )}
      ${renderKpi("Matrices completas", matrices, "Envíos registrados")}
      ${renderKpi("Padrones", padrones, "Envíos registrados")}
    </div>
    ${
      datos.avisos.length === 0
        ? html`<section class="tarjeta">
            <p class="texto-nota">
              Todavía no hay envíos completos. Cada matriz completa y cada padrón semanal enviados
              desde Excel aparecen aquí con sus cambios.
            </p>
          </section>`
        : datos.avisos.map(renderAviso)
    }`;

  return renderLayout({
    titulo: "Control de cambios",
    subtitulo: "Envíos completos de la matriz y del padrón",
    rutaActiva: "/cambios",
    entorno: datos.entorno,
    contenido,
  });
}
