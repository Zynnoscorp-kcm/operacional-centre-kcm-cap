import { createHash, randomBytes, randomUUID, scryptSync, timingSafeEqual } from "node:crypto";

import type { Clock } from "../../ports/reloj.port.ts";
import type { MatrixRepositoryPort } from "../../ports/importacion-matriz.port.ts";
import { DomainError } from "../comun/errores.ts";
import { MatrixImportService } from "../importacion-matriz/servicio.ts";
import type { MatrixSnapshot } from "../importacion-matriz/tipos.ts";
import type { MatrixScanService } from "../barrido-matriz/servicio.ts";
import type { RosterIngestService } from "../padron/ingesta.ts";
import type {
  BridgeAction,
  BridgeRequest,
  Dc3BridgeEvent,
  DeviceCredential,
  ExcelCredentialScope,
  ExcelImportPreview,
  ExcelReleaseAck,
  ExcelRepository,
  PendingExcelRelease,
  PendingReleaseSession,
  UploadPart,
} from "./tipos.ts";

const PROTOCOL = "KCM_VBA_BRIDGE_V1";
const ACTIONS = new Set([
  "MATRIX_IMPORT_V1",
  "MATRIX_SCAN_V1",
  "ROSTER_SCAN_V1",
  "RELEASE_PULL_V1",
  "RELEASE_SESSIONS_V1",
  "RELEASE_CONTEXT_V1",
  "RELEASE_ACK_V1",
  "DC3_REPORT_V1",
  "STATUS_V1",
  "LOCAL_SHUTDOWN_V1",
  "UPLOAD_PART_V1",
]);
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$/;

const ESTADO_DE_ACUSE: Readonly<Record<string, string>> = {
  APPLIED: "APPLIED",
  RECOVERED: "RECOVERED",
  HEADER_MISMATCH: "HEADER_MISMATCH",
  EXISTING_VALUE: "EXISTING_VALUE",
  DESTINATION_MISSING: "DESTINATION_MISSING",
  REJECTED: "REJECTED",
  HEADER_CONFLICT: "HEADER_MISMATCH",
  EMPLOYEE_NOT_FOUND: "DESTINATION_MISSING",
  EXISTING_VALUE_CONFLICT: "EXISTING_VALUE",
  NEWER_DATE_CONFLICT: "EXISTING_VALUE",
  UNEXPECTED_DATE_CONFLICT: "EXISTING_VALUE",
};

function estadoDeAcuse(estado: string): string {
  return ESTADO_DE_ACUSE[estado] ?? "REJECTED";
}

function detalleDeAcuse(estado: string, detalle: string): string {
  const traducido = estadoDeAcuse(estado);
  if (traducido === estado || estado === "") return detalle;
  return `${estado}: ${detalle}`.slice(0, 500);
}

const PARTIBLES = new Set([
  "MATRIX_IMPORT_V1",
  "MATRIX_SCAN_V1",
  "ROSTER_SCAN_V1",
  "RELEASE_ACK_V1",
  "DC3_REPORT_V1",
]);
const MAXIMO_DE_PARTES = 64;
const LARGO_MAXIMO = 200_000_000;
const VIGENCIA_DE_PARTES_MS = 3_600_000;
const BASE64_WEB = /^[A-Za-z0-9_-]+$/;

function enteroDeParte(valor: string | undefined): number {
  const texto = (valor ?? "").trim();
  return /^\d{1,10}$/.test(texto) ? Number(texto) : Number.NaN;
}
const SHA = /^[a-f0-9]{64}$/;

function hashCredential(secret: string, salt: string): string {
  return scryptSync(secret, Buffer.from(salt, "hex"), 32).toString("hex");
}
function safeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left, "hex");
  const b = Buffer.from(right, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}
function required(value: string, name: string, max = 300): string {
  const result = value.trim();
  if (!result || result.length > max)
    throw new DomainError("INVALID_EXCEL_REQUEST", `${name} no es válido.`);
  return result;
}

