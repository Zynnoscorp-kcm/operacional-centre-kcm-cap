/**
 * Fábrica del servidor.
 *
 * Devuelve una instancia lista pero sin escuchar: así las pruebas la usan
 * con `inject()` sin abrir un puerto, y `main.ts` es el único lugar del árbol
 * que llama a `listen`.
 */

import { randomUUID } from "node:crypto";
import type { Writable } from "node:stream";
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";

import type { AppConfig } from "../config/environment.ts";
import type { Clock } from "../ports/reloj.ts";
import { systemClock } from "../adapters/reloj-sistema.ts";
import { buildLoggerOptions } from "../observability/logging.ts";
import { registerAccessRoutes } from "../routes/acceso.ts";
import { registerAgendaRoutes } from "../routes/agenda.ts";
import { registerAssetRoutes } from "../routes/estaticos.ts";
import { registerHealthRoute } from "../routes/salud.ts";
import { registerHomeRoute } from "../routes/inicio.ts";
import { registerWorkerSystemRoutes } from "../routes/sistema-trabajador.ts";
import { renderErrorPage } from "../web/pages/error.ts";
import { ConsoleSessionCodec } from "./sesion-consola.ts";
import { notFound, toPublicError, type ErrorPublico } from "./errors.ts";
import { registrarGuardiaDeConsola } from "./guardia.ts";
import type { WorkerSystemRepositoryPort } from "../ports/sistema-trabajador.port.ts";
import { MemoryWorkerSystemRepository } from "../adapters/memoria/sistema-trabajador.ts";
import type { KioskSessionRepositoryPort } from "../ports/quiosco.port.ts";
import { MemoryKioskSessionRepository } from "../adapters/memoria/quiosco.ts";
import { leerCatalogoDeSemilla } from "../adapters/semilla-catalogo.ts";
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
import { Dc3JobService } from "../domain/dc3/tarea.ts";
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
import type { RosterExtractorPort } from "../domain/padron/tipos.ts";
import { RosterExtractorAdapter } from "../adapters/extractor-padron.ts";
import { RosterIngestService } from "../domain/padron/ingesta.ts";
import { BitacoraDeCargas } from "../domain/cargas/bitacora.ts";
import { MemoryLoadLog } from "../adapters/memoria/bitacora-cargas.ts";
import type { LoadLogPort } from "../ports/bitacora-cargas.port.ts";

import { registerRosterRoutes } from "../routes/padron.ts";

