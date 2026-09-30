#!/usr/bin/env node

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

function exigirQueLaMemoriaSeaDeliberada(): void {
  if ((process.env.KCM_ALLOW_MEMORY ?? "").trim() !== "") return;

  let archivo: string;
  try {
    archivo = readFileSync(new URL("../../.env", import.meta.url), "utf8");
  } catch {
    return;
  }
  if (!/^\s*KCM_DATABASE_URL\s*=\s*\S/mu.test(archivo)) return;

  throw new ConfigError(
    "Hay un .env con KCM_DATABASE_URL, pero el proceso arrancó sin ella: la plataforma " +
      "quedaría en memoria y ninguna pantalla vería la base.\n" +
      "  Arranque con:  npm start   (o node --env-file=.env plataforma/src/main.ts)\n" +
      "  Para correr en memoria a propósito:  KCM_ALLOW_MEMORY=1",
  );
}

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
      consoleDirectory: new SupabaseConsoleDirectory(db),
      rosterRepository: new SupabaseRosterRepository(db),
      dc3CertificateRepository: new SupabaseDc3CertificateRepository(db),
      matrixDeliveryRepository: new SupabaseMatrixDeliveryRepository(db),
      sincroniaRepository: new SupabaseSincroniaRepository(db),
      sharedReviews: new PostgresSharedReviewStore(db),
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

  if (config.databaseUrl) {
    Object.assign(deps, {
      kioskTokenSecret: requireSecret("KCM_KIOSK_TOKEN_SECRET"),
      releaseIntegritySecret: requireSecret("KCM_RELEASE_INTEGRITY_SECRET"),
    } satisfies Partial<ServerDeps>);
  }

  const sessionSecret =
    config.role === "nube"
      ? requireSecret("KCM_SESSION_SECRET")
      : process.env.KCM_SESSION_SECRET?.trim() || undefined;
  if (sessionSecret) Object.assign(deps, { sessionSecret } satisfies Partial<ServerDeps>);

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
    if (error instanceof ConfigError) {
      process.stderr.write(`Configuración inválida: ${error.message}\n`);
    } else {
      process.stderr.write(`${String(error)}\n`);
    }
    process.exitCode = 1;
  }
}
