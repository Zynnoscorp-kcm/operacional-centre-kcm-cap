#!/usr/bin/env node
/**
 * Punto de entrada. Carga la configuración, elige la persistencia, construye el
 * servidor, escucha y cierra ordenadamente.
 *
 * Se ejecuta directamente sobre Node 24, sin paso de compilación: desde la
 * 22.18 Node borra los tipos de TypeScript al cargar el módulo, y en 24 está
 * activo sin bandera.
 *
 * La persistencia se elige aquí y en ningún otro lugar. Con
 * `KCM_DATABASE_URL` la plataforma habla con PostgreSQL; sin ella arranca en
 * memoria, lo que sirve para probar y es inaceptable en producción —por eso
 * `loadConfig` la exige allí—.
 */

import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

import { ConfigError, loadConfig, requireSecret } from "./config/environment.ts";
import { leerAgenteDelEntorno } from "./config/agente-ocupaciones.ts";
import type { ServicioDeOcupacionesPort } from "./domain/ocupaciones/servicio.ts";
import { buildServer, type ServerDeps } from "./server/build-server.ts";
import { PostgresExecutor } from "./adapters/postgres/ejecutor.ts";
import { SupabaseKioskSessionRepository } from "./adapters/postgres/quiosco.ts";
import { SupabasePreReleaseRepository } from "./adapters/postgres/preliberacion.ts";
import { SupabaseMatrixRepository } from "./adapters/postgres/matriz.ts";
import { SupabaseWorkerSystemRepository } from "./adapters/postgres/sistema-trabajador.ts";
import { SupabaseExcelRepository } from "./adapters/postgres/excel.ts";
import { SupabaseReleaseRepository } from "./adapters/postgres/liberacion.ts";
import { SupabaseRoomReservationRepository } from "./adapters/postgres/salas.ts";
import { SupabaseInternalConsoleRepository } from "./adapters/postgres/consola-interna.ts";
import { SupabaseConsoleDirectory } from "./adapters/postgres/directorio-consola.ts";
import { SupabaseRosterRepository } from "./adapters/postgres/padron.ts";
import { SupabaseDc3CertificateRepository } from "./adapters/postgres/dc3-constancia.ts";
import { SupabaseMatrixDeliveryRepository } from "./adapters/postgres/entregas-matriz.ts";
import { SupabaseSincroniaRepository } from "./adapters/postgres/sincronia.ts";
import { FileObjectStore } from "./adapters/archivos/almacen-objetos-disco.ts";
import { PostgresObjectStore } from "./adapters/postgres/almacen-objetos.ts";
import { PostgresSharedReviewStore } from "./adapters/postgres/revisiones-compartidas.ts";
import { SupabaseLoadLog } from "./adapters/postgres/bitacora-cargas.ts";

const SENALES_DE_CIERRE = ["SIGINT", "SIGTERM"] as const;

/**
 * Impide arrancar en memoria cuando existe un `.env` con base declarada.
 *
 * Sin esta guarda, `node plataforma/src/main.ts` sin `--env-file` levanta una
 * plataforma que responde 200 en todas las pantallas y no ve nada de la base.
 * El síntoma no se parece a la causa, porque quiosco y preliberación caen a dos
 * almacenes en memoria distintos y lo que uno escribe el otro no lo ve.
 *
 * Correr en memoria es legítimo; hacerlo por descuido teniendo la base a un
 * `--env-file` de distancia, no.
 */
function exigirQueLaMemoriaSeaDeliberada(): void {
  if ((process.env.KCM_ALLOW_MEMORY ?? "").trim() !== "") return;

  let archivo: string;
  try {
    archivo = readFileSync(new URL("../../.env", import.meta.url), "utf8");
  } catch {
    return; // Sin `.env` no hay nada que contradiga a la memoria.
  }
  if (!/^\s*KCM_DATABASE_URL\s*=\s*\S/mu.test(archivo)) return;

  throw new ConfigError(
    "Hay un .env con KCM_DATABASE_URL, pero el proceso arrancó sin ella: la plataforma " +
      "quedaría en memoria y ninguna pantalla vería la base.\n" +
      "  Arranque con:  npm start   (o node --env-file=.env plataforma/src/main.ts)\n" +
      "  Para correr en memoria a propósito:  KCM_ALLOW_MEMORY=1",
  );
}

/**
 * Construye la plataforma lista para atender, sin escuchar.
 *
 * `main` la usa para escuchar en una máquina; `api/index.js` la usa en la nube,
 * donde el alojamiento entrega cada petición a un manejador exportado y no hay
 * puerto que abrir.
 */