export interface ServerDeps {
  readonly config: AppConfig;
  /** Se inyecta para que las pruebas no dependan del reloj de la máquina. */
  readonly clock?: Clock;
  /** Repositorio del Sistema General por Trabajador (Función 8). */
  readonly workerSystemRepository?: WorkerSystemRepositoryPort;
  /** Repositorio de Quiosco y Sesiones (Funciones 1, 2 y 3). */
  readonly kioskSessionRepository?: KioskSessionRepositoryPort;
  /** Repositorio de Preliberación (Función 4). */
  readonly preReleaseRepository?: PreReleaseRepositoryPort;
  /** Repositorio y destino de Liberación (Función 5). */
  readonly releaseRepository?: ReleaseRepositoryPort & MatrixWritePort;
  /** Secreto para firma HMAC de tokens de quiosco. */
  readonly kioskTokenSecret?: string;
  /** Secreto que autentica el journal de liberación y sus marcadores. */
  readonly releaseIntegritySecret?: string;
  /** Repositorio de salas y auditoría (Funciones 6 y 7). */
  readonly roomRepository?: RoomReservationRepository;
  /** Repositorio de credenciales, puente y Power Query (Funciones 10 y 11). */
  readonly excelRepository?: ExcelRepository;
  /** Repositorio de staging de matriz para cargas de Excel. */
  readonly excelMatrixRepository?: MatrixRepositoryPort;
  /** Sustituto verificable del runner DC-3 en pruebas. */
  readonly dc3Runner?: ConstructorParameters<typeof Dc3JobService>[0]["runner"];
  /**
   * Raíz desde la que se resuelve la configuración privada del DC-3. Es
   * inyectable por la misma razón que el reloj: las pruebas necesitan una raíz
   * propia con datos sintéticos, y leer la del proceso las ataría a que la
   * máquina tenga material que no vive en el repositorio.
   */
  readonly projectRoot?: string;
  /**
   * Padrón para la emisión individual de constancias. Sin él, `/dc3` conserva el
   * lote y explica que no hay de dónde emitir una por trabajador.
   */
  readonly dc3CertificateRepository?: Dc3CertificatePort;
  /** Auditoría por secciones, campos declarados y explorador de la base. */
  readonly internalConsoleRepository?: InternalConsolePort;
  /**
   * Directorio de cuentas de `/acceso`. Sin él la pantalla cae a la credencial
   * declarada en el entorno, que es lo que hacía antes de existir la tabla.
   */
  readonly consoleDirectory?: ConsoleDirectoryPort;
  /** Padrón semanal. Sin él la pantalla `/padron` explica que no hay base. */
  readonly rosterRepository?: RosterRepositoryPort;
  /** Lector del XLSX. Se sustituye en pruebas para no depender de un libro real. */
  readonly rosterExtractor?: RosterExtractorPort;
  /**
   * Dónde se asientan las cargas de matriz y padrón. Sin base cae a memoria: el
   * historial dura lo que dure el proceso y la pantalla lo dice.
   */
  readonly loadLog?: LoadLogPort;
  /**
   * Destino de la bitácora. Por omisión la salida estándar. Redirigirlo es lo
   * que permite comprobar en una prueba que lo que sale ya viene saneado.
   */
  readonly logDestination?: Writable;
}

