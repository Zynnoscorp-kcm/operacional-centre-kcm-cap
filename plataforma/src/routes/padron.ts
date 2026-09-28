/**
 * Rutas del padrón semanal.
 *
 * Seis rutas y una regla: `GET` no escribe, y de los cinco `POST` sólo
 * `/padron/aplicar` toca la base. Subir el archivo produce una revisión;
 * encargar un barrido deja una orden; descartar y cancelar sólo borran memoria.
 *
 * El archivo entra por dos puertas y la revisión es la misma: el formulario de
 * siempre, y el barrido que el libro controlador entrega por el puente desde la
 * PC donde vive el `sem NN CAP.xlsx`. Las dos desembocan en `previsualizar`, así
 * que no hay dos lecturas del padrón ni dos maneras de cuadrarlo.
 *
 * Es la primera pantalla de la consola que exige sesión. No es un cambio de
 * política general —el resto sigue abierto, como está documentado— sino la
 * consecuencia de que aquí sí se escribe: aplicar un padrón mueve CURP y
 * fechas de alta de mil setecientas personas, y eso no puede quedar detrás de
 * una URL que cualquiera adivine. Sin sesión se manda a `/acceso` con el
 * destino puesto, para volver aquí en cuanto se entra.
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

import type { AppConfig } from "../config/environment.ts";
import { DomainError } from "../domain/comun/errores.ts";
import type { RosterIngestService } from "../domain/padron/ingesta.ts";
import type { Clock } from "../ports/reloj.port.ts";
import type { ConsoleSessionCodec } from "../server/sesion-consola.ts";
import { MultipartError, parseMultipart } from "../server/multipart.ts";
import { renderRosterPage, type DatosDePadron } from "../web/pages/padron.ts";

/** Un `sem NN CAP.xlsx` pesa medio mega; el margen es para que nadie lo ajuste al hueso. */
const MAXIMO_DEL_ARCHIVO = 8 * 1024 * 1024;
const MAXIMO_EN_LA_NUBE = 4 * 1024 * 1024;

export interface RosterRouteDeps {
  readonly config: AppConfig;
  readonly clock: Clock;
  readonly sessions: ConsoleSessionCodec;
  /** Ausente cuando no hay base: la pantalla lo explica y no ofrece subir nada. */
  readonly service?: RosterIngestService;
}

