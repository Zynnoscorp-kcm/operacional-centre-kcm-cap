import { createHash, randomUUID } from "node:crypto";
import type { Writable } from "node:stream";
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";

import type { AppConfig } from "../config/environment.ts";
import type { Clock } from "../ports/reloj.port.ts";
import { systemClock } from "../adapters/sistema/reloj-sistema.ts";
import { buildLoggerOptions } from "../observability/logging.ts";
import { registerAccessRoutes } from "../routes/acceso.ts";
import { registerAgendaRoutes } from "../routes/agenda.ts";
import { registerAssetRoutes } from "../routes/estaticos.ts";
import { guionOcupaciones } from "../web/estaticos.ts";
import { registerHealthRoute } from "../routes/salud.ts";
import { registerHomeRoute } from "../routes/inicio.ts";
import { apagadoPorOmision, programarApagado, registerShutdownRoutes } from "../routes/apagado.ts";
import { registerWorkerSystemRoutes } from "../routes/sistema-trabajador.ts";
import { renderErrorPage } from "../web/pages/error.ts";
import { ConsoleSessionCodec } from "./sesion-consola.ts";
import { notFound, toPublicError, type ErrorPublico } from "./errors.ts";
import { registrarDominiosDedicados } from "./dominios.ts";
import { registrarGuardiaDeConsola } from "./guardia.ts";
import type { WorkerSystemRepositoryPort } from "../ports/sistema-trabajador.port.ts";
import { MemoryWorkerSystemRepository } from "../adapters/memoria/sistema-trabajador.ts";
import type { KioskSessionRepositoryPort } from "../ports/quiosco.port.ts";
import { MemoryKioskSessionRepository } from "../adapters/memoria/quiosco.ts";
import { leerCatalogoDeSemilla } from "../adapters/memoria/semilla-catalogo.ts";
import { SessionService } from "../domain/quiosco/sesiones.ts";
import { KioskAuthService } from "../domain/quiosco/autenticacion.ts";
import { KioskService } from "../domain/quiosco/registro.ts";
import { registerKioskRoutes } from "../routes/quiosco.ts";
import { registerSessionRoutes } from "../routes/sesiones.ts";
import type { PreReleaseRepositoryPort } from "../ports/preliberacion.port.ts";
import { MemoryPreReleaseRepository } from "../adapters/memoria/preliberacion.ts";
import { WorkbenchService } from "../domain/preliberacion/banco-de-trabajo.ts";
import { PreReleaseReportService } from "../domain/preliberacion/reporte.ts";
import { registerPreReleaseRoutes } from "../routes/preliberacion.ts";
import type { MatrixWritePort, ReleaseRepositoryPort } from "../ports/liberacion.port.ts";
import { MemoryReleaseRepository } from "../adapters/memoria/liberacion.ts";
import { MatrixGateway } from "../domain/liberacion/pasarela-matriz.ts";
import { ReleaseService } from "../domain/liberacion/servicio.ts";
import { MatrixDeliveryService } from "../domain/liberacion/entregas.ts";
import type { MatrixDeliveryPort } from "../ports/entregas-matriz.port.ts";
import { registerReleaseRoutes } from "../routes/liberacion.ts";
import type { RoomReservationRepository } from "../domain/salas/tipos.ts";
import { MemoryRoomReservationRepository } from "../adapters/memoria/salas.ts";
import { RoomReservationService } from "../domain/salas/reservaciones.ts";
import { registerRoomRoutes } from "../routes/salas.ts";
import type { ExcelRepository } from "../domain/excel/tipos.ts";
import { MemoryExcelRepository } from "../adapters/memoria/excel.ts";
import { MemoryMatrixRepository } from "../adapters/memoria/matriz.ts";
import type { MatrixRepositoryPort } from "../ports/importacion-matriz.port.ts";
import { ExcelIntegrationService } from "../domain/excel/integracion.ts";
import { registerExcelRoutes } from "../routes/excel.ts";
import { MatrixScanService } from "../domain/barrido-matriz/servicio.ts";
import { registerMatrixScanRoutes } from "../routes/barrido-matriz.ts";
import { registerLoadHistoryRoutes } from "../routes/historial-cargas.ts";
import { registerChangeControlRoutes } from "../routes/control-de-cambios.ts";
import { Dc3CertificateService } from "../domain/dc3/constancia.ts";
import type { Dc3CertificatePort } from "../ports/dc3-constancia.port.ts";
import { registerDc3Routes } from "../routes/dc3.ts";
import type { InternalConsolePort } from "../ports/consola-interna.port.ts";
import { MemoryInternalConsoleRepository } from "../adapters/memoria/consola-interna.ts";
import { InternalAuditService } from "../domain/consola-interna/auditoria.ts";
import { DeclaredFieldService } from "../domain/consola-interna/campos-declarados.ts";
import { DataPreviewService } from "../domain/consola-interna/vista-de-datos.ts";
import { registerInternalConsoleRoutes } from "../routes/consola-interna.ts";
import type { ConsoleDirectoryPort } from "../ports/directorio-consola.port.ts";
import { ConsoleDirectoryService } from "../domain/acceso/directorio-consola.ts";
import type { RosterRepositoryPort } from "../ports/padron.port.ts";
import type { RevisionesCompartidasPort } from "../ports/revisiones-compartidas.port.ts";
import type { RosterExtractorPort } from "../domain/padron/tipos.ts";
import { RosterExtractorAdapter } from "../adapters/archivos/extractor-padron.ts";
import { RosterIngestService } from "../domain/padron/ingesta.ts";
import { BitacoraDeCargas } from "../domain/cargas/bitacora.ts";
import { MemoryLoadLog } from "../adapters/memoria/bitacora-cargas.ts";
import type { LoadLogPort } from "../ports/bitacora-cargas.port.ts";