/**
 * Sin scripts y sin orígenes externos. La plataforma se publica por un único
 * FQDN detrás de túnel y no carga nada de terceros; declararlo aquí convierte
 * en falla visible cualquier intento futuro de traer una biblioteca por CDN.
 */
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
    // El `requestId` se genera siempre en el servidor. Aceptarlo por cabecera
    // dejaría que quien llama escoja el identificador con el que queda su
    // propio evento en la bitácora.
    requestIdHeader: false,
    genReqId: () => randomUUID(),
    requestTimeout: config.requestTimeoutMs,
    bodyLimit: 1_048_576,
    routerOptions: { ignoreTrailingSlash: true },
    // De dónde sale `request.ip`. Sin esto Fastify usa la dirección del socket,
    // que detrás de un túnel es la del túnel para todo el mundo: el freno por
    // intentos de `/acceso` dejaba de distinguir equipos y diez contraseñas mal
    // escritas por cualquiera cerraban la puerta a la planta entera durante
    // cinco minutos. Se declara como cuenta de saltos, nunca como `true`, por
    // lo que explica `KCM_TRUST_PROXY` en `config/environment.ts`.
    ...(config.trustedProxyHops > 0 ? { trustProxy: config.trustedProxyHops } : {}),
  });

  /**
   * Las pantallas se manejan con formularios porque la política de contenido
   * prohíbe scripts, y un formulario no manda JSON. Fastify sólo trae el lector
   * de JSON, así que el de formularios se registra aquí, con `URLSearchParams`
   * en lugar de una dependencia nueva.
   *
   * Una clave repetida se vuelve arreglo —así viajan las casillas de un grupo—;
   * una clave única se queda como texto.
   */
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

  /**
   * El padrón semanal llega como archivo, y un archivo no cabe en un formulario
   * urlencoded. El cuerpo se entrega crudo —`Buffer`— y `server/multipart.ts` lo
   * separa en partes; el límite propio de 8 MB no toca el de 1 MB del resto,
   * que sigue siendo el techo de cualquier otra ruta.
   */
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
    // Ninguna pantalla de la plataforma se sirve dentro de un marco ajeno, así
    // que la prohibición es incondicional. Si algún día vuelve a haber una que
    // sí —un panel incrustado en otra aplicación—, esta cabecera no admite
    // lista de orígenes y habrá que dejarla en manos de `frame-ancestors`.
    respuesta.header("x-frame-options", "DENY");
    respuesta.header("cross-origin-opener-policy", "same-origin");
    respuesta.header("cross-origin-resource-policy", "same-origin");
    respuesta.header("permissions-policy", "camera=(), microphone=(), geolocation=()");
    // El quiosco de sala declara la suya en la ruta, porque es la única
    // pantalla con guion. Lo que ya venga fijado no se pisa.
    if (respuesta.getHeader("content-security-policy") === undefined) {
      respuesta.header("content-security-policy", POLITICA_DE_CONTENIDO);
    }
    respuesta.header("x-request-id", String(peticion.id));

    if (config.environment === "production") {
      respuesta.header("strict-transport-security", "max-age=31536000; includeSubDomains");
    }

    // `no-store` por omisión. Sólo la hoja de estilos, que ya fijó su propia
    // cabecera, se cachea. Con datos personales de por medio, una caché es una
    // copia que nadie declaró.
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

  /**
   * Contraseñas del quiosco durante el piloto. `kcm.secreto_operacion` está
   * vacía en la base de la corrida, así que sin esto ni el desbloqueo ni la
   * apertura de sesión pueden aceptar ningún PIN. Un solo
   * `KCM_PILOT_KIOSK_PIN` sirve para los dos alcances; declarar
   * `KCM_PILOT_SESSION_PIN` los separa, como los separa el esquema.
   */
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
  });

  // Liberación (Función 5). El secreto autentica el journal y los marcadores por
  // efecto; en desarrollo cae a un valor fijo, igual que el del quiosco, para
  // que la aplicación arranque sin credenciales.
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
  /**
   * Barrido de la matriz. Comparte el repositorio de matriz con el puente: la
   * revisión que enseña la pantalla y la carga que aplica el ciclo miran las
   * mismas tablas, y por eso los conteos de una predicen a la otra.
   *
   * La orden y la revisión viven en esta instancia, así que una plataforma con
   * varios procesos necesitaría bajarlas a la base antes de repartir tráfico.
   * Con un solo proceso detrás del túnel —lo declarado hoy— no hace falta.
   */
  /**
   * Bitácora de las dos cargas maestras.
   *
   * Se construye antes que los dos servicios porque los dos la comparten: el
   * historial que la pantalla enseña tiene que mezclar matriz y padrón en una
   * sola línea de tiempo, y dos bitácoras separadas no podrían ordenarse entre
   * sí. Sin base cae a la de memoria, que sostiene la pantalla durante la vida
   * del proceso y desaparece con él, que es lo honesto: sin dónde escribir, no
   * hay historial que prometer.
   */
  const loadLog = deps.loadLog ?? new MemoryLoadLog(clock);
  const bitacoraDeCargas = new BitacoraDeCargas(loadLog, clock);
  const matrixScanService = new MatrixScanService({
    repository: excelMatrixRepository,
    clock,
    bitacora: bitacoraDeCargas,
  });
  /**
   * El padrón sólo existe con base: sin repositorio la pantalla se registra
   * igual, para poder decir por qué no se puede subir nada. Se construye aquí y
   * no más abajo porque el puente lo necesita: `ROSTER_SCAN_V1` entrega el
   * archivo a este mismo servicio, de modo que la revisión que deja el
   * barrido es la que la pantalla enseña y la que el botón aplica.
   */
  const rosterService = deps.rosterRepository
    ? new RosterIngestService({
        repository: deps.rosterRepository,
        extractor: deps.rosterExtractor ?? new RosterExtractorAdapter(),
        clock,
        bitacora: bitacoraDeCargas,
      })
    : undefined;
  const excelService = new ExcelIntegrationService({
    repository: excelRepository,
    matrixRepository: excelMatrixRepository,
    clock,
    scans: matrixScanService,
    ...(rosterService ? { roster: rosterService } : {}),
    logger: app.log,
  });
  // Consola interna. Sin base cae al adaptador en memoria, que sostiene los
  // campos declarados y deja vacías las secciones que sin base no existen.
  const internalConsoleRepository =
    deps.internalConsoleRepository ?? new MemoryInternalConsoleRepository({ clock });
  const internalAuditService = new InternalAuditService({
    repository: internalConsoleRepository,
    clock,
  });
  const declaredFieldService = new DeclaredFieldService({ repository: internalConsoleRepository });
  const dataPreviewService = new DataPreviewService({ repository: internalConsoleRepository });

  const projectRoot = deps.projectRoot ?? process.cwd();

  const dc3Service = new Dc3JobService({
    clock,
    projectRoot,
    ...(deps.dc3Runner ? { runner: deps.dc3Runner } : {}),
  });

  registerHealthRoute(app, config, clock);
  registerHomeRoute(app, {
    config,
    clock,
    sessionService,
    roomService,
    workbenchService,
  });
  registerWorkerSystemRoutes(app, config, workerSystemRepository);
  registerKioskRoutes(app, { config, kioskService, sessionService, authService });
  registerSessionRoutes(app, {
    config,
    sessionService,
    kioskService,
    repository: kioskSessionRepository,
    roomService,
  });
  registerPreReleaseRoutes(app, {
    config,
    workbenchService,
    reportService: preReleaseReportService,
  });
  registerReleaseRoutes(app, { config, releaseService, workbenchService });
  registerRoomRoutes(app, { config, service: roomService });
  registerDc3Routes(app, {
    config,
    service: dc3Service,
    workers: workerSystemRepository,
    ...(deps.dc3CertificateRepository
      ? {
          certificates: new Dc3CertificateService({
            repository: deps.dc3CertificateRepository,
            projectRoot,
          }),
        }
      : {}),
  });
  // Una sola instancia: la llave se sortea al construirla, así que dos códecs
  // distintos emitirían cookies que el otro no puede leer. `/acceso` la emite y
  // la consola interna la verifica para saber con qué nombre firmar la
  // bitácora.
  const consoleSessions = new ConsoleSessionCodec();

  // Nadie entra sin sesión salvo la lista blanca de `guardia.ts`. Se registra
  // antes que las rutas para que se lea como lo que es: la puerta, no un
  // detalle de cada pantalla.
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

  // El barrido sólo se ofrece con un repositorio de matriz declarado. Con el de
  // memoria la pantalla compararía contra un catálogo vacío y anunciaría que
  // toda la matriz es nueva, que es cierto y no sirve para nada.
  registerMatrixScanRoutes(app, {
    config,
    clock,
    sessions: consoleSessions,
    ...(deps.excelMatrixRepository ? { service: matrixScanService } : {}),
  });
  // El historial se registra siempre, también sin base: con la bitácora en
  // memoria enseña lo que ocurrió en este proceso y lo dice en pantalla. Una
  // pantalla ausente se leería como «no hubo cargas», que es lo contrario de lo
  // que esta ejecución vino a arreglar.
  registerLoadHistoryRoutes(app, {
    config,
    bitacora: bitacoraDeCargas,
    enMemoria: deps.loadLog === undefined,
  });
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

  // No se llama `ready()` aquí a propósito: `listen()` y `inject()` ya lo
  // hacen, y dejar la instancia abierta permite que una prueba registre una
  // ruta que provoque el error que quiere comprobar, sin abrirle a la
  // aplicación una puerta que sólo existiría para las pruebas.
  return Promise.resolve(app);
}

function prefiereHtml(peticion: FastifyRequest): boolean {
  const accept = peticion.headers.accept;
  return typeof accept === "string" && accept.includes("text/html");
}
