import type { EnvironmentName } from "../../config/environment.ts";
import type { CargaRegistrada, HechoDeCarga, TipoDeCarga } from "../../domain/cargas/tipos.ts";
import type { UltimoLoteAplicado } from "../../domain/excel/tipos.ts";
import { momento } from "../kit/fechas.ts";
import { html, type Html } from "../kit/html.ts";
import { renderLayout } from "../layout.ts";

export interface DatosDeHistorial {
  readonly entorno: EnvironmentName;
  readonly asientos: readonly CargaRegistrada[];
  readonly enMemoria: boolean;
  readonly ultimoLote?: UltimoLoteAplicado;
}

const ROTULO_DE_TIPO: Readonly<Record<TipoDeCarga, string>> = {
  MATRIZ: "Matriz",
  PADRON: "Padrón",
};

const ROTULO_DE_HECHO: Readonly<Record<HechoDeCarga, string>> = {
  REVISADA: "Revisada",
  APLICADA: "Aplicada",
  RECHAZADA: "Rechazada",
};

const TONO_DE_HECHO: Readonly<Record<HechoDeCarga, string>> = {
  REVISADA: "insignia insignia-pendiente",
  APLICADA: "insignia insignia-completado",
  RECHAZADA: "insignia insignia-aviso",
};

const ROTULO_DE_CIFRA: Readonly<Record<string, string>> = {
  origen: "Origen",
  hoja: "Hoja leída",
  motivo: "Motivo",
  repetido: "Archivo ya aplicado",
  sinCambios: "Sin cambios",
  bloqueado: "Bloqueado",
  importId: "Carga",

  trabajadoresEnMatriz: "Trabajadores en la matriz",
  columnasEnMatriz: "Columnas de curso",
  fechasNuevas: "Fechas nuevas",
  fechasCorregidas: "Fechas corregidas",
  fechasRetiradas: "Fechas retiradas",
  conflictos: "Conflictos con liberaciones",
  trabajadoresNuevos: "Trabajadores nuevos",
  muestraNuevos: "Nóminas nuevas (muestra)",
  trabajadoresAusentes: "En la base y no en la matriz",
  muestraAusentes: "Nóminas ausentes (muestra)",
  cambiosDePuesto: "Cambios de puesto",
  cambiosDeArea: "Cambios de área",
  cambiosDeDepartamento: "Cambios de departamento",
  columnasNuevas: "Columnas nuevas",
  insertadas: "Fechas escritas",
  corregidas: "Fechas corregidas",
  retiradas: "Fechas retiradas",
  reactivadas: "Fechas reactivadas",

  activosEnArchivo: "Activos en el archivo",
  desconocidos: "Números no registrados en la base",
  ausentes: "Activos ausentes del archivo",
  muestraDesconocidos: "Nóminas no registradas (muestra)",
  puestosCambiados: "Cambios de puesto",
  curpPorEscribir: "CURP por escribir",
  curp: "CURP escritas",
  altasPorCorregir: "Fechas de alta por corregir",
  altas: "Fechas de alta escritas",
  induccionesNuevas: "Inducciones nuevas",
  inducciones: "Inducciones escritas",
  ocupaciones: "Claves de ocupación escritas",
  puestosNuevos: "Puestos fuera del catálogo",
};

function huella(sha256: string): string {
  return sha256 === "" ? "—" : sha256.slice(0, 12);
}

function valorLegible(valor: number | string | boolean): string {
  if (typeof valor === "boolean") return valor ? "Sí" : "No";
  return String(valor);
}

function renderEfecto(asiento: CargaRegistrada): Html {
  const conEfecto: string[] = [];
  const cifras =
    asiento.tipo === "MATRIZ"
      ? (["insertadas", "corregidas", "retiradas", "reactivadas", "fechasNuevas"] as const)
      : (["curp", "altas", "inducciones", "ocupaciones"] as const);

  for (const clave of cifras) {
    const valor = asiento.resumen[clave];
    if (typeof valor === "number" && valor > 0) {
      conEfecto.push(`${String(valor)} ${(ROTULO_DE_CIFRA[clave] ?? clave).toLowerCase()}`);
    }
  }

  if (asiento.hecho === "RECHAZADA") {
    const motivo = asiento.resumen["motivo"];
    return html`<span class="texto-atenuado"
      >No se aplicó${typeof motivo === "string" ? ` · ${motivo}` : ""}</span
    >`;
  }
  if (asiento.hecho !== "APLICADA") {
    return html`<span class="texto-atenuado">Sin efecto</span>`;
  }
  if (asiento.resumen["repetido"] === true) {
    return html`<span class="texto-atenuado">Ese archivo ya se había aplicado</span>`;
  }
  if (conEfecto.length === 0) {
    return html`<span class="texto-atenuado">Aplicada sin cambios</span>`;
  }
  return html`${conEfecto.join(" · ")}`;
}