import { registerRosterRoutes } from "../routes/padron.ts";
import type { ServicioDeOcupacionesPort } from "../domain/ocupaciones/servicio.ts";
import { registerOccupationRoutes } from "../routes/ocupaciones.ts";
import type { SincroniaPort } from "../ports/sincronia.port.ts";
import { SincroniaService } from "../domain/sincronia/servicio.ts";
import { registerSyncRoutes } from "../routes/sincronia.ts";

export interface ServerDeps {
  readonly config: AppConfig;
  readonly clock?: Clock;
  readonly workerSystemRepository?: WorkerSystemRepositoryPort;
  readonly kioskSessionRepository?: KioskSessionRepositoryPort;
  readonly preReleaseRepository?: PreReleaseRepositoryPort;
  readonly releaseRepository?: ReleaseRepositoryPort & MatrixWritePort;
  readonly kioskTokenSecret?: string;
  readonly releaseIntegritySecret?: string;
  readonly roomRepository?: RoomReservationRepository;
  readonly excelRepository?: ExcelRepository;
  readonly excelMatrixRepository?: MatrixRepositoryPort;
  readonly apagar?: () => void;
  readonly projectRoot?: string;
  readonly dc3CertificateRepository?: Dc3CertificatePort;
  readonly matrixDeliveryRepository?: MatrixDeliveryPort;
  readonly internalConsoleRepository?: InternalConsolePort;
  readonly consoleDirectory?: ConsoleDirectoryPort;
  readonly rosterRepository?: RosterRepositoryPort;
  readonly sharedReviews?: RevisionesCompartidasPort;
  readonly sessionSecret?: string;
  readonly rosterExtractor?: RosterExtractorPort;
  readonly sincroniaRepository?: SincroniaPort;
  readonly loadLog?: LoadLogPort;
  readonly occupationService?: () => Promise<ServicioDeOcupacionesPort>;
  readonly logDestination?: Writable;
}

const POLITICA_DE_CONTENIDO = [
  "default-src 'none'",
  "style-src 'self'",
  "img-src 'self' data:",
  "font-src 'self'",
  "form-action 'self'",
  "base-uri 'none'",
  "frame-ancestors 'none'",
].join("; ");

