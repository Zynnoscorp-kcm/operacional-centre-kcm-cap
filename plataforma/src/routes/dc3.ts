import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

import type { AppConfig } from "../config/environment.ts";
import { DomainError } from "../domain/errores.ts";
import type { Dc3CertificateService } from "../domain/dc3/constancia.ts";
import type { Dc3JobService } from "../domain/dc3/tarea.ts";
import type { Dc3PlanTab } from "../ports/dc3-constancia.port.ts";
import type { WorkerSystemRepositoryPort } from "../ports/sistema-trabajador.port.ts";
import { renderDc3ConfirmarPage } from "../web/pages/dc3-confirmar.ts";
import { renderDc3Page } from "../web/pages/dc3.ts";

/**
 * Tope de renglones de la lista individual. Sin filtros, el producto de mil
 * setecientos trabajadores por tres cursos son más de cinco mil renglones, y por
 * el enlace hacia la base eso es medio minuto de espera para una pantalla que se
 * usa buscando a una persona.
 */
const MAXIMO_DE_CANDIDATOS = 200;

/**
 * Tope del plan de emisión. Es más alto que el de la búsqueda porque el plan se
 * abre justamente para ver a cuánta gente le toca, pero sigue siendo un tope:
 * los tres cursos por el padrón activo pasan de tres mil renglones listos y
 * ningún navegador dibuja eso sin castigar a quien lo abrió.
 */
const MAXIMO_DEL_PLAN = 300;

const PESTANAS: readonly Dc3PlanTab[] = ["listos", "incompletos", "sin-curso"];

function pestanaDe(valor: unknown): Dc3PlanTab {
  const pedida = texto(valor);
  return PESTANAS.find((p) => p === pedida) ?? "listos";
}

function texto(valor: unknown): string {
  return typeof valor === "string" ? valor.trim() : "";
}