export function registerRosterRoutes(app: FastifyInstance, deps: RosterRouteDeps): void {
  const { config, clock, sessions, service } = deps;

  const pantalla = (
    respuesta: FastifyReply,
    codigo: number,
    datos: Omit<DatosDePadron, "entorno" | "sinBase">,
  ): FastifyReply =>
    respuesta
      .type("text/html; charset=utf-8")
      .code(codigo)
      .send(
        renderRosterPage({
          entorno: config.environment,
          papel: config.role,
          sinBase: service === undefined,
          ...datos,
        }),
      );

  /** Lo que hay ahora mismo: la revisión pendiente, si la hay. */
  const estado = (): Omit<DatosDePadron, "entorno" | "sinBase"> => {
    if (!service) return {};
    const plan = service.ultimoPlan();
    // La comparación se resolvió al leer el archivo y aquí sólo se recoge: la
    // pantalla se dibuja en cada recarga y no puede consultar la base cada vez.
    const comparacion = service.comparacion();
    return {
      ...(plan ? { plan } : {}),
      ...(comparacion ? { comparacion } : {}),
    };
  };

  /** `false` cuando ya se respondió con la redirección al acceso. */
  const conSesion = (peticion: FastifyRequest, respuesta: FastifyReply): boolean => {
    // El acceso abierto de prueba desactiva la compuerta: es la única forma de
    // recorrer el padrón sin ir pidiendo credencial pantalla por pantalla.
    if (config.pilot.openAccess) return true;
    if (sessions.leer(peticion.headers.cookie, clock.now())) return true;
    void respuesta.redirect("/acceso?destino=/padron", 303);
    return false;
  };

  /** Con acceso abierto no hay quién firme: se dice así en vez de inventarlo. */
  const actor = (peticion: FastifyRequest): string =>
    sessions.leer(peticion.headers.cookie, clock.now())?.usuario ?? "acceso-abierto";

  app.get("/padron", async (peticion: FastifyRequest, respuesta: FastifyReply) => {
    if (!conSesion(peticion, respuesta)) return respuesta;
    await service?.sincronizar();
    return pantalla(respuesta, 200, estado());
  });

  app.post("/padron/descartar", async (peticion: FastifyRequest, respuesta: FastifyReply) => {
    if (!conSesion(peticion, respuesta)) return respuesta;
    if (service) await service.descartar();
    peticion.log.info("revisión de padrón descartada");
    return respuesta.redirect("/padron", 303);
  });

  app.post(
    "/padron",
    {
      // En la nube el tope baja a cuatro mebibytes, por debajo de los 4.5 MB en
      // que corta el alojamiento. El padrón real ronda medio megabyte (medido
      // el 2026-09-24 con `sem 29 CAP.xlsx`): cabe desde cualquier equipo.
      bodyLimit: config.role === "nube" ? MAXIMO_EN_LA_NUBE : MAXIMO_DEL_ARCHIVO,
      // Si alguna vez no cupiera, se dice por dónde sí cabe en vez de dejar que
      // el corte parezca un archivo dañado: Excel lo manda en partes.
      errorHandler: (error, _peticion, respuesta) => {
        if (error.statusCode !== 413) throw error;
        void pantalla(respuesta, 413, {
          error:
            "El archivo supera los 4 MB que acepta la plataforma publicada desde el navegador. " +
            "Se envía desde Excel con Padrón de la semana, que lo manda en partes.",
        });
      },
    },
    async (peticion: FastifyRequest, respuesta: FastifyReply) => {
      if (!conSesion(peticion, respuesta)) return respuesta;
      if (!service) {
        return pantalla(respuesta, 503, {
          error: "Sin conexión con la base de datos: el padrón no tiene dónde aplicarse.",
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
        peticion.log.warn("padrón recibido con un formulario ilegible");
        return pantalla(respuesta, 400, { error: "El formulario llegó incompleto o dañado." });
      }

      if (!archivo || archivo.contenido.length === 0) {
        return pantalla(respuesta, 400, { error: "No se recibió ningún archivo." });
      }

      try {
        const plan = await service.previsualizar(archivo.contenido, archivo.nombre, {
          tipo: "CONSOLA",
          actor: actor(peticion),
        });
        peticion.log.info(
          { activos: plan.cuadre.activosEnArchivo, desconocidos: plan.cuadre.desconocidos },
          "padrón revisado sin aplicar",
        );
        const comparacion = service.comparacion();
        return pantalla(respuesta, 200, { plan, ...(comparacion ? { comparacion } : {}) });
      } catch (error) {
        if (!(error instanceof DomainError)) throw error;
        peticion.log.warn({ codigo: error.code }, "padrón rechazado");
        return pantalla(respuesta, 422, { error: error.message });
      }
    },
  );

  app.post("/padron/aplicar", async (peticion: FastifyRequest, respuesta: FastifyReply) => {
    if (!conSesion(peticion, respuesta)) return respuesta;
    if (!service) {
      return pantalla(respuesta, 503, {
        error: "Sin conexión con la base de datos: el padrón no tiene dónde aplicarse.",
      });
    }

    const cuerpo = (peticion.body ?? {}) as { planId?: unknown };
    const planId = typeof cuerpo.planId === "string" ? cuerpo.planId : "";

    try {
      // El plan pudo leerse en otra instancia: se trae antes de aplicarlo.
      await service.sincronizar();
      const resultado = await service.aplicar(planId, actor(peticion));
      peticion.log.info(
        {
          curp: resultado.curp,
          altas: resultado.altas,
          inducciones: resultado.inducciones,
        },
        "padrón aplicado",
      );
      return pantalla(respuesta, 200, { resultado });
    } catch (error) {
      if (!(error instanceof DomainError)) throw error;
      peticion.log.warn({ codigo: error.code }, "aplicación de padrón rechazada");
      return pantalla(respuesta, 409, { ...estado(), error: error.message });
    }
  });
}