export async function buildServer(deps: ServerDeps): Promise<FastifyInstance> {
  const { config } = deps;
  const clock = deps.clock ?? systemClock;

  const app = Fastify({
    logger: buildLoggerOptions(config, deps.logDestination),
    requestIdHeader: false,
    genReqId: () => randomUUID(),
    requestTimeout: config.requestTimeoutMs,
    bodyLimit: 1_048_576,
    routerOptions: { ignoreTrailingSlash: true },
    ...(config.trustedProxyHops > 0 ? { trustProxy: config.trustedProxyHops } : {}),
  });

  app.addContentTypeParser(
    "application/x-www-form-urlencoded",
    { parseAs: "string" },
    (_peticion, cuerpo, listo) => {
      try {
        const parametros = new URLSearchParams(String(cuerpo));
        const resultado: Record<string, string | string[]> = {};
        for (const clave of new Set(parametros.keys())) {
          const valores = parametros.getAll(clave);
          resultado[clave] = valores.length > 1 ? valores : (valores[0] ?? "");
        }
        listo(null, resultado);
      } catch (error) {
        listo(error as Error, undefined);
      }
    },
  );

  app.addContentTypeParser(
    "multipart/form-data",
    { parseAs: "buffer", bodyLimit: 8 * 1024 * 1024 },
    (_peticion, cuerpo, listo) => {
      listo(null, cuerpo);
    },
  );

  app.addHook("onSend", (peticion, respuesta, carga, listo) => {
    respuesta.header("x-content-type-options", "nosniff");
    respuesta.header("referrer-policy", "no-referrer");
    respuesta.header("x-frame-options", "DENY");
    respuesta.header("cross-origin-opener-policy", "same-origin");
    respuesta.header("cross-origin-resource-policy", "same-origin");
    respuesta.header("permissions-policy", "camera=(), microphone=(), geolocation=()");
    if (respuesta.getHeader("content-security-policy") === undefined) {
      respuesta.header("content-security-policy", POLITICA_DE_CONTENIDO);
    }
    respuesta.header("x-request-id", String(peticion.id));

    if (config.environment === "production") {
      respuesta.header("strict-transport-security", "max-age=31536000; includeSubDomains");
    }

    if (respuesta.getHeader("cache-control") === undefined) {
      respuesta.header("cache-control", "no-store");
    }

    listo(null, carga);
  });

  const responder = (
    peticion: FastifyRequest,
    respuesta: FastifyReply,
    publico: ErrorPublico,
  ): FastifyReply => {
    const requestId = String(peticion.id);

    if (prefiereHtml(peticion)) {
      const pagina = renderErrorPage({
        entorno: config.environment,
        statusCode: publico.statusCode,
        codigo: publico.code,
        mensaje: publico.message,
        requestId,
      });
      return respuesta.type("text/html; charset=utf-8").code(publico.statusCode).send(pagina);
    }

    return respuesta.code(publico.statusCode).send({
      error: { code: publico.code, message: publico.message, requestId },
    });
  };

  const workerSystemRepository = deps.workerSystemRepository ?? new MemoryWorkerSystemRepository();
  const catalogoDeSemilla = leerCatalogoDeSemilla(process.cwd());
  const kioskSessionRepository =
    deps.kioskSessionRepository ??
    new MemoryKioskSessionRepository(
      catalogoDeSemilla === undefined ? undefined : { trainings: catalogoDeSemilla },
    );

  const tokenSecret = deps.kioskTokenSecret || "kcm-kiosk-test-secret-32-chars-long!";
  const sessionService = new SessionService({ repository: kioskSessionRepository, clock });

  const pinDeApertura = config.pilot.sessionLaunchPin ?? config.pilot.kioskPin;
  const pilotSecrets = {
    ...(config.pilot.kioskPin === undefined ? {} : { REGISTRO_QUIOSCO: config.pilot.kioskPin }),
    ...(pinDeApertura === undefined ? {} : { APERTURA_SESION: pinDeApertura }),
  };

  const authService = new KioskAuthService({
    repository: kioskSessionRepository,
    clock,
    tokenSecret,
    pilotSecrets,
    openAccess: config.pilot.openAccess,
  });
  const kioskService = new KioskService({ repository: kioskSessionRepository, authService, clock });

  const preReleaseRepository = deps.preReleaseRepository ?? new MemoryPreReleaseRepository();
  const workbenchService = new WorkbenchService({ repository: preReleaseRepository, clock });
  const preReleaseReportService = new PreReleaseReportService({
    repository: preReleaseRepository,
    workbench: workbenchService,
    clock,
    projectRoot: deps.projectRoot ?? process.cwd(),
  });

  const releaseRepository = deps.releaseRepository ?? new MemoryReleaseRepository();
  const releaseSecret = deps.releaseIntegritySecret || "kcm-release-integrity-dev-secret-32ch!";
  const releaseService = new ReleaseService({
    repository: releaseRepository,
    gateway: new MatrixGateway({ matrix: releaseRepository, secret: releaseSecret, clock }),
    clock,
    secret: releaseSecret,
  });

  const roomRepository = deps.roomRepository ?? new MemoryRoomReservationRepository();
  const roomService = new RoomReservationService(roomRepository, clock);
  const excelRepository = deps.excelRepository ?? new MemoryExcelRepository({ clock });
  const excelMatrixRepository = deps.excelMatrixRepository ?? new MemoryMatrixRepository();
  const loadLog = deps.loadLog ?? new MemoryLoadLog(clock);
  const bitacoraDeCargas = new BitacoraDeCargas(loadLog, clock);
  const matrixScanService = new MatrixScanService({
    repository: excelMatrixRepository,
    clock,
    bitacora: bitacoraDeCargas,
    ...(deps.sharedReviews ? { revisiones: deps.sharedReviews } : {}),
  });
  const rosterService = deps.rosterRepository
    ? new RosterIngestService({
        repository: deps.rosterRepository,
        extractor: deps.rosterExtractor ?? new RosterExtractorAdapter(),
        clock,
        bitacora: bitacoraDeCargas,
        ...(deps.sharedReviews ? { revisiones: deps.sharedReviews } : {}),
      })
    : undefined;
  const sincroniaService = deps.sincroniaRepository
    ? new SincroniaService({ port: deps.sincroniaRepository, clock })
    : undefined;
  const excelService = new ExcelIntegrationService({
    repository: excelRepository,
    matrixRepository: excelMatrixRepository,
    clock,
    scans: matrixScanService,
    ...(rosterService ? { roster: rosterService } : {}),
    ...(config.role === "local"
      ? { apagarLocal: () => programarApagado(deps.apagar ?? apagadoPorOmision) }
      : {}),
    logger: app.log,
  });
  const internalConsoleRepository =
    deps.internalConsoleRepository ?? new MemoryInternalConsoleRepository({ clock });
  const internalAuditService = new InternalAuditService({
    repository: internalConsoleRepository,
    clock,
  });
  const declaredFieldService = new DeclaredFieldService({ repository: internalConsoleRepository });
  const dataPreviewService = new DataPreviewService({ repository: internalConsoleRepository });

  const dc3Certificates = deps.dc3CertificateRepository
    ? new Dc3CertificateService({ repository: deps.dc3CertificateRepository })
    : undefined;

  registerHealthRoute(app, config, clock);
  registerHomeRoute(app, {
    config,
    clock,
    sessionService,
    roomService,
    workbenchService,
    ...(dc3Certificates
      ? {
          dc3PorEmitir: async () => {
            const plan = await dc3Certificates.summarizePlan({
              emission: "pendientes",
              period: "desde-corte",
            });
            return plan.ready + plan.incomplete;
          },
        }
      : {}),
    ...(deps.apagar ? { apagar: deps.apagar } : {}),
  });
  registerShutdownRoutes(app, { config, ...(deps.apagar ? { apagar: deps.apagar } : {}) });
  registerWorkerSystemRoutes(app, config, workerSystemRepository);
  registerKioskRoutes(app, { config, kioskService, sessionService, authService });
  const consoleSessions = deps.sessionSecret
    ? new ConsoleSessionCodec(createHash("sha256").update(deps.sessionSecret).digest())
    : new ConsoleSessionCodec();
  registerSessionRoutes(app, {
    config,
    sessionService,
    kioskService,
    repository: kioskSessionRepository,
    roomService,
    sessions: consoleSessions,
  });
  registerPreReleaseRoutes(app, {
    config,
    workbenchService,
    reportService: preReleaseReportService,
    releaseService,
    sessions: consoleSessions,
  });
  registerReleaseRoutes(app, {
    config,
    releaseService,
    workbenchService,
    sessions: consoleSessions,
    ...(deps.matrixDeliveryRepository
      ? {
          deliveries: new MatrixDeliveryService({ repository: deps.matrixDeliveryRepository }),
        }
      : {}),
  });
  registerRoomRoutes(app, { config, service: roomService });
  registerDc3Routes(app, {
    config,
    workers: workerSystemRepository,
    sessions: consoleSessions,
    clock,
    ...(dc3Certificates ? { certificates: dc3Certificates } : {}),
  });

  registrarDominiosDedicados(app, config);
  registrarGuardiaDeConsola(app, { config, clock, sessions: consoleSessions });

  registerExcelRoutes(app, {
    config,
    service: excelService,
    sessions: consoleSessions,
    clock,
    estado: async () => {
      const [pendientes, acuses] = await Promise.all([
        excelService.pendingReleases(),
        excelRepository.listReleaseAcks(),
      ]);
      return {
        pendientesDeExcel: pendientes.length,
        fechasEscritas: acuses.filter(
          (fila) => fila.status === "APPLIED" || fila.status === "RECOVERED",
        ).length,
      };
    },
  });

  const consoleDirectory = deps.consoleDirectory
    ? new ConsoleDirectoryService({ directory: deps.consoleDirectory, clock })
    : undefined;

  registerAccessRoutes(app, {
    config,
    clock,
    sessions: consoleSessions,
    ...(consoleDirectory ? { directory: consoleDirectory } : {}),
  });

  registerRosterRoutes(app, {
    config,
    clock,
    sessions: consoleSessions,
    ...(rosterService ? { service: rosterService } : {}),
  });
  const extractorDeOcupaciones = deps.rosterExtractor ?? new RosterExtractorAdapter();
  registerOccupationRoutes(app, {
    config,
    extraer: (archivo) => extractorDeOcupaciones.extraer(archivo),
    guion: guionOcupaciones,
    ...(deps.occupationService ? { servicio: deps.occupationService } : {}),
  });

  registerMatrixScanRoutes(app, {
    config,
    clock,
    sessions: consoleSessions,
    ...(deps.excelMatrixRepository ? { service: matrixScanService } : {}),
  });
  registerSyncRoutes(app, {
    config,
    clock,
    sessions: consoleSessions,
    cargas: bitacoraDeCargas,
    ...(sincroniaService ? { service: sincroniaService } : {}),
  });
  registerLoadHistoryRoutes(app, {
    config,
    bitacora: bitacoraDeCargas,
    enMemoria: deps.loadLog === undefined,
    ultimoLote: () => excelRepository.lastAppliedReleaseBatch(),
  });
  registerChangeControlRoutes(app, { config, clock, bitacora: bitacoraDeCargas });
  registerInternalConsoleRoutes(app, {
    config,
    clock,
    sessions: consoleSessions,
    auditService: internalAuditService,
    fieldService: declaredFieldService,
    previewService: dataPreviewService,
  });
  registerAgendaRoutes(app, { config, service: roomService, clock });
  registerAssetRoutes(app);

  app.setNotFoundHandler((peticion, respuesta) => {
    const publico = toPublicError(notFound(), config.environment);
    peticion.log.info("ruta no encontrada");
    return responder(peticion, respuesta, publico);
  });

  app.setErrorHandler((error, peticion, respuesta) => {
    const publico = toPublicError(error, config.environment);
    if (publico.statusCode >= 500) {
      peticion.log.error({ err: error }, "falla no controlada");
    } else {
      peticion.log.warn({ err: error }, "solicitud rechazada");
    }
    return responder(peticion, respuesta, publico);
  });

  return Promise.resolve(app);
}

function prefiereHtml(peticion: FastifyRequest): boolean {
  const accept = peticion.headers.accept;
  return typeof accept === "string" && accept.includes("text/html");
}
