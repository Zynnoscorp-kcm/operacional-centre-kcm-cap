import { createHash, randomBytes, randomUUID, scryptSync, timingSafeEqual } from "node:crypto";

import type { Clock } from "../../ports/reloj.ts";
import type { MatrixRepositoryPort } from "../../ports/importacion-matriz.port.ts";
import { DomainError } from "../errores.ts";
import { MatrixImportService } from "../importacion-matriz/servicio.ts";
import type { MatrixSnapshot } from "../importacion-matriz/tipos.ts";
import type { MatrixScanService } from "../barrido-matriz/servicio.ts";
import type { RosterIngestService } from "../padron/ingesta.ts";
import type {
  BridgeRequest,
  Dc3BridgeEvent,
  DeviceCredential,
  ExcelCredentialScope,
  ExcelImportPreview,
  ExcelReleaseAck,
  ExcelRepository,
  PendingExcelRelease,
} from "./tipos.ts";

const PROTOCOL = "KCM_VBA_BRIDGE_V1";
const ACTIONS = new Set([
  "MATRIX_IMPORT_V1",
  "MATRIX_SCAN_V1",
  "ROSTER_SCAN_V1",
  "SCAN_ORDERS_V1",
  "RELEASE_PULL_V1",
  "RELEASE_ACK_V1",
  "DC3_REPORT_V1",
  "STATUS_V1",
]);
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$/;
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