export function registerDc3Routes(
  app: FastifyInstance,
  deps: {
    readonly config: AppConfig;
    readonly service: Dc3JobService;
    /** Emisión individual. Ausente sin base: la pantalla lo explica. */
    readonly certificates?: Dc3CertificateService;
    /**
     * El mismo repositorio que sirve las áreas en `/trabajadores`. Se reutiliza
     * en vez de escribir otra consulta: dos listas de áreas que se calculan
     * distinto acaban ofreciendo opciones distintas para el mismo padrón.
     */
    readonly workers?: WorkerSystemRepositoryPort;
  },
): void {
  const pintar = async (
    peticion: FastifyRequest,
    respuesta: FastifyReply,
    extra: { aviso?: string; error?: string } = {},
  ): Promise<FastifyReply> => {
    const consulta = (peticion.query ?? {}) as Record<string, unknown>;
    const selected = {
      ...(texto(consulta.curso) ? { courseKey: texto(consulta.curso) } : {}),
      ...(texto(consulta.area) ? { area: texto(consulta.area) } : {}),
      ...(texto(consulta.payrollType) ? { payrollType: texto(consulta.payrollType) } : {}),
      ...(texto(consulta.q) ? { query: texto(consulta.q) } : {}),
    };

    // El plan enumera a todos los que ya pueden imprimir sin exigir filtro: es
    // justo la pregunta «¿a quién le toca hoy?». Los filtros de arriba lo
    // acotan, no lo condicionan.
    const enPlan = texto(consulta.plan) === "1";
    const pestana = pestanaDe(consulta.pestana);

    const [courses, areas, candidates, planCandidates, plan, emitidas] = await Promise.all([
      deps.certificates ? deps.certificates.listDc3Courses() : Promise.resolve([]),
      deps.workers ? deps.workers.listAreas() : Promise.resolve([]),
      // Sin ningún filtro no se lista a nadie: son cinco mil renglones que casi
      // nunca son lo que se busca, y traerlos castiga a quien sólo abrió la
      // pantalla para ver el estado del lote.
      deps.certificates && Object.keys(selected).length > 0
        ? deps.certificates.listCandidates(selected, MAXIMO_DE_CANDIDATOS)
        : Promise.resolve([]),
      // El plan lleva su propia lista: la de arriba es una búsqueda y sólo
      // responde a lo que se teclee en ella.
      deps.certificates && enPlan
        ? deps.certificates.listCandidates({ ...selected, status: pestana }, MAXIMO_DEL_PLAN)
        : Promise.resolve([]),
      deps.certificates && enPlan
        ? deps.certificates.summarizePlan(selected)
        : Promise.resolve(undefined),
      deps.certificates && enPlan ? deps.certificates.emittedKeys() : Promise.resolve(undefined),
    ]);

    return respuesta.type("text/html; charset=utf-8").send(
      renderDc3Page({
        config: deps.config,
        job: deps.service.status(),
        courses,
        areas,
        candidates,
        planCandidates,
        selected,
        limit: MAXIMO_DE_CANDIDATOS,
        planLimit: MAXIMO_DEL_PLAN,
        sinBase: deps.certificates === undefined,
        enPlan,
        pestana,
        ...(plan ? { plan } : {}),
        ...(emitidas ? { emitidas } : {}),
        ...(extra.aviso ? { aviso: extra.aviso } : {}),
        ...(extra.error ? { error: extra.error } : {}),
      }),
    );
  };

  app.get("/dc3", (peticion, respuesta) => pintar(peticion, respuesta));

  /**
   * La constancia de una persona, compuesta sin registrarla.
   *
   * Es la ruta del ojo de vista previa y tambien la que alimenta el visor y el
   * boton de descarga de la pagina de emision. Ninguno de esos tres usos es una
   * emision nueva: mirar el documento, o volver a guardarlo, no puede ensuciar
   * la bitacora ni hacer que un renglon aparezca emitido dos veces.
   *
   * El generador es determinista, asi que el PDF que se ve aqui es byte por byte
   * el que quedo registrado al emitir.
   */
  app.get(
    "/dc3/vista-previa/:workerNumber/:courseKey",
    async (
      peticion: FastifyRequest<{ Params: { workerNumber: string; courseKey: string } }>,
      respuesta: FastifyReply,
    ) => {
      if (!deps.certificates) {
        return pintar(peticion, respuesta, {
          error: "Sin base de datos conectada no hay padrón del que emitir.",
        });
      }

      const consulta = (peticion.query ?? {}) as {
        editable?: unknown;
        enBlanco?: unknown;
        descargar?: unknown;
      };

      try {
        const constancia = await deps.certificates.emitir({
          workerNumber: peticion.params.workerNumber,
          courseKey: peticion.params.courseKey,
          actor: "USUARIO_CAPACITACION",
          requestId: String(peticion.id),
          editable: texto(consulta.editable) === "1",
          allowMissingDate: texto(consulta.enBlanco) === "1",
          preview: true,
        });

        const disposicion = texto(consulta.descargar) === "1" ? "attachment" : "inline";
        return respuesta
          .type("application/pdf")
          .header("content-disposition", `${disposicion}; filename="${constancia.fileName}"`)
          .header("cache-control", "no-store")
          .send(Buffer.from(constancia.pdf));
      } catch (error) {
        if (!(error instanceof DomainError)) throw error;
        peticion.log.warn({ codigo: error.code }, "vista previa DC-3 rechazada");
        return pintar(peticion, respuesta, { error: error.message });
      }
    },
  );

  /**
   * La advertencia previa a emitir.
   *
   * El botón de la pantalla llega aquí, y aquí todavía no pasa nada: se compone
   * la constancia en modo vista previa —que no registra— sólo para poder decir
   * de quién es y qué recuadros saldrían vacíos, y se pregunta. Las mismas
   * compuertas de siempre siguen delante: sin fecha y sin declararlo, ni se
   * llega a preguntar.
   */
  app.get(
    "/dc3/constancia/:workerNumber/:courseKey",
    async (
      peticion: FastifyRequest<{ Params: { workerNumber: string; courseKey: string } }>,
      respuesta: FastifyReply,
    ) => {
      if (!deps.certificates) {
        return pintar(peticion, respuesta, {
          error: "Sin base de datos conectada no hay padrón del que emitir.",
        });
      }

      const consulta = (peticion.query ?? {}) as {
        editable?: unknown;
        enBlanco?: unknown;
        pestana?: unknown;
      };
      const editable = texto(consulta.editable) === "1";
      const enBlanco = texto(consulta.enBlanco) === "1";
      const pestana = pestanaDe(consulta.pestana);

      try {
        const previa = await deps.certificates.emitir({
          workerNumber: peticion.params.workerNumber,
          courseKey: peticion.params.courseKey,
          actor: "USUARIO_CAPACITACION",
          requestId: String(peticion.id),
          editable,
          allowMissingDate: enBlanco,
          preview: true,
        });

        const cola = `${encodeURIComponent(peticion.params.workerNumber)}/${encodeURIComponent(peticion.params.courseKey)}`;
        return respuesta
          .type("text/html; charset=utf-8")
          .header("cache-control", "no-store")
          .send(
            renderDc3ConfirmarPage({
              config: deps.config,
              workerNumber: previa.workerNumber,
              workerName: previa.workerName,
              courseName: previa.courseName,
              accion: `/dc3/constancia/${cola}`,
              ocultos: [
                ...(editable ? ([["editable", "1"]] as const) : []),
                ...(enBlanco ? ([["enBlanco", "1"]] as const) : []),
              ],
              regreso: `/dc3?plan=1&pestana=${pestana}#plan`,
              blankFields: previa.blankFields,
            }),
          );
      } catch (error) {
        if (!(error instanceof DomainError)) throw error;
        peticion.log.warn({ codigo: error.code }, "emisión individual DC-3 rechazada");
        return pintar(peticion, respuesta, { error: error.message });
      }
    },
  );

  /**
   * La emisión de verdad: el «sí» de la advertencia.
   *
   * Es `POST` porque deja huella —asienta la constancia en la bitácora— y eso no
   * se puede disparar por navegar a una dirección ni por recargar. Responde con
   * el PDF marcado como descarga: el archivo cae en la carpeta de descargas y la
   * pantalla no se mueve, que es lo que hace falta cuando se emiten varias
   * constancias seguidas desde el mismo plan.
   */
  app.post(
    "/dc3/constancia/:workerNumber/:courseKey",
    async (
      peticion: FastifyRequest<{ Params: { workerNumber: string; courseKey: string } }>,
      respuesta: FastifyReply,
    ) => {
      if (!deps.certificates) {
        return pintar(peticion, respuesta, {
          error: "Sin base de datos conectada no hay padrón del que emitir.",
        });
      }

      const cuerpo = (peticion.body ?? {}) as { editable?: unknown; enBlanco?: unknown };

      try {
        const constancia = await deps.certificates.emitir({
          workerNumber: peticion.params.workerNumber,
          courseKey: peticion.params.courseKey,
          actor: "USUARIO_CAPACITACION",
          requestId: String(peticion.id),
          editable: texto(cuerpo.editable) === "1",
          // Lo pide el botón rojo del plan, y sólo él: sin la bandera, quien no
          // tiene fecha del curso sigue sin recibir constancia.
          allowMissingDate: texto(cuerpo.enBlanco) === "1",
        });

        peticion.log.info(
          { curso: peticion.params.courseKey, enBlanco: constancia.blankFields.length },
          "constancia DC-3 individual emitida",
        );

        return (
          respuesta
            .type("application/pdf")
            .header("content-disposition", `attachment; filename="${constancia.fileName}"`)
            // El PDF lleva nombre, CURP y puesto: no se guarda en ninguna caché.
            .header("cache-control", "no-store")
            .send(Buffer.from(constancia.pdf))
        );
      } catch (error) {
        if (!(error instanceof DomainError)) throw error;
        peticion.log.warn({ codigo: error.code }, "emisión individual DC-3 rechazada");
        return pintar(peticion, respuesta, { error: error.message });
      }
    },
  );

  app.get("/api/dc3/status", async (_request, reply) => reply.send(deps.service.status()));

  app.post("/api/dc3/jobs", async (request, reply) => {
    const body = (request.body ?? {}) as { mode?: string; allowPartial?: string | boolean };
    const snapshot = deps.service.enqueue({
      generate: body.mode === "generate",
      allowPartial: body.allowPartial === true || body.allowPartial === "true",
    });
    if (String(request.headers.accept ?? "").includes("text/html"))
      return reply.redirect("/dc3", 303);
    return reply.code(202).send(snapshot);
  });
}