function renderDetalle(asiento: CargaRegistrada): Html {
  const filas = Object.entries(asiento.resumen);
  if (filas.length === 0) return html`<span class="texto-atenuado">—</span>`;
  return html`<details>
    <summary>Ver detalle</summary>
    <div class="perfil-grilla-detalles">
      ${filas.map(
        ([clave, valor]) =>
          html`<div class="detalle-item detalle-item-menor">
            <span class="detalle-etiqueta">${ROTULO_DE_CIFRA[clave] ?? clave}</span>
            <span class="detalle-valor">${valorLegible(valor)}</span>
          </div>`,
      )}
      <div class="detalle-item detalle-item-menor">
        <span class="detalle-etiqueta">Huella completa</span>
        <span class="detalle-valor celda-mono"
          >${asiento.sha256 === "" ? "—" : asiento.sha256}</span
        >
      </div>
      ${
        asiento.solicitudId === undefined
          ? ""
          : html`<div class="detalle-item detalle-item-menor">
              <span class="detalle-etiqueta">Solicitud</span>
              <span class="detalle-valor celda-mono">${asiento.solicitudId}</span>
            </div>`
      }
    </div>
  </details>`;
}

function renderKpi(etiqueta: string, cifra: number | string, pista: string, tono = ""): Html {
  return html`<div class="kpi${tono === "" ? "" : ` kpi-${tono}`}">
    <span class="kpi-etiqueta">${etiqueta}</span>
    <span class="kpi-dato"><span class="kpi-cifra">${cifra}</span></span>
    <span class="kpi-pista">${pista}</span>
  </div>`;
}

export function renderLoadHistoryPage(datos: DatosDeHistorial): string {
  const aplicadas = datos.asientos.filter((asiento) => asiento.hecho === "APLICADA");
  const rechazadas = datos.asientos.filter((asiento) => asiento.hecho === "RECHAZADA");
  const ultimaMatriz = aplicadas.find((asiento) => asiento.tipo === "MATRIZ");
  const ultimoPadron = aplicadas.find((asiento) => asiento.tipo === "PADRON");

  const contenido = html`<section class="tarjeta">
    <div class="seccion-cabecera">
      <h2>Cargas registradas</h2>
      <p>Cada revisión y cada aplicación de la matriz y del padrón.</p>
    </div>

    ${
      datos.enMemoria
        ? html`<p class="texto-nota">
            Sin conexión con la base de datos: este historial es temporal y se pierde al reiniciar
            la plataforma.
          </p>`
        : html`<p class="texto-nota">Registro permanente: no se edita ni se borra.</p>`
    }

    <div class="kpi-tira">
      ${renderKpi(
        "Último lote de fechas",
        datos.ultimoLote ? momento(datos.ultimoLote.recibidoEn) : "—",
        datos.ultimoLote
          ? `${String(datos.ultimoLote.fechas)} ${datos.ultimoLote.fechas === 1 ? "fecha escrita" : "fechas escritas"} · ${datos.ultimoLote.equipo}`
          : "Sin lotes aplicados",
        datos.ultimoLote ? "ok" : "aviso",
      )}
      ${renderKpi(
        "Última matriz aplicada",
        ultimaMatriz ? momento(ultimaMatriz.ocurridoEn) : "—",
        ultimaMatriz ? ultimaMatriz.archivo : "Sin cargas registradas",
        ultimaMatriz ? "ok" : "aviso",
      )}
      ${renderKpi(
        "Último padrón aplicado",
        ultimoPadron ? momento(ultimoPadron.ocurridoEn) : "—",
        ultimoPadron ? ultimoPadron.archivo : "Sin cargas registradas",
        ultimoPadron ? "ok" : "aviso",
      )}
      ${renderKpi(
        "Aplicadas",
        aplicadas.length,
        "Con cambios en la plataforma",
        aplicadas.length === 0 ? "" : "ok",
      )}
      ${renderKpi(
        "Rechazadas",
        rechazadas.length,
        "Revisión vencida o conflicto con una liberación",
        rechazadas.length === 0 ? "ok" : "alerta",
      )}
    </div>

    <div class="tabla-contenedor">
      <table class="tabla-kcm">
        <thead>
          <tr>
            <th scope="col">Fecha</th>
            <th scope="col">Fuente</th>
            <th scope="col">Etapa</th>
            <th scope="col">Archivo</th>
            <th scope="col">Por</th>
            <th scope="col">Efecto</th>
            <th scope="col"><span class="solo-lectores">Detalle</span></th>
          </tr>
        </thead>
        <tbody>
          ${
            datos.asientos.length === 0
              ? html`<tr>
                  <td colspan="7" class="texto-vacio">Sin cargas registradas.</td>
                </tr>`
              : datos.asientos.map(
                  (asiento) =>
                    html`<tr>
                      <td class="celda-fecha">${momento(asiento.ocurridoEn)}</td>
                      <td>
                        <span class="insignia insignia-curso">${ROTULO_DE_TIPO[asiento.tipo]}</span>
                      </td>
                      <td>
                        <span class="${TONO_DE_HECHO[asiento.hecho]}"
                          >${ROTULO_DE_HECHO[asiento.hecho]}</span
                        >
                      </td>
                      <td title="Huella ${huella(asiento.sha256)}">${asiento.archivo}</td>
                      <td>${asiento.actor}</td>
                      <td>${renderEfecto(asiento)}</td>
                      <td>${renderDetalle(asiento)}</td>
                    </tr>`,
                )
          }
        </tbody>
      </table>
    </div>
    <p class="texto-nota nota-bajo-tira">
      <strong>Revisada:</strong> leída sin aplicar. <strong>Aplicada:</strong> con cambios en la
      plataforma. <strong>Rechazada:</strong> la revisión venció o chocó con una liberación.
    </p>
  </section>`;

  return renderLayout({
    titulo: "Historial de cargas",
    subtitulo: "Matriz y padrón · movimientos registrados",
    rutaActiva: "/cargas",
    entorno: datos.entorno,
    contenido,
  });
}