function leerSobreDePadron(payload: string): { nombreArchivo: string; archivo: Buffer } {
  let sobre: { fileName?: unknown; sha256?: unknown; content?: unknown };
  try {
    sobre = JSON.parse(payload) as typeof sobre;
  } catch {
    throw new DomainError("INVALID_EXCEL_REQUEST", "El sobre del padrón no es JSON válido.");
  }

  const nombreArchivo = required(
    typeof sobre.fileName === "string" ? sobre.fileName : "",
    "El nombre del archivo",
    200,
  );
  if (typeof sobre.content !== "string" || sobre.content === "")
    throw new DomainError("INVALID_EXCEL_REQUEST", "El sobre del padrón no trae el archivo.");

  const archivo = Buffer.from(sobre.content, "base64");
  if (archivo.length === 0)
    throw new DomainError("INVALID_EXCEL_REQUEST", "El archivo del padrón llegó vacío.");

  if (typeof sobre.sha256 === "string" && SHA.test(sobre.sha256)) {
    const recibida = createHash("sha256").update(archivo).digest("hex");
    if (recibida !== sobre.sha256)
      throw new DomainError(
        "EXCEL_ROSTER_CHECKSUM",
        "El padrón llegó con una huella distinta a la que calculó el cliente: se dañó en el traslado.",
      );
  }
  return { nombreArchivo, archivo };
}

function isActiveCredentialConflict(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const databaseError = error as { code?: unknown; constraint?: unknown; message?: unknown };
  if (databaseError.code !== "23505") return false;
  return (
    databaseError.constraint === "credencial_cliente_vigente_unica" ||
    databaseError.constraint === "credencial_equipo_vigente_unica" ||
    (typeof databaseError.message === "string" &&
      (databaseError.message.includes("credencial_cliente_vigente_unica") ||
        databaseError.message.includes("credencial_equipo_vigente_unica")))
  );
}
function encodePayload(value: string): string {
  return Buffer.from(value, "utf8").toString("base64url");
}
function decodePayload(value: string): string {
  try {
    return Buffer.from(value, "base64url").toString("utf8");
  } catch {
    throw new DomainError("INVALID_EXCEL_REQUEST", "El payload no es base64 web-safe válido.");
  }
}
function response(
  status: "OK" | "ERROR",
  fields: Record<string, string | number | boolean>,
): string {
  if (Object.hasOwn(fields, "status"))
    throw new Error("`status` es una clave reservada del protocolo del puente.");
  return [
    PROTOCOL,
    status,
    ...Object.keys(fields)
      .sort()
      .map((key) => `${key}=${encodeURIComponent(String(fields[key]))}`),
  ].join("\n");
}
function tsv(
  headers: readonly string[],
  rows: readonly (readonly (string | number | boolean)[])[],
): string {
  return [headers, ...rows]
    .map((row) => row.map((cell) => encodeURIComponent(String(cell))).join("\t"))
    .join("\n");
}
function parseTsv(
  value: string,
  headers: readonly string[],
  maximum: number,
): Record<string, string>[] {
  const lines = value.replace(/\r\n?/g, "\n").split("\n").filter(Boolean);
  if (!lines.length || lines.length - 1 > maximum)
    throw new DomainError("INVALID_EXCEL_REQUEST", "El lote TSV no es válido.");
  const decode = (line: string) => line.split("\t").map((cell) => decodeURIComponent(cell));
  const actual = decode(lines[0] ?? "");
  if (actual.join("\u0000") !== headers.join("\u0000"))
    throw new DomainError(
      "INVALID_EXCEL_REQUEST",
      "Los encabezados TSV no coinciden con el contrato.",
    );
  return lines.slice(1).map((line) => {
    const values = decode(line);
    if (values.length !== headers.length)
      throw new DomainError("INVALID_EXCEL_REQUEST", "Una fila TSV no coincide con el contrato.");
    return Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""]));
  });
}

