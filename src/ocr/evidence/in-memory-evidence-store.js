import { createHash } from "node:crypto";

const SHA256_PATTERN = /^[a-f0-9]{64}$/;

export class EvidenceStoreError extends Error {
  constructor(code, message, { cause, recoverable = false, rolledBack = false } = {}) {
    super(message, { cause });
    this.name = "EvidenceStoreError";
    this.code = code;
    this.recoverable = recoverable;
    this.rolledBack = rolledBack;
  }
}

class AsyncMutex {
  #tail = Promise.resolve();

  async runExclusive(operation) {
    let release;
    const predecessor = this.#tail;
    this.#tail = new Promise((resolve) => { release = resolve; });
    await predecessor;
    try {
      return await operation();
    } finally {
      release();
    }
  }
}

function fail(code, message, options) {
  throw new EvidenceStoreError(code, message, options);
}

function requiredText(value, field, maxLength = 240) {
  if (typeof value !== "string" || value.trim() === "" || value !== value.trim() || value.length > maxLength) {
    fail("EVIDENCE_STORE_INPUT_INVALID", `${field} debe ser texto no vacio`);
  }
  if (/\p{Cc}/u.test(value)) fail("EVIDENCE_STORE_INPUT_INVALID", `${field} contiene caracteres de control`);
  return value;
}

function bytesCopy(value) {
  if (!Buffer.isBuffer(value) && !(value instanceof Uint8Array)) {
    fail("EVIDENCE_STORE_BYTES_INVALID", "La evidencia debe ser Buffer o Uint8Array");
  }
  if (value.byteLength === 0) fail("EVIDENCE_STORE_BYTES_INVALID", "La evidencia no puede estar vacia");
  return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
}

function containsBinary(value, visited = new Set()) {
  if (Buffer.isBuffer(value) || value instanceof Uint8Array || value instanceof ArrayBuffer) return true;
  if (!value || typeof value !== "object" || visited.has(value)) return false;
  visited.add(value);
  return Object.values(value).some((nested) => containsBinary(nested, visited));
}

function immutableJson(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail("EVIDENCE_STORE_METADATA_INVALID", "metadata debe ser un objeto");
  }
  if (containsBinary(value)) {
    fail("EVIDENCE_STORE_METADATA_BINARY", "metadata no puede contener buffers ni arreglos binarios");
  }
  let copy;
  try {
    copy = structuredClone(value);
  } catch {
    fail("EVIDENCE_STORE_METADATA_INVALID", "metadata debe ser serializable");
  }
  const freeze = (item) => {
    if (!item || typeof item !== "object" || Object.isFrozen(item)) return item;
    Object.values(item).forEach(freeze);
    return Object.freeze(item);
  };
  return freeze(copy);
}

function storageObjectId(evidenceId) {
  return `mem_${createHash("sha256").update(`evidence-store-v1\0${evidenceId}`).digest("base64url").slice(0, 32)}`;
}

function materialFields(record) {
  const metadata = record.metadata;
  return JSON.stringify({
    evidenceId: record.evidenceId,
    sha256: metadata.sha256,
    mimeType: metadata.mimeType,
    documentId: metadata.documentId,
    sessionId: metadata.sessionId,
    candidateId: metadata.candidateId,
    cropId: metadata.cropId,
    rowIndex: metadata.rowIndex,
    digitIndex: metadata.digitIndex,
    variant: metadata.variant,
    kind: metadata.kind,
    width: metadata.width,
    height: metadata.height,
    byteSize: metadata.byteSize
  });
}

export class InMemoryEvidenceStore {
  #byIdempotencyKey = new Map();
  #byEvidenceId = new Map();
  #mutex = new AsyncMutex();
  #nextFailure = null;

  get size() {
    return this.#byEvidenceId.size;
  }

  failNextCommitAfter(writeCount, error = new Error("Fallo sintetico del EvidenceStore")) {
    if (!Number.isInteger(writeCount) || writeCount < 0) {
      throw new TypeError("writeCount debe ser un entero no negativo");
    }
    if (!(error instanceof Error)) throw new TypeError("error debe ser una instancia de Error");
    this.#nextFailure = Object.freeze({ writeCount, error });
  }