export async function construir(): Promise<{
  readonly app: Awaited<ReturnType<typeof buildServer>>;
  readonly config: ReturnType<typeof loadConfig>;
  readonly db: PostgresExecutor | undefined;
}> {
  const config = loadConfig();

  const deps: ServerDeps = { config };
  let db: PostgresExecutor | undefined;

  if (config.databaseUrl) {
    const maxConexiones = Number(process.env.KCM_DB_POOL_MAX);
    db = new PostgresExecutor(
      config.databaseUrl,
      Number.isInteger(maxConexiones) && maxConexiones > 0 ? { maxConexiones } : {},
    );
    const estado = await db.verificar();
    if (!estado.esquemaListo) {
      throw new ConfigError(
        "La base responde pero no tiene los esquemas de la plataforma. Aplique las migraciones antes de arrancar.",
      );
    }
    Object.assign(deps, {
      kioskSessionRepository: new SupabaseKioskSessionRepository(db),
      preReleaseRepository: new SupabasePreReleaseRepository(
        db,
        // Las evidencias llevan nombres y números de trabajador: nunca van al
        // repositorio ni a un bucket público. Donde hay base van a la base, y
        // así sobreviven a un redespliegue en un alojamiento sin disco
        // persistente. `KCM_STORAGE_DIR` conserva la ruta en disco para quien
        // corra la plataforma en una máquina propia.
        process.env.KCM_STORAGE_DIR
          ? new FileObjectStore(process.env.KCM_STORAGE_DIR)
          : new PostgresObjectStore(db),
      ),
      excelMatrixRepository: new SupabaseMatrixRepository(db),
      workerSystemRepository: new SupabaseWorkerSystemRepository(db),
      excelRepository: new SupabaseExcelRepository(db),
      releaseRepository: new SupabaseReleaseRepository(db),
      roomRepository: new SupabaseRoomReservationRepository(db),
      internalConsoleRepository: new SupabaseInternalConsoleRepository(db),
      // El directorio de `/acceso` sólo existe donde hay base. Sin ella la
      // pantalla sigue cayendo a la credencial del entorno, que es lo único
      // que una corrida en memoria puede ofrecer.
      consoleDirectory: new SupabaseConsoleDirectory(db),
      rosterRepository: new SupabaseRosterRepository(db),
      dc3CertificateRepository: new SupabaseDc3CertificateRepository(db),
      matrixDeliveryRepository: new SupabaseMatrixDeliveryRepository(db),
      sincroniaRepository: new SupabaseSincroniaRepository(db),
      // El barrido y el padrón esperan su «Aplicar» en la base y no sólo en este
      // proceso: publicada con varias instancias, el «Aplicar» puede llegar a
      // otra.
      sharedReviews: new PostgresSharedReviewStore(db),
      // El historial de cargas (qué matriz y qué padrón se aplicaron, y quién)
      // vive en la bitácora de la base; en memoria se perdería con cada instancia.
      loadLog: new SupabaseLoadLog(db),
    } satisfies Partial<ServerDeps>);

    if (estado.pilotoAbierto) {
      process.stderr.write(
        "AVISO: la base tiene una corrida piloto abierta. Los datos son de prueba " +
          "y deben borrarse antes de operar. Ver database/RESET.md.\n",
      );
    }
  } else {
    exigirQueLaMemoriaSeaDeliberada();
    process.stderr.write(
      "AVISO: sin KCM_DATABASE_URL. La plataforma corre en memoria y pierde todo al cerrar.\n",
    );
  }

  // Los secretos se exigen sólo donde hay base: una corrida en memoria es
  // desechable y no debe pedir credenciales para arrancar.
  if (config.databaseUrl) {
    Object.assign(deps, {
      kioskTokenSecret: requireSecret("KCM_KIOSK_TOKEN_SECRET"),
      releaseIntegritySecret: requireSecret("KCM_RELEASE_INTEGRITY_SECRET"),
    } satisfies Partial<ServerDeps>);
  }

  // La llave de las cookies de la consola. En la nube es obligatoria: cada
  // instancia sortearía la suya y la sesión se perdería al cambiar de instancia.
  // En una máquina es opcional; sin ella se sortea al arrancar, como siempre.
  const sessionSecret =
    config.role === "nube"
      ? requireSecret("KCM_SESSION_SECRET")
      : process.env.KCM_SESSION_SECRET?.trim() || undefined;
  if (sessionSecret) Object.assign(deps, { sessionSecret } satisfies Partial<ServerDeps>);

  // El agente de ocupaciones sólo existe con llave de proveedor. Se arma la
  // primera vez que se pide una sugerencia, para que LangGraph no pese en el
  // arranque de las demás pantallas; si el armado falla, el siguiente intento
  // vuelve a probar en vez de heredar el error.
  const agente = leerAgenteDelEntorno();
  if (agente) {
    let servicio: Promise<ServicioDeOcupacionesPort> | undefined;
    const fabrica = () => import("./adapters/ia/agente-ocupaciones.ts");
    Object.assign(deps, {
      occupationService: () =>
        (servicio ??= fabrica()
          .then((modulo) => modulo.armarServicioDeOcupaciones(agente))
          .catch((error: unknown) => {
            servicio = undefined;
            throw error;
          })),
    } satisfies Partial<ServerDeps>);
  }

  const app = await buildServer(deps);
  return { app, config, db };
}

export async function main(): Promise<void> {
  const { app, config, db } = await construir();

  for (const senal of SENALES_DE_CIERRE) {
    process.once(senal, () => {
      app.log.info(`Señal ${senal} recibida; cerrando.`);
      void app
        .close()
        .then(() => db?.close())
        .then(
          () => process.exit(0),
          () => process.exit(1),
        );
    });
  }

  await app.listen({ host: config.host, port: config.port });
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    await main();
  } catch (error) {
    // Una configuración inválida se reporta legible y sin rastro de pila: el
    // rastro no dice nada que el mensaje no diga ya, y quien arranca el proceso
    // no siempre es quien escribió el código.
    if (error instanceof ConfigError) {
      process.stderr.write(`Configuración inválida: ${error.message}\n`);
    } else {
      process.stderr.write(`${String(error)}\n`);
    }
    process.exitCode = 1;
  }
}