export class ExcelIntegrationService {
  readonly #repository: ExcelRepository;
  readonly #matrixRepository: MatrixRepositoryPort;
  readonly #imports: MatrixImportService;
  readonly #clock: Clock;
  readonly #scans: MatrixScanService | undefined;
  readonly #roster: RosterIngestService | undefined;
  readonly #apagarLocal: (() => void) | undefined;
  readonly #logger:
    | {
        error(bindings: Record<string, unknown>, message: string): void;
      }
    | undefined;

  constructor(input: {
    repository: ExcelRepository;
    matrixRepository: MatrixRepositoryPort;
    clock: Clock;
    scans?: MatrixScanService;
    roster?: RosterIngestService;
    apagarLocal?: () => void;
    logger?: { error(bindings: Record<string, unknown>, message: string): void };
  }) {
    this.#repository = input.repository;
    this.#matrixRepository = input.matrixRepository;
    this.#imports = new MatrixImportService(input.matrixRepository);
    this.#clock = input.clock;
    this.#scans = input.scans;
    this.#roster = input.roster;
    this.#apagarLocal = input.apagarLocal;
    this.#logger = input.logger;
  }

  async issueCredential(input: {
    clientId: string;
    principal: string;
    windowsProfile: string;
    equipment: string;
    scope: ExcelCredentialScope;
    resource: string;
    expiresAt?: string | null;
  }): Promise<{ credential: DeviceCredential; secret: string }> {
    const issuedAt = this.#clock.nowIso();
    if (input.scope !== "PUENTE_VBA" && input.scope !== "POWER_QUERY_LECTURA") {
      throw new DomainError("INVALID_EXCEL_CREDENTIAL", "El alcance de la credencial no existe.");
    }
    const expiresAt = input.expiresAt ?? null;
    if (expiresAt !== null && !(new Date(expiresAt).getTime() > new Date(issuedAt).getTime()))
      throw new DomainError("INVALID_EXCEL_CREDENTIAL", "La credencial debe caducar en el futuro.");
    const secret = randomBytes(32).toString("base64url");
    const salt = randomBytes(16).toString("hex");
    const credential: DeviceCredential = {
      credentialId: randomUUID(),
      clientId: required(input.clientId, "El cliente", 120),
      principal: required(input.principal, "El principal", 160),
      windowsProfile: required(input.windowsProfile, "El perfil", 160),
      equipment: required(input.equipment, "El equipo", 160),
      scope: input.scope,
      resource: required(input.resource, "El recurso", 160),
      salt,
      credentialHash: hashCredential(secret, salt),
      issuedAt,
      expiresAt,
    };
    try {
      await this.#repository.insertCredential(credential);
    } catch (error) {
      if (isActiveCredentialConflict(error)) {
        throw new DomainError(
          "EXCEL_CREDENTIAL_ALREADY_ACTIVE",
          "Ya existe una credencial activa para este Client ID, alcance y recurso. La anterior se revoca antes de emitir otra.",
        );
      }
      throw error;
    }
    return { credential, secret };
  }

