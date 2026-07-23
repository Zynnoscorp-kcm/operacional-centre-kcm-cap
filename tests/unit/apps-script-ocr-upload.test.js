import assert from "node:assert/strict";
import crypto from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";

const source = await readFile(path.resolve("src/apps-script/services/OcrWorkflowService.gs"), "utf8");
const driveSource = await readFile(path.resolve("src/apps-script/repositories/DriveEvidenceRepository.gs"), "utf8");

function fail(code, message) {
  const error = new Error(message);
  error.code = code;
  throw error;
}

function stableId(prefix, value) {
  return `${prefix}-${crypto.createHash("sha256").update(String(value)).digest("hex").slice(0, 40)}`;
}

function createHarness({ failAuditActionOnce = "" } = {}) {
  const tables = {
    SESIONES: [{
      sessionId: "session-upload", sessionCode: "SES-SYNTH-01", status: "CERRADA"
    }],
    OCR_DOCUMENTOS: [], EVIDENCIAS: [], OCR_RESULTADOS: [], EMPLEADOS: [], ASISTENCIAS: []
  };
  const files = new Map();
  const audits = [];
  let locked = false;
  let lockAcquisitions = 0;
  let lockReleases = 0;
  let failDocumentInsertOnce = false;
  let failSessionUpdateOnce = false;
  let pendingAuditFailure = failAuditActionOnce;
  let saveCalls = 0;

  const repository = {
    list(name, predicate) {
      const rows = tables[name] ?? [];
      return predicate ? rows.filter(predicate) : rows;
    },
    findOne(name, predicate) { return this.list(name, predicate)[0] ?? null; },
    insertMany(name, rows) {
      if (name === "OCR_DOCUMENTOS" && failDocumentInsertOnce) {
        failDocumentInsertOnce = false;
        fail("SYNTHETIC_WRITE", "Fallo sintetico de documento");
      }
      tables[name].push(...rows.map((row) => ({ ...row })));
      return rows;
    },
    updateMany(name, keyField, updates) {
      if (name === "SESIONES" && failSessionUpdateOnce) {
        failSessionUpdateOnce = false;
        fail("SYNTHETIC_WRITE", "Fallo sintetico de transicion");
      }
      return updates.map((update) => {
        const row = tables[name].find((item) => String(item[keyField]) === String(update[keyField]));
        if (!row) fail("NOT_FOUND", "Registro sintetico ausente");
        Object.assign(row, update);
        return row;
      });
    }
  };

  const context = vm.createContext({
    Object, String, Number, Array, JSON, RegExp, Date, Math, Error, isFinite,
    KcmConfig: {
      CONTRACT_VERSION: "1.0.0",
      SHEETS: {
        SESSIONS: "SESIONES", OCR_DOCUMENTS: "OCR_DOCUMENTOS", EVIDENCE: "EVIDENCIAS",
        OCR_RESULTS: "OCR_RESULTADOS", EMPLOYEES: "EMPLEADOS", ATTENDANCES: "ASISTENCIAS"
      }
    },
    KcmAuth: {
      requireRoles: () => ({ actor: "synthetic-uploader@example.invalid", role: "CAPACITACION" })
    },
    KcmValidation: {
      fail,
      identifier(value) {
        const text = String(value ?? "");
        if (!/^[A-Za-z0-9_-]{1,100}$/.test(text)) fail("INVALID_IDENTIFIER", "ID invalido");
        return text;
      },
      enumValue(value, allowed) {
        const text = String(value ?? "");
        if (!allowed.includes(text)) fail("INVALID_ENUM", "Enum invalido");
        return text;
      }
    },
    KcmServiceSupport: {
      repository: () => repository,
      session(sessionId) {
        const session = tables.SESIONES.find((row) => row.sessionId === sessionId);
        if (!session) fail("NOT_FOUND", "Sesion ausente");
        return session;
      },
      asBoolean: (value) => value === true || String(value).toLowerCase() === "true",
      parseArray: () => [],
      nowIso: () => "2026-07-22T12:00:00.000Z",
      audit(_identity, input) {
        if (pendingAuditFailure === input.action) {
          pendingAuditFailure = "";
          throw Object.assign(new Error("Fallo sintetico de auditoria"), { code: "CONFLICT", retryable: true });
        }
        audits.push({ ...input });
      }
    },
    KcmDriveEvidenceRepository: {
      parseDataUrl(dataUrl, mimeType) {
        const marker = String(dataUrl).includes("SOURCE-B") ? "b" : "a";
        return {
          bytes: [marker.charCodeAt(0), 1, 2], mimeType, byteSize: 3, pageCount: 1,
          sha256: marker.repeat(64)
        };
      },
      stableId,
      saveOriginal(parsed, fileName) {
        saveCalls += 1;
        const current = files.get(fileName);
        if (current) {
          if (current.sha256 !== parsed.sha256) fail("CONFLICT", "Archivo canonico adulterado");
          return { driveFileId: current.driveFileId, reused: true, fileName };
        }
        const stored = { driveFileId: stableId("drive", fileName), sha256: parsed.sha256 };
        files.set(fileName, stored);
        return { driveFileId: stored.driveFileId, reused: false, fileName };
      }
    },
    LockService: {
      getScriptLock() {
        return {
          tryLock() {
            if (locked) return false;
            locked = true;
            lockAcquisitions += 1;
            return true;
          },
          releaseLock() {
            if (!locked) throw new Error("lock sintetico no adquirido");
            locked = false;
            lockReleases += 1;
          }
        };
      }
    }
  });
  new vm.Script(source, { filename: "OcrWorkflowService.gs" }).runInContext(context);
  return {
    service: context.KcmOcrWorkflowService, tables, files, audits,
    saveCalls: () => saveCalls,
    locks: () => ({ acquisitions: lockAcquisitions, releases: lockReleases }),
    failDocumentInsert() { failDocumentInsertOnce = true; },
    failSessionUpdate() { failSessionUpdateOnce = true; }
  };
}

