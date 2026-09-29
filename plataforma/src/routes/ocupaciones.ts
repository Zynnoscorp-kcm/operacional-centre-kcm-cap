/**
 * Rutas de clasificación de ocupaciones con IA.
 *
 * El flujo es independiente de la base de datos:
 *
 * 1. El usuario sube el padrón en `GET /ocupaciones`.
 * 2. El JS intercepta el envío, lo manda a `POST /api/ocupaciones/clasificar`
 *    que responde con Server-Sent Events reportando el avance caso por caso.
 * 3. Al final, el evento `resultado` lleva un `descargaId` que el JS usa para
 *    disparar `GET /api/ocupaciones/descarga/:id` y bajar el Excel con las
 *    claves llenas.
 * 4. Sin JS (fallback), el `POST /ocupaciones` clásico hace lo mismo de un
 *    tirón y devuelve el archivo, aunque sin barra de avance.
 *
 * Nada se escribe en la base de datos desde aquí.
 */

import { randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

import type { AppConfig } from "../config/environment.ts";
import { DomainError } from "../domain/comun/errores.ts";
import type { PadronLeido } from "../domain/padron/tipos.ts";
import { catalogoDeLaPlataforma, SUBAREAS_CNO } from "../domain/ocupaciones/catalogo.ts";
import { planearClasificacion } from "../domain/ocupaciones/plan.ts";
import { escribirCodigosEnXlsx } from "../domain/ocupaciones/escritor-xlsx.ts";
import type { ServicioDeOcupacionesPort } from "../domain/ocupaciones/servicio.ts";
import type { HojaDeEstilos } from "../web/estaticos.ts";
import { MultipartError, parseMultipart } from "../server/multipart.ts";
import {
  renderOccupationsPage,
  type BusquedaEnCatalogo,
  type DatosDeOcupaciones,
} from "../web/pages/ocupaciones.ts";

const MAXIMO_DEL_ARCHIVO = 8 * 1024 * 1024;
const MAXIMO_EN_LA_NUBE = 4 * 1024 * 1024;
const LIMITE_DE_BUSQUEDA = 60;
const CASOS_POR_CORRIDA = 15;

const POLITICA_DE_OCUPACIONES = [
  "default-src 'none'",
  "script-src 'self'",
  "connect-src 'self'",
  "style-src 'self'",
  "img-src 'self' data:",
  "font-src 'self'",
  "form-action 'self'",
  "base-uri 'none'",
  "frame-ancestors 'none'",
].join("; ");

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

/** Archivos generados esperando descarga. Se podan a los cinco minutos. */
const descargas = new Map<string, { buffer: Buffer; nombre: string; creadoEn: number }>();
const VIDA_DE_DESCARGA_MS = 5 * 60 * 1000;

function podarDescargas(): void {
  const ahora = Date.now();
  for (const [id, descarga] of descargas) {
    if (ahora - descarga.creadoEn > VIDA_DE_DESCARGA_MS) descargas.delete(id);
  }
}

export function registerOccupationRoutes(
  app: FastifyInstance,
  deps: {
    readonly config: AppConfig;
    readonly extraer: (archivo: Buffer) => PadronLeido;
    readonly servicio?: () => Promise<ServicioDeOcupacionesPort>;
    readonly guion?: HojaDeEstilos;
  },
): void {
  const pantalla = (
    respuesta: FastifyReply,
    codigo: number,
    datos: Partial<DatosDeOcupaciones>,
  ): FastifyReply =>
    respuesta
      .type("text/html; charset=utf-8")
      .header("content-security-policy", POLITICA_DE_OCUPACIONES)
      .code(codigo)
      .send(
        renderOccupationsPage({
          entorno: deps.config.environment,
          iaDisponible: deps.servicio !== undefined,
          subareas: SUBAREAS_CNO,
          tamanoDelCatalogo: catalogoDeLaPlataforma().tamano,
          limiteDeBusqueda: LIMITE_DE_BUSQUEDA,
          busqueda: SIN_BUSQUEDA,
          guion: deps.guion,
          ...datos,
        }),
      );

  app.get("/ocupaciones", (peticion, respuesta) =>
    pantalla(respuesta, 200, {
      busqueda: busquedaDe((peticion.query ?? {}) as Record<string, unknown>),
    }),
  );

  // ---- fallback sin JS: POST clásico que devuelve el archivo directamente ----
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

      for (const caso of plan.casos) {
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

      if (codigos.length === 0) {
        return pantalla(respuesta, 200, {
          resultado: {
            faltantes: plan.filas.length,
            consultados: plan.casos.length,
            escritos: 0,
            conClave: plan.conClave,
            pendientes: plan.pendientes,
          },
        });
      }

      const { buffer } = escribirCodigosEnXlsx(archivo.contenido, plan.filas, codigos);
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

  // ---- ruta SSE: clasificación con avance en tiempo real ----
  app.post(
    "/api/ocupaciones/clasificar",
    { bodyLimit: deps.config.role === "nube" ? MAXIMO_EN_LA_NUBE : MAXIMO_DEL_ARCHIVO },
    async (peticion: FastifyRequest, respuesta: FastifyReply) => {
      respuesta.raw.writeHead(200, {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-cache, no-store",
        connection: "keep-alive",
      });

      const enviar = (datos: Record<string, unknown>): void => {
        respuesta.raw.write(`data: ${JSON.stringify(datos)}\n\n`);
      };

      if (!deps.servicio) {
        enviar({ tipo: "error", mensaje: "El agente de ocupaciones no está disponible." });
        respuesta.raw.end();
        return respuesta;
      }

      let archivo;
      try {
        const formulario = parseMultipart(
          peticion.body as Buffer,
          peticion.headers["content-type"],
        );
        archivo = formulario.archivos.find((parte) => parte.campo === "archivo");
      } catch {
        enviar({ tipo: "error", mensaje: "El formulario llegó incompleto o dañado." });
        respuesta.raw.end();
        return respuesta;
      }

      if (!archivo || archivo.contenido.length === 0) {
        enviar({ tipo: "error", mensaje: "No se recibió ningún archivo." });
        respuesta.raw.end();
        return respuesta;
      }

      let padron: PadronLeido;
      try {
        padron = deps.extraer(archivo.contenido);
      } catch (error) {
        const mensaje = error instanceof Error ? error.message : String(error);
        enviar({ tipo: "error", mensaje: `Archivo no válido: ${mensaje}` });
        respuesta.raw.end();
        return respuesta;
      }

      let plan;
      try {
        plan = planearClasificacion(padron, CASOS_POR_CORRIDA);
      } catch (error) {
        const mensaje = error instanceof DomainError ? error.message : "Error al planear.";
        enviar({ tipo: "error", mensaje });
        respuesta.raw.end();
        return respuesta;
      }

      enviar({ tipo: "plan", faltantes: plan.filas.length, casos: plan.casos.length, conClave: plan.conClave });

      if (plan.casos.length === 0) {
        enviar({ tipo: "resultado", faltantes: 0, consultados: 0, escritos: 0 });
        respuesta.raw.end();
        return respuesta;
      }

      const servicio = await deps.servicio();
      const codigos: Array<{ casoId: string; codigo: string }> = [];
      let consultados = 0;

      for (const caso of plan.casos) {
        consultados += 1;
        let estado = "sin_respuesta";
        let codigo = "";
        try {
          const sugerencia = await servicio.sugerir({
            puesto: caso.puesto,
            centroDeCostos: caso.centroDeCostos,
          });
          estado = sugerencia.estado;
          if (sugerencia.sugerencia && sugerencia.estado === "sugerida") {
            codigo = sugerencia.sugerencia.codigo;
            codigos.push({ casoId: caso.id, codigo });
          }
        } catch {
          estado = "sin_respuesta";
        }
        enviar({
          tipo: "avance",
          actual: consultados,
          total: plan.casos.length,
          estado,
          codigo,
          puesto: caso.puesto,
        });
      }

      peticion.log.info(
        { faltantes: plan.filas.length, consultados, escritos: codigos.length },
        "clasificación de ocupaciones completada",
      );

      if (codigos.length === 0) {
        enviar({ tipo: "resultado", faltantes: plan.filas.length, consultados, escritos: 0 });
        respuesta.raw.end();
        return respuesta;
      }

      const { buffer } = escribirCodigosEnXlsx(archivo.contenido, plan.filas, codigos);
      const nombre = archivo.nombre
        ? archivo.nombre.replace(/\.xlsx$/i, " — con ocupaciones.xlsx")
        : "padron-con-ocupaciones.xlsx";

      podarDescargas();
      const descargaId = randomUUID();
      descargas.set(descargaId, { buffer, nombre, creadoEn: Date.now() });

      enviar({ tipo: "resultado", faltantes: plan.filas.length, consultados, escritos: codigos.length, descargaId });
      respuesta.raw.end();
      return respuesta;
    },
  );

  // ---- descarga del archivo generado ----
  app.get("/api/ocupaciones/descarga/:id", (peticion, respuesta) => {
    const id = (peticion.params as { id: string }).id;
    const descarga = descargas.get(id);
    if (!descarga) {
      return respuesta.code(404).send({ error: "El archivo ya no está disponible." });
    }
    descargas.delete(id);
    return respuesta
      .type("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
      .header("content-disposition", `attachment; filename="${descarga.nombre}"`)
      .code(200)
      .send(descarga.buffer);
  });

  // ---- API JSON de un caso suelto ----
  app.post("/api/ocupaciones/sugerir", async (peticion, respuesta) => {
    if (!deps.servicio) {
      return respuesta.code(503).send({
        error: {
          code: "IA_SIN_CONFIGURAR",
          message: "El agente de ocupaciones está apagado.",
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
