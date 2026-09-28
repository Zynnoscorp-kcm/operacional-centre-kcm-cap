/**
 * Rutas de clasificación de ocupaciones con IA.
 *
 * El flujo es independiente de la base de datos:
 *
 * 1. El usuario sube el padrón (`sem NN CAP.xlsx`) en `POST /ocupaciones`.
 * 2. La plataforma lo lee, identifica a los trabajadores activos sin clave de
 *    ocupación y clasifica cada combinación única de puesto y centro de costos
 *    con el agente de IA.
 * 3. Las claves sugeridas se escriben de vuelta en las celdas del XLSX y el
 *    archivo modificado se devuelve para descarga.
 * 4. El usuario revisa el Excel fuera de línea. Si las claves son correctas,
 *    sube el archivo revisado a `/padron` para aplicarlo a la base.
 *
 * Nada se escribe en la base de datos desde aquí. La búsqueda en el catálogo
 * y la API JSON de un caso suelto se conservan.
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

import type { AppConfig } from "../config/environment.ts";
import { DomainError } from "../domain/comun/errores.ts";
import type { PadronLeido } from "../domain/padron/tipos.ts";
import { catalogoDeLaPlataforma, SUBAREAS_CNO } from "../domain/ocupaciones/catalogo.ts";
import { planearClasificacion } from "../domain/ocupaciones/plan.ts";
import { escribirCodigosEnXlsx } from "../domain/ocupaciones/escritor-xlsx.ts";
import type { ServicioDeOcupacionesPort } from "../domain/ocupaciones/servicio.ts";
import { MultipartError, parseMultipart } from "../server/multipart.ts";
import {
  renderOccupationsPage,
  type BusquedaEnCatalogo,
  type DatosDeOcupaciones,
} from "../web/pages/ocupaciones.ts";

const MAXIMO_DEL_ARCHIVO = 8 * 1024 * 1024;
const MAXIMO_EN_LA_NUBE = 4 * 1024 * 1024;
const LIMITE_DE_BUSQUEDA = 60;
const CASOS_POR_CORRIDA = 30;

const SIN_BUSQUEDA: BusquedaEnCatalogo = {
  texto: "",
  subarea: "",
  realizada: false,
  total: 0,
  ocupaciones: [],
};

function texto(valor: unknown): string {
  const uno: unknown = Array.isArray(valor) ? valor[0] : valor;
  return typeof uno === "string" ? uno.trim() : "";
}

function busquedaDe(consulta: Record<string, unknown>): BusquedaEnCatalogo {
  const palabras = texto(consulta.q).slice(0, 120);
  const pedida = texto(consulta.subarea);
  const subarea = SUBAREAS_CNO.some((item) => item.clave === pedida) ? pedida : "";
  if (palabras === "" && subarea === "") return SIN_BUSQUEDA;
  const { total, ocupaciones } = catalogoDeLaPlataforma().buscar({
    texto: palabras,
    subarea,
    limite: LIMITE_DE_BUSQUEDA,
  });
  return { texto: palabras, subarea, realizada: true, total, ocupaciones };
}

export function registerOccupationRoutes(
  app: FastifyInstance,
  deps: {
    readonly config: AppConfig;
    readonly extraer: (archivo: Buffer) => PadronLeido;
    readonly servicio?: () => Promise<ServicioDeOcupacionesPort>;
  },
): void {
  const pantalla = (
    respuesta: FastifyReply,
    codigo: number,
    datos: Partial<DatosDeOcupaciones>,
  ): FastifyReply =>
    respuesta
      .type("text/html; charset=utf-8")
      .code(codigo)
      .send(
        renderOccupationsPage({
          entorno: deps.config.environment,
          iaDisponible: deps.servicio !== undefined,
          subareas: SUBAREAS_CNO,
          tamanoDelCatalogo: catalogoDeLaPlataforma().tamano,
          limiteDeBusqueda: LIMITE_DE_BUSQUEDA,
          busqueda: SIN_BUSQUEDA,
          ...datos,
        }),
      );

  app.get("/ocupaciones", (peticion, respuesta) =>
    pantalla(respuesta, 200, {
      busqueda: busquedaDe((peticion.query ?? {}) as Record<string, unknown>),
    }),
  );

  app.post(
    "/ocupaciones",
    {
      bodyLimit: deps.config.role === "nube" ? MAXIMO_EN_LA_NUBE : MAXIMO_DEL_ARCHIVO,
      errorHandler: (error, _peticion, respuesta) => {
        if (error.statusCode !== 413) throw error;
        void pantalla(respuesta, 413, {
          error: "El archivo supera el tamaño máximo aceptado.",
        });
      },
    },
    async (peticion: FastifyRequest, respuesta: FastifyReply) => {
      if (!deps.servicio) {
        return pantalla(respuesta, 503, {
          error: "El agente de ocupaciones no está disponible en esta instalación.",
        });
      }

      let archivo;
      try {
        const formulario = parseMultipart(
          peticion.body as Buffer,
          peticion.headers["content-type"],
        );
        archivo = formulario.archivos.find((parte) => parte.campo === "archivo");
      } catch (error) {
        if (!(error instanceof MultipartError)) throw error;
        return pantalla(respuesta, 400, { error: "El formulario llegó incompleto o dañado." });
      }

      if (!archivo || archivo.contenido.length === 0) {
        return pantalla(respuesta, 400, { error: "No se recibió ningún archivo." });
      }

      let padron: PadronLeido;
      try {
        padron = deps.extraer(archivo.contenido);
      } catch (error) {
        const mensaje = error instanceof Error ? error.message : String(error);
        return pantalla(respuesta, 422, {
          error: `El archivo no tiene la forma del padrón semanal: ${mensaje}`,
        });
      }

      let plan;
      try {
        plan = planearClasificacion(padron, CASOS_POR_CORRIDA);
      } catch (error) {
        if (!(error instanceof DomainError)) throw error;
        return pantalla(respuesta, 422, { error: error.message });
      }

      if (plan.casos.length === 0) {
        return pantalla(respuesta, 200, {
          resultado: {
            faltantes: 0,
            consultados: 0,
            escritos: 0,
            conClave: plan.conClave,
            pendientes: plan.pendientes,
          },
        });
      }

      const servicio = await deps.servicio();
      const codigos: Array<{ casoId: string; codigo: string }> = [];
      let consultados = 0;

      for (const caso of plan.casos) {
        consultados += 1;
        try {
          const sugerencia = await servicio.sugerir({
            puesto: caso.puesto,
            centroDeCostos: caso.centroDeCostos,
          });
          if (sugerencia.sugerencia && sugerencia.estado === "sugerida") {
            codigos.push({ casoId: caso.id, codigo: sugerencia.sugerencia.codigo });
          }
        } catch {
          continue;
        }
      }

      peticion.log.info(
        { faltantes: plan.filas.length, consultados, escritos: codigos.length },
        "clasificación de ocupaciones completada",
      );

      if (codigos.length === 0) {
        return pantalla(respuesta, 200, {
          resultado: {
            faltantes: plan.filas.length,
            consultados,
            escritos: 0,
            conClave: plan.conClave,
            pendientes: plan.pendientes,
          },
        });
      }

      const { buffer } = escribirCodigosEnXlsx(
        archivo.contenido,
        plan.filas,
        codigos,
      );

      const nombre = archivo.nombre
        ? archivo.nombre.replace(/\.xlsx$/i, " — con ocupaciones.xlsx")
        : "padron-con-ocupaciones.xlsx";

      return respuesta
        .type("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
        .header("content-disposition", `attachment; filename="${nombre}"`)
        .code(200)
        .send(buffer);
    },
  );

  app.post("/api/ocupaciones/sugerir", async (peticion, respuesta) => {
    if (!deps.servicio) {
      return respuesta.code(503).send({
        error: {
          code: "IA_SIN_CONFIGURAR",
          message:
            "El agente de ocupaciones está apagado: no hay llave de ningún proveedor en el entorno.",
          requestId: String(peticion.id),
        },
      });
    }
    const servicio = await deps.servicio();
    const inicio = Date.now();
    const sugerencia = await servicio.sugerir(peticion.body);
    peticion.log.info(
      {
        estado: sugerencia.estado,
        pasos: sugerencia.traza.length,
        milisegundos: Date.now() - inicio,
        version: sugerencia.version,
      },
      "ocupación sugerida",
    );
    return respuesta.send(sugerencia);
  });
}