function uploadInput(marker = "SOURCE-A") {
  return {
    sessionId: "session-upload", mimeType: "image/png",
    dataUrl: `data:image/png;base64,${marker}`
  };
}

function createDriveHarness() {
  const files = [];
  let fileSequence = 0;
  class FakeFile {
    constructor(blob) {
      this.id = `drive-file-${++fileSequence}`;
      this.name = blob.name;
      this.bytes = [...blob.bytes];
    }
    getBlob() { return { getBytes: () => [...this.bytes] }; }
    getId() { return this.id; }
    setSharing() { return this; }
    setDescription() { return this; }
  }
  const folder = {
    getFilesByName(name) {
      const matches = files.filter((file) => file.name === name);
      let index = 0;
      return { hasNext: () => index < matches.length, next: () => matches[index++] };
    },
    createFile(blob) {
      const file = new FakeFile(blob);
      files.push(file);
      return file;
    }
  };
  const context = vm.createContext({
    Object, String, Number, Array, JSON, RegExp, Date, Math, Error, isFinite,
    KcmConfig: {
      isMockMode: () => false,
      property: (name, fallback) => name === "KCM_EVIDENCE_FOLDER_ID" ? "synthetic-folder" : fallback
    },
    KcmValidation: { fail },
    KcmServiceSupport: { asBoolean: (value) => value === true },
    DriveApp: {
      Access: { PRIVATE: "PRIVATE" }, Permission: { NONE: "NONE" },
      getFolderById: () => folder
    },
    Utilities: {
      DigestAlgorithm: { SHA_256: "sha256" }, Charset: { UTF_8: "utf8" },
      computeDigest(_algorithm, value) {
        const bytes = typeof value === "string" ? Buffer.from(value, "utf8") : Buffer.from(value);
        return [...crypto.createHash("sha256").update(bytes).digest()];
      },
      newBlob(bytes, mimeType, name) { return { bytes: [...bytes], mimeType, name }; }
    }
  });
  new vm.Script(driveSource, { filename: "DriveEvidenceRepository.gs" }).runInContext(context);
  return { repository: context.KcmDriveEvidenceRepository, files, folder };
}

test("la carga original usa IDs estables y el replay exacto no duplica Drive ni Sheets", () => {
  const harness = createHarness();
  const first = harness.service.upload(uploadInput());
  const replay = harness.service.upload(uploadInput());

  assert.equal(first.duplicate, false);
  assert.equal(replay.duplicate, true);
  assert.equal(replay.document.documentId, first.document.documentId);
  assert.equal(harness.tables.OCR_DOCUMENTOS.length, 1);
  assert.equal(harness.tables.EVIDENCIAS.length, 1);
  assert.equal(harness.files.size, 1);
  assert.equal(harness.saveCalls(), 1, "el replay resuelve metadatos antes de tocar Drive");
  assert.equal(harness.tables.SESIONES[0].status, "EVIDENCIA_RECIBIDA");
  assert.deepEqual(harness.locks(), { acquisitions: 2, releases: 2 });
});

