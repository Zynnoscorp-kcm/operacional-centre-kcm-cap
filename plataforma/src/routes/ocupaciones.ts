/**
 * Rutas del agente de ocupaciones.
 *
 * - `GET /ocupaciones` es la pantalla: la consulta al agente, la leyenda de la
 *   copia del padrón y la búsqueda en el catálogo. La búsqueda va en la
 *   dirección (`?q=…&subarea=…`) para que una búsqueda se pueda compartir y
 *   volver a abrir; no usa modelo.
 * - `POST /ocupaciones` consulta al agente desde la pantalla y la vuelve a
 *   dibujar con el resultado y el formulario lleno.
 * - `POST /api/ocupaciones/sugerir` es lo mismo en JSON.
 *
 * Un caso por petición: un caso puede tardar hasta cien segundos entre
 * reintentos y respaldo, y la función publicada corta a los ciento veinte.
 *
 * Nacen cerradas, como toda ruta nueva: sin sesión de consola, el guardia las
 * rechaza antes de llegar aquí. La bitácora anota el estado y la duración de
 * cada consulta, nunca el puesto ni la respuesta del modelo.
 */

import type { FastifyInstance, FastifyReply } from "fastify";

import type { AppConfig } from "../config/environment.ts";
import { DomainError } from "../domain/comun/errores.ts";
import { catalogoDeLaPlataforma, SUBAREAS_CNO } from "../domain/ocupaciones/catalogo.ts";
import type { ServicioDeOcupacionesPort } from "../domain/ocupaciones/servicio.ts";
import {
  renderOccupationsPage,
  type BusquedaEnCatalogo,
  type DatosDeOcupaciones,
} from "../web/pages/ocupaciones.ts";

/** Filas que enseña la búsqueda; más allá, más palabras acotan mejor que desplazarse. */
const LIMITE_DE_BUSQUEDA = 60;

const SIN_BUSQUEDA: BusquedaEnCatalogo = {
  texto: "",
  subarea: "",
  realizada: false,
  total: 0,
  ocupaciones: [],
};

/** Un campo de formulario o de consulta como texto; el primero si vino repetido. */
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
    /**
     * Ausente cuando no hay llave de ningún proveedor. Es una función porque el
     * agente se arma la primera vez que se usa, no al arrancar.
     */
    readonly servicio?: () => Promise<ServicioDeOcupacionesPort>;
  },
): void {
  const pantalla = (
    respuesta: FastifyReply,
    codigo: number,
    datos: Pick<DatosDeOcupaciones, "busqueda"> &
      Partial<Pick<DatosDeOcupaciones, "consulta" | "sugerencia" | "error">>,
  ): FastifyReply =>
    respuesta
      .type("text/html; charset=utf-8")
      .code(codigo)
      .send(
        renderOccupationsPage({
          entorno: deps.config.environment,
          consultaDisponible: deps.servicio !== undefined,
          subareas: SUBAREAS_CNO,
          tamanoDelCatalogo: catalogoDeLaPlataforma().tamano,
          limiteDeBusqueda: LIMITE_DE_BUSQUEDA,
          ...datos,
        }),
      );

  app.get("/ocupaciones", (peticion, respuesta) =>
    pantalla(respuesta, 200, {
      busqueda: busquedaDe((peticion.query ?? {}) as Record<string, unknown>),
    }),
  );

  app.post("/ocupaciones", async (peticion, respuesta) => {
    const cuerpo = (peticion.body ?? {}) as Record<string, unknown>;
    const consulta = {
      puesto: texto(cuerpo.puesto),
      centroDeCostos: texto(cuerpo.centroDeCostos),
    };
    if (!deps.servicio) {
      return pantalla(respuesta, 503, {
        consulta,
        error: "La consulta al agente no está disponible en esta instalación.",
        busqueda: SIN_BUSQUEDA,
      });
    }
    const servicio = await deps.servicio();
    const inicio = Date.now();
    try {
      const sugerencia = await servicio.sugerir(consulta);
      peticion.log.info(
        { estado: sugerencia.estado, milisegundos: Date.now() - inicio },
        "ocupación consultada desde la pantalla",
      );
      return pantalla(respuesta, 200, { consulta, sugerencia, busqueda: SIN_BUSQUEDA });
    } catch (error) {
      if (!(error instanceof DomainError)) throw error;
      return pantalla(respuesta, 400, { consulta, error: error.message, busqueda: SIN_BUSQUEDA });
    }
  });

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