  async revokeCredential(
    clientId: string,
    scope: ExcelCredentialScope,
    reason: string,
  ): Promise<void> {
    const active = (await this.#repository.findCredentials(clientId, scope)).filter(
      (row) => !row.revokedAt,
    );
    if (!active.length)
      throw new DomainError("EXCEL_CREDENTIAL_NOT_FOUND", "La credencial no existe.");
    for (const row of active)
      await this.#repository.replaceCredential({
        ...row,
        revokedAt: this.#clock.nowIso(),
        revocationReason: required(reason, "El motivo"),
      });
  }

  async authenticate(
    clientId: string,
    scope: ExcelCredentialScope,
    resource: string,
    secret: string,
  ): Promise<DeviceCredential> {
    const now = this.#clock.nowIso();
    const candidates = await this.#repository.findCredentials(
      required(clientId, "El cliente", 120),
      scope,
    );
    const credential = candidates.find(
      (row) =>
        !row.revokedAt &&
        (row.expiresAt === null || row.expiresAt > now) &&
        row.resource === resource &&
        safeEqual(hashCredential(secret, row.salt), row.credentialHash),
    );
    if (!credential)
      throw new DomainError("UNAUTHORIZED_EXCEL", "La credencial de Excel no está autorizada.");
    const used = { ...credential, lastUsedAt: now };
    await this.#repository.replaceCredential(used);
    return used;
  }

  async handleBridge(request: BridgeRequest): Promise<string> {
    try {
      if (!ACTIONS.has(request.action) || !ID.test(request.requestId) || !ID.test(request.nonce))
        throw new DomainError(
          "INVALID_EXCEL_REQUEST",
          "La solicitud no coincide con el protocolo.",
        );
      const sent = new Date(request.sentAt).getTime();
      const now = new Date(this.#clock.nowIso()).getTime();
      if (!Number.isFinite(sent) || Math.abs(now - sent) > 300_000)
        throw new DomainError("UNAUTHORIZED_EXCEL", "La solicitud expiró.");
      await this.authenticate(request.clientId, "PUENTE_VBA", "bridge", request.credential);
      if (
        !(await this.#repository.useNonce(
          request.clientId,
          request.nonce,
          new Date(now + 600_000).toISOString(),
        ))
      )
        throw new DomainError("UNAUTHORIZED_EXCEL", "La solicitud ya fue recibida.");
      const fields =
        request.action === "UPLOAD_PART_V1"
          ? await this.#receivePart(request, now)
          : await this.#dispatch(request, decodePayload(request.payload));
      return response("OK", { requestId: request.requestId, ...fields });
    } catch (error) {
      const esDeDominio = error instanceof DomainError;
      if (!esDeDominio) {
        this.#logger?.error(
          {
            err: error,
            action: request.action,
            clientId: request.clientId,
            requestId: request.requestId,
          },
          "falla interna del puente VBA",
        );
      }
      const domain = esDeDominio
        ? (error as DomainError)
        : new DomainError("INTERNAL_ERROR", "No fue posible procesar el puente.");
      return response("ERROR", {
        code: domain.code,
        message: domain.message,
        retryable: !esDeDominio,
        requestId: request.requestId || randomUUID(),
      });
    }
  }

  async #receivePart(
    request: BridgeRequest,
    now: number,
  ): Promise<Record<string, string | number | boolean>> {
    const target = (request.target ?? "").trim();
    const part = enteroDeParte(request.part);
    const parts = enteroDeParte(request.parts);
    const length = enteroDeParte(request.length);
    if (!PARTIBLES.has(target))
      throw new DomainError("INVALID_EXCEL_REQUEST", "La parte no dice a qué envío pertenece.");
    if (
      !(parts >= 2 && parts <= MAXIMO_DE_PARTES && part >= 1 && part <= parts) ||
      !(length > 0 && length <= LARGO_MAXIMO) ||
      !BASE64_WEB.test(request.payload) ||
      request.payload.length > length
    )
      throw new DomainError("INVALID_EXCEL_REQUEST", "La parte no es válida.");

    const ahora = new Date(now).toISOString();
    const envio = {
      clientId: request.clientId,
      requestId: request.requestId,
      totalCharacters: length,
    };
    const guardada: UploadPart = {
      ...envio,
      partNumber: part,
      totalParts: parts,
      action: target,
      content: request.payload,
      expiresAt: new Date(now + VIGENCIA_DE_PARTES_MS).toISOString(),
    };
    if (part === 1) await this.#repository.discardUploadParts(envio);
    await this.#repository.saveUploadPart(guardada, ahora);

    const deEsteEnvio = (p: { totalParts: number; action: string }) =>
      p.totalParts === parts && p.action === target;
    const presentes = (await this.#repository.listUploadPartNumbers(envio, ahora)).filter(
      deEsteEnvio,
    );
    if (new Set(presentes.map((p) => p.partNumber)).size < parts) {
      return { uploadPart: part, uploadParts: parts, uploadComplete: false };
    }
    const vigentes = (await this.#repository.listUploadParts(envio, ahora))
      .filter(deEsteEnvio)
      .sort((a, b) => a.partNumber - b.partNumber);
    const completo = vigentes.map((p) => p.content).join("");
    if (completo.length !== length)
      throw new DomainError("INVALID_EXCEL_REQUEST", "Las partes no suman el envío completo.");

    const original: BridgeRequest = {
      ...request,
      action: target as BridgeAction,
      payload: completo,
    };
    const fields = await this.#dispatch(original, decodePayload(completo));
    return { ...fields, uploadParts: parts, uploadComplete: true };
  }

  async #dispatch(
    request: BridgeRequest,
    payload: string,
  ): Promise<Record<string, string | number | boolean>> {
    if (request.action === "RELEASE_PULL_V1") {
      const todas = await this.#repository.listPendingReleases();
      const pending = todas.slice(0, 500);
      const headers = [
        "idempotencyKey",
        "batchId",
        "sessionId",
        "employeeId",
        "trainingId",
        "completionDate",
        "destinationSheet",
        "destinationColumn",
        "headerRow",
        "destinationHeader",
        "targetMappingVersion",
        "overwritePolicy",
      ];
      return {
        count: pending.length,
        blocked: 0,
        remaining: todas.length - pending.length,
        payload: encodePayload(
          tsv(
            headers,
            pending.map((row) => headers.map((key) => row[key as keyof PendingExcelRelease] ?? "")),
          ),
        ),
      };
    }
    if (request.action === "RELEASE_SESSIONS_V1") {
      const sesiones = await this.pendingReleaseSessions();
      const headers = ["sessionId", "sessionCode", "trainingId", "completionDate", "pending"];
      return {
        count: sesiones.length,
        payload: encodePayload(
          tsv(
            headers,
            sesiones.map((fila) => [
              fila.sessionId,
              fila.sessionCode,
              fila.trainingId,
              fila.completionDate,
              String(fila.pending),
            ]),
          ),
        ),
      };
    }
    if (request.action === "RELEASE_CONTEXT_V1") {
      const pendientes = await this.#repository.listPendingReleases();
      const headers = ["idempotencyKey", "workerName", "expectedPreviousDate"];
      return {
        count: pendientes.length,
        payload: encodePayload(
          tsv(
            headers,
            pendientes.map((fila) => [
              fila.idempotencyKey,
              fila.workerName ?? "",
              fila.expectedPreviousDate ?? "",
            ]),
          ),
        ),
      };
    }
    if (request.action === "LOCAL_SHUTDOWN_V1") {
      if (!this.#apagarLocal) {
        throw new DomainError(
          "ACCION_SOLO_LOCAL",
          "Esta acción sólo existe en la computadora del departamento.",
        );
      }
      this.#apagarLocal();
      return { shutdown: true };
    }
    if (request.action === "RELEASE_ACK_V1") return this.#acknowledge(request, payload);
    if (request.action === "DC3_REPORT_V1") return this.#reportDc3(request, payload);
    if (request.action === "MATRIX_SCAN_V1") return this.#scan(request, payload);
    if (request.action === "ROSTER_SCAN_V1") return this.#rosterScan(request, payload);
    if (request.action === "MATRIX_IMPORT_V1") {
      const snapshot = JSON.parse(payload) as MatrixSnapshot;
      const preview = await this.receiveImport(
        request.requestId,
        snapshot,
        `VBA_CLIENT_${request.clientId}`,
      );
      if (preview.phase === "CONFIRMADO") {
        return {
          importId: preview.importId,
          importStatus: preview.phase,
          repeated: true,
          inserted: 0,
          corrected: 0,
          retired: 0,
          reactivated: 0,
          pendingExcel: 0,
          conflicts: 0,
        };
      }
      const result = await this.approveImport(preview.importId, `VBA_CLIENT_${request.clientId}`);
      return {
        importId: result.importId,
        importStatus: result.phase,
        repeated: false,
        inserted: result.inserted,
        corrected: result.corrected,
        retired: result.retired,
        reactivated: result.reactivated,
        pendingExcel: 0,
        conflicts: result.conflicts,
      };
    }
    const pending = await this.#repository.listPendingReleases();
    const acks = await this.#repository.listReleaseAcks();
    const dc3 = await this.#repository.listDc3Events();
    return {
      payload: encodePayload(
        JSON.stringify({
          release: {
            total: pending.length + acks.length,
            pendingExcel: pending.length,
            appliedExcel: acks.filter(
              (row) => row.status === "APPLIED" || row.status === "RECOVERED",
            ).length,
            conflicts: acks.filter((row) => row.status !== "APPLIED" && row.status !== "RECOVERED")
              .length,
          },
          dc3: {
            generated: dc3.filter((row) => row.status === "GENERADO" || row.status === "REPETIDO")
              .length,
            blocked: dc3.filter((row) => row.status === "BLOQUEADO").length,
          },
        }),
      ),
    };
  }

  async #scan(
    request: BridgeRequest,
    payload: string,
  ): Promise<Record<string, string | number | boolean>> {
    if (!this.#scans)
      throw new DomainError(
        "EXCEL_SCAN_UNAVAILABLE",
        "Esta instalación no tiene habilitado el barrido gobernado de la matriz.",
      );

    let snapshot: MatrixSnapshot;
    try {
      snapshot = JSON.parse(payload) as MatrixSnapshot;
    } catch {
      throw new DomainError("INVALID_EXCEL_REQUEST", "El snapshot barrido no es JSON válido.");
    }

    const informe = await this.#scans.registrar({
      snapshot,
      requestId: request.requestId,
      cliente: request.clientId,
    });

    return {
      scanId: informe.barridoId,
      workers: informe.cuadre.trabajadoresEnMatriz,
      newWorkers: informe.cuadre.trabajadoresNuevos,
      missingWorkers: informe.cuadre.trabajadoresAusentes,
      columns: informe.cuadre.columnasEnMatriz,
      newColumns: informe.cuadre.columnasNuevas,
      attributionChanges:
        informe.cuadre.cambiosDePuesto +
        informe.cuadre.cambiosDeArea +
        informe.cuadre.cambiosDeDepartamento,
      newDates: informe.cuadre.fechasNuevas,
      correctedDates: informe.cuadre.fechasCorregidas,
      retiredDates: informe.cuadre.fechasRetiradas,
      conflicts: informe.cuadre.conflictos,
      blocked: informe.bloqueado,
      applied: false,
    };
  }

  async #rosterScan(
    request: BridgeRequest,
    payload: string,
  ): Promise<Record<string, string | number | boolean>> {
    if (!this.#roster)
      throw new DomainError(
        "EXCEL_ROSTER_UNAVAILABLE",
        "Esta instalación no tiene base conectada: el padrón no tiene a dónde aplicarse.",
      );

    const { nombreArchivo, archivo } = leerSobreDePadron(payload);

    const plan = await this.#roster.previsualizar(archivo, nombreArchivo, {
      tipo: "PUENTE_VBA",
      actor: request.clientId,
    });

    return {
      planId: plan.planId,
      workers: plan.cuadre.activosEnArchivo,
      unknownWorkers: plan.cuadre.desconocidos,
      missingWorkers: plan.cuadre.ausentes,
      positionChanges: plan.cuadre.puestosCambiados,
      newPositions: plan.cuadre.puestosNuevos,
      curpToWrite: plan.cuadre.curpPorEscribir,
      hireDatesToFix: plan.cuadre.altasPorCorregir,
      newInductions: plan.cuadre.induccionesNuevas,
      hasCnoColumn: plan.cuadre.traeColumnaCno,
      unchanged: plan.sinCambios,
      applied: false,
    };
  }

  async #acknowledge(request: BridgeRequest, payload: string): Promise<Record<string, number>> {
    const headers = [
      "idempotencyKey",
      "batchId",
      "targetMappingVersion",
      "completionDate",
      "status",
      "workbookSha256",
      "destinationAddress",
      "detail",
    ];
    return this.applyAcknowledgements({
      requestId: request.requestId,
      clientId: request.clientId,
      rows: parseTsv(payload, headers, 1000),
    });
  }

  pendingReleases(): Promise<readonly PendingExcelRelease[]> {
    return this.#repository.listPendingReleases();
  }

  async pendingReleaseSessions(): Promise<readonly PendingReleaseSession[]> {
    const porSesion = new Map<string, PendingReleaseSession>();
    for (const fila of await this.#repository.listPendingReleases()) {
      const previa = porSesion.get(fila.sessionId);
      porSesion.set(fila.sessionId, {
        sessionId: fila.sessionId,
        sessionCode: fila.sessionCode || fila.sessionId,
        trainingId: fila.trainingId,
        completionDate: fila.completionDate,
        pending: (previa?.pending ?? 0) + 1,
      });
    }
    return [...porSesion.values()].sort((a, b) => a.sessionCode.localeCompare(b.sessionCode));
  }

  async applyAcknowledgements(input: {
    readonly requestId: string;
    readonly clientId: string;
    readonly rows: readonly Record<string, string | undefined>[];
  }): Promise<Record<string, number>> {
    const request = { requestId: input.requestId, clientId: input.clientId };
    const rows = input.rows;
    const pending = new Map(
      (await this.#repository.listPendingReleases()).map((row) => [row.idempotencyKey, row]),
    );
    const existing = await this.#repository.listReleaseAcks();
    const inserts: ExcelReleaseAck[] = [];
    let repeated = 0;
    for (const row of rows) {
      const release = pending.get(row.idempotencyKey ?? "");
      const replay = existing.find(
        (ack) => ack.requestId === request.requestId && ack.idempotencyKey === row.idempotencyKey,
      );
      if (replay) {
        repeated += 1;
        continue;
      }
      if (
        !release ||
        release.batchId !== row.batchId ||
        release.targetMappingVersion !== row.targetMappingVersion ||
        release.completionDate !== row.completionDate
      )
        throw new DomainError(
          "EXCEL_ACK_CONFLICT",
          "El acuse no coincide con una liberación pendiente.",
        );
      const effective = row.status === "APPLIED" || row.status === "RECOVERED";
      if (effective && !SHA.test(row.workbookSha256 ?? ""))
        throw new DomainError(
          "INVALID_EXCEL_REQUEST",
          "Un acuse efectivo requiere SHA-256 del libro.",
        );
      inserts.push({
        ackId: randomUUID(),
        requestId: request.requestId,
        clientId: request.clientId,
        idempotencyKey: row.idempotencyKey ?? "",
        batchId: row.batchId ?? "",
        targetMappingVersion: row.targetMappingVersion ?? "",
        completionDate: row.completionDate ?? "",
        status: estadoDeAcuse(row.status ?? ""),
        workbookSha256: row.workbookSha256 ?? "",
        destinationAddress: row.destinationAddress ?? "",
        detail: detalleDeAcuse(row.status ?? "", row.detail ?? ""),
        receivedAt: this.#clock.nowIso(),
      });
    }
    await this.#repository.appendReleaseAcks(inserts);
    return { inserted: inserts.length, repeated };
  }

  async #reportDc3(request: BridgeRequest, payload: string): Promise<Record<string, number>> {
    const headers = [
      "dc3Key",
      "employeeId",
      "courseId",
      "completionDate",
      "status",
      "fileSha256",
      "generatedAt",
      "errorCode",
    ];
    const rows = parseTsv(payload, headers, 2000);
    const existing = await this.#repository.listDc3Events();
    const inserts: Dc3BridgeEvent[] = [];
    let repeated = 0;
    for (const row of rows) {
      const eventId = createHash("sha256")
        .update(`${request.requestId}|${row.dc3Key}|${row.status}`)
        .digest("hex");
      if (existing.some((item) => item.eventId === eventId)) {
        repeated += 1;
        continue;
      }
      if (!/^\d{5}$/.test(row.employeeId ?? ""))
        throw new DomainError("INVALID_EXCEL_REQUEST", "El número de trabajador no es válido.");
      if (
        (row.status === "GENERADO" || row.status === "REPETIDO") &&
        !SHA.test(row.fileSha256 ?? "")
      )
        throw new DomainError("INVALID_EXCEL_REQUEST", "Un DC-3 generado requiere SHA-256.");
      inserts.push({
        eventId,
        requestId: request.requestId,
        clientId: request.clientId,
        dc3Key: row.dc3Key ?? "",
        employeeId: row.employeeId ?? "",
        courseId: row.courseId ?? "",
        completionDate: row.completionDate ?? "",
        status: row.status ?? "",
        fileSha256: row.fileSha256 ?? "",
        generatedAt: row.generatedAt ?? "",
        errorCode: row.errorCode ?? "",
        receivedAt: this.#clock.nowIso(),
      });
    }
    await this.#repository.appendDc3Events(inserts);
    return { inserted: inserts.length, repeated };
  }

  async receiveImport(
    requestId: string,
    snapshot: MatrixSnapshot,
    actor: string,
  ): Promise<ExcelImportPreview> {
    const received = await this.#imports.receiveBatch({
      source: snapshot,
      requestId,
      actorId: actor,
      scope: "FULL",
    });
    if (received.repeated)
      return {
        importId: received.batch.importId,
        requestId,
        phase: received.batch.phase,
        conflicts: 0,
        unknownCourses: 0,
        unknownWorkers: 0,
        inserted: 0,
        corrected: 0,
        retired: 0,
        reactivated: 0,
      };
    if (!received.snapshot)
      throw new DomainError("INVALID_EXCEL_IMPORT", "El snapshot no quedó disponible.");
    const prepared = await this.#imports.prepareBatch(received.batch, received.snapshot, "FULL");
    const validation = await this.#imports.validateBatch(prepared, received.snapshot, {
      actorId: actor,
    });
    await this.#repository.saveImportSnapshot(prepared.importId, received.snapshot);
    return {
      importId: prepared.importId,
      requestId,
      phase: validation.phase,
      conflicts: validation.conflicts.length,
      unknownCourses: validation.unknownCourses.length,
      unknownWorkers: validation.unknownWorkers.length,
      inserted: validation.counts.insertedCount,
      corrected: validation.counts.correctedCount,
      retired: validation.counts.retiredCount,
      reactivated: validation.counts.reactivatedCount,
    };
  }
  async approveImport(importId: string, actor: string): Promise<ExcelImportPreview> {
    const batch = await this.#matrixRepository.findBatchById(importId);
    const snapshot = await this.#repository.getImportSnapshot(importId);
    if (!batch || !snapshot)
      throw new DomainError("EXCEL_IMPORT_NOT_FOUND", "El lote de Excel no existe.");
    await this.#imports.approveBatch(batch, actor);
    const result = await this.#imports.confirmBatch(batch, snapshot, { actorId: actor });
    return {
      importId,
      requestId: batch.requestId,
      phase: result.status,
      conflicts: result.counts.conflictCount,
      unknownCourses: 0,
      unknownWorkers: 0,
      inserted: result.counts.insertedCount,
      corrected: result.counts.correctedCount,
      retired: result.counts.retiredCount,
      reactivated: result.counts.reactivatedCount,
    };
  }
  async workersCsv(clientId: string, resource: string, secret: string): Promise<string> {
    await this.authenticate(clientId, "POWER_QUERY_LECTURA", resource, secret);
    const rows = await this.#repository.listPowerQueryWorkers();
    const escape = (value: unknown) => `"${String(value).replaceAll('"', '""')}"`;
    return (
      [
        ["employeeId", "department", "area", "position", "active"],
        ...rows.map((row) => [row.employeeId, row.department, row.area, row.position, row.active]),
      ]
        .map((row) => row.map(escape).join(","))
        .join("\r\n") + "\r\n"
    );
  }
}