test("Drive reutiliza el nombre canonico solo si bytes, MIME y hash permanecen integros", () => {
  const harness = createDriveHarness();
  const bytes = [137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3];
  const parsed = {
    bytes, byteSize: bytes.length, mimeType: "image/png",
    sha256: crypto.createHash("sha256").update(Buffer.from(bytes)).digest("hex")
  };
  const first = harness.repository.saveOriginal(parsed, "evidencia-canonica.png");
  const replay = harness.repository.saveOriginal(parsed, "evidencia-canonica.png");
  assert.equal(first.reused, false);
  assert.equal(replay.reused, true);
  assert.equal(replay.driveFileId, first.driveFileId);
  assert.equal(harness.files.length, 1);

  const alteredBytes = [...bytes.slice(0, -1), 9];
  const altered = {
    bytes: alteredBytes, byteSize: alteredBytes.length, mimeType: "image/png",
    sha256: crypto.createHash("sha256").update(Buffer.from(alteredBytes)).digest("hex")
  };
  assert.throws(
    () => harness.repository.saveOriginal(altered, "evidencia-canonica.png"),
    (error) => error.code === "CONFLICT"
  );
});

test("un fallo entre evidencia y documento se reanuda sin duplicar archivo ni metadatos", () => {
  const harness = createHarness();
  harness.failDocumentInsert();
  assert.throws(() => harness.service.upload(uploadInput()), (error) => error.code === "SYNTHETIC_WRITE");
  assert.equal(harness.tables.EVIDENCIAS.length, 1);
  assert.equal(harness.tables.OCR_DOCUMENTOS.length, 0);

  const recovered = harness.service.upload(uploadInput());
  assert.equal(recovered.duplicate, false);
  assert.equal(harness.files.size, 1);
  assert.equal(harness.tables.EVIDENCIAS.length, 1);
  assert.equal(harness.tables.OCR_DOCUMENTOS.length, 1);
  assert.equal(harness.tables.SESIONES[0].status, "EVIDENCIA_RECIBIDA");
});

test("un fallo posterior al documento se repara en replay y queda auditado", () => {
  const harness = createHarness();
  harness.failSessionUpdate();
  assert.throws(() => harness.service.upload(uploadInput()), (error) => error.code === "SYNTHETIC_WRITE");
  assert.equal(harness.tables.OCR_DOCUMENTOS.length, 1);
  assert.equal(harness.tables.SESIONES[0].status, "CERRADA");

  const recovered = harness.service.upload(uploadInput());
  assert.equal(recovered.duplicate, true);
  assert.equal(harness.tables.SESIONES[0].status, "EVIDENCIA_RECIBIDA");
  assert.equal(harness.audits.at(-1).action, "OCR_EVIDENCE_UPLOAD_RECOVERED");
  assert.equal(harness.files.size, 1);
});

test("un fallo de auditoria en la primera carga de OCR se reanuda sin duplicar evidencias", () => {
  const harness = createHarness({ failAuditActionOnce: "OCR_EVIDENCE_STORED" });
  assert.throws(() => harness.service.upload(uploadInput()), /Fallo sintetico de auditoria/);
  assert.equal(harness.tables.OCR_DOCUMENTOS.length, 1);
  assert.equal(harness.tables.EVIDENCIAS.length, 1);
  assert.equal(harness.tables.SESIONES[0].status, "EVIDENCIA_RECIBIDA");
  assert.equal(harness.audits.length, 0);

  const recovered = harness.service.upload(uploadInput());
  assert.equal(recovered.duplicate, true);
  assert.equal(harness.tables.OCR_DOCUMENTOS.length, 1);
  assert.equal(harness.tables.EVIDENCIAS.length, 1);
  assert.equal(harness.audits.filter(({ action }) => action === "OCR_EVIDENCE_STORED").length, 1);
});

test("un segundo documento diferente para la misma sesion falla antes de crear otro archivo", () => {
  const harness = createHarness();
  harness.service.upload(uploadInput());
  assert.throws(() => harness.service.upload(uploadInput("SOURCE-B")), (error) => error.code === "CONFLICT");
  assert.equal(harness.tables.OCR_DOCUMENTOS.length, 1);
  assert.equal(harness.tables.EVIDENCIAS.length, 1);
  assert.equal(harness.files.size, 1);
});

test("beginProcessing repara estados parciales permitidos y bloquea multiples documentos", () => {
  const harness = createHarness();
  const uploaded = harness.service.upload(uploadInput());
  const started = harness.service.beginProcessing(uploaded.document.documentId);
  assert.equal(started.status, "OCR_EN_PROCESO");
  assert.equal(harness.tables.SESIONES[0].status, "OCR_EN_PROCESO");

  harness.tables.OCR_DOCUMENTOS.push({
    ...harness.tables.OCR_DOCUMENTOS[0], documentId: "document-extra", sha256: "b".repeat(64)
  });
  assert.throws(
    () => harness.service.beginProcessing(uploaded.document.documentId),
    (error) => error.code === "INVALID_STATE"
  );
});