  async runTransaction(operation) {
    if (typeof operation !== "function") throw new TypeError("operation debe ser una funcion");
    return this.#mutex.runExclusive(async () => {
      const staged = new Map();
      const transaction = Object.freeze({
        put: (input) => this.#stagePut(staged, input)
      });
      const value = await operation(transaction);
      const summary = this.#commit(staged);
      return Object.freeze({ value, summary });
    });
  }

  getMetadata(evidenceId) {
    const record = this.#byEvidenceId.get(String(evidenceId));
    return record ? immutableJson(record.metadata) : null;
  }

  listMetadata({ documentId } = {}) {
    const records = [];
    for (const record of this.#byEvidenceId.values()) {
      if (documentId != null && record.metadata.documentId !== String(documentId)) continue;
      records.push(immutableJson(record.metadata));
    }
    return Object.freeze(records.sort((left, right) => left.evidenceId.localeCompare(right.evidenceId)));
  }

  readBytes(evidenceId) {
    const record = this.#byEvidenceId.get(String(evidenceId));
    return record ? Buffer.from(record.bytes) : null;
  }

  #stagePut(staged, input) {
    if (!input || typeof input !== "object") fail("EVIDENCE_STORE_INPUT_INVALID", "La escritura de evidencia es invalida");
    const idempotencyKey = requiredText(input.idempotencyKey, "idempotencyKey", 520);
    const evidenceId = requiredText(input.evidenceId, "evidenceId", 180);
    const bytes = bytesCopy(input.bytes);
    const metadataInput = immutableJson(input.metadata);
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    if (typeof metadataInput.sha256 !== "string" || !SHA256_PATTERN.test(metadataInput.sha256)) {
      fail("EVIDENCE_STORE_HASH_INVALID", "metadata.sha256 no es valido");
    }
    if (metadataInput.sha256 !== sha256) {
      fail("EVIDENCE_STORE_HASH_MISMATCH", "Los bytes no coinciden con metadata.sha256");
    }
    const record = Object.freeze({
      idempotencyKey,
      evidenceId,
      bytes,
      metadata: immutableJson({
        ...metadataInput,
        evidenceId,
        driveFileId: storageObjectId(evidenceId),
        byteSize: bytes.byteLength,
        immutable: true
      })
    });

    const existing = this.#byIdempotencyKey.get(idempotencyKey) ?? staged.get(idempotencyKey);
    if (existing) {
      if (existing.evidenceId !== evidenceId || materialFields(existing) !== materialFields(record)) {
        fail("EVIDENCE_IDEMPOTENCY_CONFLICT", "La clave idempotente ya corresponde a otra evidencia");
      }
      return Object.freeze({ evidenceId: existing.evidenceId, repeated: true });
    }
    const evidenceIdOwner = this.#byEvidenceId.get(evidenceId);
    if (evidenceIdOwner && evidenceIdOwner.idempotencyKey !== idempotencyKey) {
      fail("EVIDENCE_ID_COLLISION", "evidenceId ya pertenece a otra clave idempotente");
    }
    staged.set(idempotencyKey, record);
    return Object.freeze({ evidenceId, repeated: false });
  }

  #commit(staged) {
    const snapshotByKey = new Map(this.#byIdempotencyKey);
    const snapshotById = new Map(this.#byEvidenceId);
    const failure = this.#nextFailure;
    this.#nextFailure = null;
    let effectiveWrites = 0;
    try {
      for (const [idempotencyKey, record] of staged) {
        if (failure && effectiveWrites === failure.writeCount) throw failure.error;
        this.#byIdempotencyKey.set(idempotencyKey, record);
        this.#byEvidenceId.set(record.evidenceId, record);
        effectiveWrites += 1;
      }
      return Object.freeze({ effectiveWrites, repeatedWrites: 0 });
    } catch (cause) {
      this.#byIdempotencyKey = snapshotByKey;
      this.#byEvidenceId = snapshotById;
      throw new EvidenceStoreError(
        "EVIDENCE_TRANSACTION_ROLLED_BACK",
        "La transaccion de evidencia fallo y fue revertida por completo",
        { cause, recoverable: true, rolledBack: true }
      );
    }
  }
}