/** El índice parcial de PostgreSQL impide dos credenciales vigentes para la
 * misma instalación. Traducirlo aquí evita que un conflicto esperado se vea
 * como caída 500 en la pantalla. */
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
  // `status` es la segunda línea del protocolo y el cliente la registra con ese
  // nombre antes de leer los pares. Un campo homónimo llega como clave repetida
  // y el cliente aborta con "Respuesta VBA duplicada"; la guarda convierte ese
  // choque en un fallo del servidor, que es donde puede corregirse.
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
  /**
   * Barrido gobernado de la matriz. Es opcional para que una instalación que no
   * lo use conserve el puente exactamente como estaba: sin él, `MATRIX_SCAN_V1`
   * responde que la ruta no está habilitada en lugar de fallar por dentro.
   */
  readonly #scans: MatrixScanService | undefined;
  /** Padrón semanal. Opcional por el mismo motivo que el barrido de matriz. */
  readonly #roster: RosterIngestService | undefined;
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
    logger?: { error(bindings: Record<string, unknown>, message: string): void };
  }) {
    this.#repository = input.repository;
    this.#matrixRepository = input.matrixRepository;
    this.#imports = new MatrixImportService(input.matrixRepository);
    this.#clock = input.clock;
    this.#scans = input.scans;
    this.#roster = input.roster;
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
          "Ya existe una credencial activa para este Client ID, alcance y recurso. Revóquela antes de emitir otra.",
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
      const payload = decodePayload(request.payload);
      const fields = await this.#dispatch(request, payload);
      return response("OK", { requestId: request.requestId, ...fields });
    } catch (error) {
      // Un rechazo de dominio —credencial inválida, nonce repetido, acuse que no
      // casa— no mejora al repetirlo y el cliente no debe insistir. Un fallo
      // interno sí puede ser transitorio (base de datos, red), y el cliente ya
      // sabe reintentar tres veces con el mismo `requestId`, que es un no-op si
      // la primera llamada llegó a tener efecto.
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

  async #dispatch(
    request: BridgeRequest,
    payload: string,
  ): Promise<Record<string, string | number | boolean>> {
    if (request.action === "RELEASE_PULL_V1") {
      // Una sola lectura. `remaining` sale del mismo arreglo que ya se trajo:
      // consultar de nuevo sólo para restarle el tamaño de la página duplicaba
      // el costo de la operación más frecuente del puente, y en una base con
      // presupuesto de lecturas eso se nota antes que cualquier otra cosa.
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
            pending.map((row) => headers.map((key) => row[key as keyof PendingExcelRelease])),
          ),
        ),
      };
    }
    if (request.action === "RELEASE_ACK_V1") return this.#acknowledge(request, payload);
    if (request.action === "DC3_REPORT_V1") return this.#reportDc3(request, payload);
    if (request.action === "SCAN_ORDERS_V1") return this.#scanOrders();
    if (request.action === "MATRIX_SCAN_V1") return this.#scan(request, payload);
    if (request.action === "ROSTER_SCAN_V1") return this.#rosterScan(request, payload);
    if (request.action === "MATRIX_IMPORT_V1") {
      const snapshot = JSON.parse(payload) as MatrixSnapshot;
      const preview = await this.receiveImport(
        request.requestId,
        snapshot,
        `VBA_CLIENT_${request.clientId}`,
      );
      // Una solicitud repetida ya viene confirmada: `receiveBatch` la reconoce por su
      // `requestId`, que el cliente deriva del contenido de la matriz y por lo tanto no cambia
      // mientras la matriz no cambie. Volver a aprobarla exigia la fase VALIDADO y fallaba con
      // FASE_LOTE_INVALIDA, de modo que el ciclo programado se detenia cada vez que corria dos
      // veces sobre la misma matriz, que es justo lo que hace un ciclo programado. Se devuelve
      // el resultado anterior y se declara repetida: el campo ya existia en el protocolo.
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
        // No `status`: choca con la línea de estado del protocolo.
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

  /**
   * Qué barridos encargó la consola. Una sola llamada para los dos.
   *
   * Es la que hace el vigilante del libro en cada vuelta, así que es la más
   * frecuente del puente y la más barata: no toca la base más allá de la
   * credencial y el nonce. Preguntar por la matriz y por el padrón en dos
   * acciones distintas habría duplicado ese costo para siempre.
   */
  #scanOrders(): Record<string, string | number | boolean> {
    const matriz = this.#scans?.ordenVigente();
    const padron = this.#roster?.ordenVigente();
    return {
      matrixPending: matriz !== undefined,
      matrixOrderId: matriz?.ordenId ?? "",
      rosterPending: padron !== undefined,
      rosterOrderId: padron?.ordenId ?? "",
    };
  }

  /**
   * Barrido de la matriz. No escribe nada en el dominio.
   *
   * El cliente ya recorrió la hoja y entrega lo leído; el servidor lo confronta
   * contra SQL y guarda la revisión. Aplicarla es un segundo acto y ocurre en
   * la pantalla, no aquí.
   */
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
      // Nombre largo a propósito: `changes` a secas se confundiría con las
      // fechas, que son el otro cambio que este barrido cuenta.
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

  /**
   * Barrido del padrón semanal. No escribe nada en el dominio.
   *
   * A diferencia de la matriz, aquí viajan los bytes del XLSX y el servidor
   * lo lee con el mismo extractor que usa la subida manual y la línea de
   * comandos. La alternativa —que la VBA interpretara el libro y mandara filas
   * ya normalizadas— habría duplicado en Basic las reglas de encabezados, CURP,
   * fechas y desduplicación entre hojas, y con ello el problema de paridad que
   * la matriz sí tuvo que pagar. La matriz lo paga porque es un XLSB de decenas
   * de megas que sólo Excel lee bien; el padrón es un XLSX de medio mega, así
   * que no hay nada que ganar y sí una segunda interpretación que perder.
   *
   * El cuerpo es JSON y no los bytes crudos porque el transporte del puente
   * mueve texto UTF-8 en todas sus acciones; envolver el archivo en base64
   * dentro de ese JSON conserva esa invariante en lugar de abrirle una
   * excepción binaria al protocolo.
   */
  async #rosterScan(
    request: BridgeRequest,
    payload: string,
  ): Promise<Record<string, string | number | boolean>> {
    if (!this.#roster)
      throw new DomainError(
        "EXCEL_ROSTER_UNAVAILABLE",
        "Esta instalación no tiene base conectada: el padrón no tiene a dónde aplicarse.",
      );

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

    // La huella la calcula el cliente sobre el archivo en disco y el servidor
    // sobre lo que recibió. Compararlas es lo que distingue «el libro cambió»
    // de «el traslado lo corrompió», que se ven igual desde el extractor.
    if (typeof sobre.sha256 === "string" && SHA.test(sobre.sha256)) {
      const recibida = createHash("sha256").update(archivo).digest("hex");
      if (recibida !== sobre.sha256)
        throw new DomainError(
          "EXCEL_ROSTER_CHECKSUM",
          "El padrón llegó con una huella distinta a la que calculó el cliente: se dañó en el traslado.",
        );
    }

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

  /**
   * Liberaciones que Excel todavía no escribió. Es la misma lectura que sirve
   * `RELEASE_PULL_V1`; existe como método propio para que la pantalla y
   * cualquier transporte futuro no tengan que hablar el protocolo de texto del
   * puente VBA.
   */
  pendingReleases(): Promise<readonly PendingExcelRelease[]> {
    return this.#repository.listPendingReleases();
  }

  /**
   * Registra acuses de escritura. Único punto de validación, sin importar
   * quién llegue: hoy el puente VBA con su TSV ya interpretado, mañana el
   * transporte que sea. Que haya más de un transporte no puede significar más
   * de un juego de reglas, porque entonces uno podría registrar un acuse
   * efectivo que el otro rechazaría.
   */
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
        status: row.status ?? "",
        workbookSha256: row.workbookSha256 ?? "",
        destinationAddress: row.destinationAddress ?? "",
        detail: row.detail ?? "",
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
