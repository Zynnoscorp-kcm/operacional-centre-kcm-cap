import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";

const ROOT = path.resolve("src/apps-script");
const serviceSource = await readFile(path.join(ROOT, "services/OcrWorkflowService.gs"), "utf8");
const driveSource = await readFile(path.join(ROOT, "repositories/DriveEvidenceRepository.gs"), "utf8");

function fail(code, message) {
  const error = new Error(message);
  error.code = code;
  throw error;
}

function createHarness({ previewValue = "data:image/png;base64,U1lOVEhFVElD" } = {}) {
  const tables = {
    OCR_DOCUMENTOS: [{
      documentId: "document-1", sessionId: "session-1", evidenceId: "evidence-original",
      sha256: "source-hash", mimeType: "image/png", byteSize: 100, pageCount: 1,
      status: "REVISION_OCR", createdBy: "private-actor@example.invalid",
      createdAt: "2026-07-21T12:00:00.000Z", version: "1.0.0", __rowNumber: 2
    }],
    OCR_RESULTADOS: [
      {
        candidateId: "candidate-20", documentId: "document-1", rowIndex: 20,
        rawDigits: "00456", digitConfidences: "[0.9,0.9,0.9,0.9,0.9]",
        overallConfidence: 0.9, normalizedEmployeeId: "00456",
        decision: "REVISION_REQUERIDA", validationFlags: "[\"LOW_CONFIDENCE\"]",
        originalValue: "00456", correctedValue: "", correctionActor: "private@example.invalid",
        correctionAt: "", correctionReason: "dato interno",
        cropEvidenceRefs: JSON.stringify([{
          cropId: "r20-d1", digitIndex: 0,
          visualEvidenceId: "evidence-visual", processedEvidenceId: "evidence-processed"
        }]),
        driveFileId: "must-not-leak", displayName: "must-not-leak"
      },
      {
        candidateId: "candidate-02", documentId: "document-1", rowIndex: 2,
        rawDigits: "00123", digitConfidences: [0.99, 0.99, 0.99, 0.99, 0.99],
        overallConfidence: 0.99, normalizedEmployeeId: "00123",
        decision: "AUTO_ACEPTADO", validationFlags: [], originalValue: "00123",
        processedCropEvidenceId: "evidence-processed"
      }
    ],
    EVIDENCIAS: [
      {
        evidenceId: "evidence-original", sessionId: "session-1", kind: "LISTA_FISICA_ORIGINAL",
        driveFileId: "trusted-original-drive", sha256: "original-hash", mimeType: "image/png",
        immutable: true, createdAt: "2026-07-21T12:00:00.000Z", version: "1.0.0"
      },
      {
        evidenceId: "evidence-visual", sessionId: "session-1", kind: "OCR_CROP_VISUAL",
        driveFileId: "trusted-visual-drive", sha256: "visual-hash", mimeType: "image/png",
        immutable: true, createdAt: "2026-07-21T12:01:00.000Z", version: "1.0.0"
      },
      {
        evidenceId: "evidence-processed", sessionId: "session-1", kind: "OCR_CROP_PROCESSED",
        driveFileId: "trusted-processed-drive", sha256: "processed-hash", mimeType: "image/png",
        immutable: true, createdAt: "2026-07-21T12:02:00.000Z", version: "1.0.0"
      }
    ]
  };
  const audits = [];
  const previews = [];
  const rolesRequested = [];
  const repository = {
    list(name, predicate) {
      const rows = tables[name] ?? [];
      return predicate ? rows.filter(predicate) : rows;
    },
    findOne(name, predicate) {
      return this.list(name, predicate)[0] ?? null;
    },
    insertMany() { throw new Error("write not expected in read test"); },
    updateMany() { throw new Error("write not expected in read test"); }
  };
  const context = vm.createContext({
    Object, String, Number, Array, JSON, RegExp, Date, Math, isFinite,
    KcmConfig: {
      CONTRACT_VERSION: "1.0.0",
      ocrAutoAcceptThreshold: () => 0.98,
      ocrDigitThreshold: () => 0.98,
      ocrRequireHumanReview: () => false,
      SHEETS: {
        OCR_DOCUMENTS: "OCR_DOCUMENTOS", OCR_RESULTS: "OCR_RESULTADOS",
        EVIDENCE: "EVIDENCIAS", EMPLOYEES: "EMPLEADOS", ATTENDANCES: "ASISTENCIAS",
        SESSIONS: "SESIONES", AUDIT: "AUDITORIA"
      }
    },
    KcmAuth: {
      requireRoles(roles) {
        rolesRequested.push([...roles]);
        return { actor: "reviewer@example.invalid", role: "CAPACITACION" };
      }
    },
    KcmValidation: {
      fail,
      identifier(value) {
        const text = String(value ?? "");
        if (!/^[A-Za-z0-9_-]+$/.test(text)) fail("INVALID_IDENTIFIER", "Identificador invalido");
        return text;
      },
      enumValue(value, allowed) {
        const text = String(value ?? "");
        if (!allowed.includes(text)) fail("INVALID_ENUM", "Valor no permitido");
        return text;
      },
      integer(value) { return Number(value); },
      employeeId(value) { return String(value); },
      text(value) { return String(value ?? ""); },
      json(value) { return JSON.stringify(value); }
    },
    KcmServiceSupport: {
      repository: () => repository,
      parseArray(value) {
        if (Array.isArray(value)) return value;
        try { return value ? JSON.parse(String(value)) : []; } catch { return []; }
      },
      asBoolean: (value) => value === true || String(value).toLowerCase() === "true",
      session(sessionId) {
        if (String(sessionId) !== "session-1") fail("NOT_FOUND", "La sesion no existe");
        return { sessionId: "session-1" };
      },
      audit(identity, input) {
        audits.push({ identity, input });
        return input;
      },
      uuid: () => "synthetic-uuid",
      nowIso: () => "2026-07-21T12:00:00.000Z"
    },
    KcmDriveEvidenceRepository: {
      parseDataUrl() { throw new Error("not expected"); },
      saveOriginal() { throw new Error("not expected"); },
      previewEvidence(evidence) {
        previews.push(evidence);
        return previewValue;
      }
    }
  });
  new vm.Script(serviceSource, { filename: "OcrWorkflowService.gs" }).runInContext(context);
  return { service: context.KcmOcrWorkflowService, tables, audits, previews, rolesRequested };
}

test("listOcrCandidates devuelve DTO minimo, sanitizado y ordenado", () => {
  const harness = createHarness();
  const result = harness.service.listCandidates("document-1");
  assert.deepEqual(result.map(({ rowIndex }) => rowIndex), [2, 20]);
  assert.deepEqual(result[1].digitConfidences, [0.9, 0.9, 0.9, 0.9, 0.9]);
  assert.deepEqual(result[1].validationFlags, ["LOW_CONFIDENCE"]);
  assert.deepEqual(Array.from(result[1].evidenceVariants), ["ORIGINAL"]);
  assert.equal(result[1].cropEvidenceRefs[0].cropId, "r20-d1");
  assert.equal(result[1].cropEvidenceRefs[0].digitIndex, 0);
  assert.deepEqual(Array.from(result[1].cropEvidenceRefs[0].evidenceVariants), ["CROP_VISUAL", "CROP_PROCESSED"]);
  assert.equal(Object.hasOwn(result[1].cropEvidenceRefs[0], "visualEvidenceId"), false);
  for (const candidate of result) {
    for (const forbidden of ["displayName", "area", "position", "driveFileId", "correctionActor", "__rowNumber"]) {
      assert.equal(Object.hasOwn(candidate, forbidden), false, `DTO expone ${forbidden}`);
    }
  }
  assert.deepEqual(harness.rolesRequested[0], ["CAPACITACION", "ADMINISTRADOR", "AUDITOR"]);
  assert.equal(harness.audits[0].input.action, "OCR_CANDIDATES_VIEWED");
});

test("los blobs de recorte tienen un limite menor al archivo fuente", () => {
  assert.match(driveSource, /maxReviewCropBytes\(\)/);
  assert.match(driveSource, /\^OCR_CROP/);
  assert.match(driveSource, /maximumBytes > KcmConfig\.maxUploadBytes\(\)/);
});

test("reviewEvidence ignora Drive IDs del cliente y resuelve el vinculo candidato-documento-evidencia", () => {
  const harness = createHarness();
  const result = harness.service.reviewEvidence({
    candidateId: "candidate-20",
    variant: "CROP_VISUAL",
    cropId: "r20-d1",
    driveFileId: "attacker-controlled-drive-id",
    evidenceId: "evidence-processed"
  });
  assert.equal(harness.previews.length, 1);
  assert.equal(harness.previews[0].driveFileId, "trusted-visual-drive");
  assert.equal(result.variant, "CROP_VISUAL");
  assert.equal(result.cropId, "r20-d1");
  assert.equal(result.evidence.sha256, "visual-hash");
  assert.equal(Object.hasOwn(result.evidence, "evidenceId"), false);
  assert.equal(Object.hasOwn(result.evidence, "driveFileId"), false);
  assert.equal(result.dataUrl, "data:image/png;base64,U1lOVEhFVElD");
  assert.equal(harness.audits[0].input.action, "OCR_REVIEW_EVIDENCE_VIEWED");
  assert.equal(harness.audits[0].input.evidenceId, "evidence-visual");
});

test("reviewEvidence rechaza una referencia que cruza sesiones", () => {
  const harness = createHarness();
  harness.tables.EVIDENCIAS.find(({ evidenceId }) => evidenceId === "evidence-visual").sessionId = "session-other";
  assert.throws(
    () => harness.service.reviewEvidence({ candidateId: "candidate-20", cropId: "r20-d1", variant: "CROP_VISUAL" }),
    (error) => error.code === "NOT_FOUND"
  );
  assert.equal(harness.previews.length, 0);
});

test("reviewEvidence agregado devuelve las dos variantes y audita una sola lectura", () => {
  const harness = createHarness();
  const result = harness.service.reviewEvidence({ candidateId: "candidate-20" });
  assert.equal(result.candidateId, "candidate-20");
  assert.equal(result.crops.length, 1);
  assert.deepEqual({
    cropId: result.crops[0].cropId,
    digitIndex: result.crops[0].digitIndex,
    originalDataUrl: result.crops[0].originalDataUrl,
    processedDataUrl: result.crops[0].processedDataUrl,
    originalSha256: result.crops[0].originalSha256,
    processedSha256: result.crops[0].processedSha256
  }, {
    cropId: "r20-d1",
    digitIndex: 0,
    originalDataUrl: "data:image/png;base64,U1lOVEhFVElD",
    processedDataUrl: "data:image/png;base64,U1lOVEhFVElD",
    originalSha256: "visual-hash",
    processedSha256: "processed-hash"
  });
  assert.equal(harness.previews.length, 2);
  assert.equal(harness.audits.length, 1);
  assert.equal(harness.audits[0].input.action, "OCR_REVIEW_CROPS_VIEWED");
  assert.equal(JSON.stringify(result).includes("evidenceId"), false);
  assert.equal(JSON.stringify(result).includes("driveFileId"), false);
});

test("reviewEvidence agregado rechaza una casilla sin ambas variantes antes de leer blobs", () => {
  const harness = createHarness();
  const candidate = harness.tables.OCR_RESULTADOS.find(({ candidateId }) => candidateId === "candidate-20");
  const refs = JSON.parse(candidate.cropEvidenceRefs);
  refs[0].processedEvidenceId = "";
  candidate.cropEvidenceRefs = JSON.stringify(refs);
  assert.throws(
    () => harness.service.reviewEvidence({ candidateId: "candidate-20" }),
    (error) => error.code === "NOT_FOUND"
  );
  assert.equal(harness.previews.length, 0);
  assert.equal(harness.audits.length, 0);
});

test("reviewEvidence agregado representa explicitamente previews nulos en MOCK", () => {
  const harness = createHarness({ previewValue: null });
  const result = harness.service.reviewEvidence({ candidateId: "candidate-20" });
  assert.equal(result.crops[0].originalDataUrl, null);
  assert.equal(result.crops[0].processedDataUrl, null);
  assert.equal(harness.previews.length, 2);
  assert.equal(harness.audits.length, 1);
});

test("reviewEvidence agregado limita la lectura a diez blobs para cinco casillas", () => {
  const harness = createHarness();
  const candidate = harness.tables.OCR_RESULTADOS.find(({ candidateId }) => candidateId === "candidate-20");
  const references = [];
  for (let digitIndex = 0; digitIndex < 5; digitIndex += 1) {
    const visualEvidenceId = `visual-${digitIndex}`;
    const processedEvidenceId = `processed-${digitIndex}`;
    references.push({ cropId: `r20-d${digitIndex + 1}`, digitIndex, visualEvidenceId, processedEvidenceId });
    harness.tables.EVIDENCIAS.push({
      evidenceId: visualEvidenceId, sessionId: "session-1", kind: "OCR_CROP_VISUAL",
      driveFileId: `visual-drive-${digitIndex}`, sha256: `visual-hash-${digitIndex}`,
      mimeType: "image/png", immutable: true, createdAt: "2026-07-21T12:03:00.000Z", version: "1.0.0"
    }, {
      evidenceId: processedEvidenceId, sessionId: "session-1", kind: "OCR_CROP_PROCESSED",
      driveFileId: `processed-drive-${digitIndex}`, sha256: `processed-hash-${digitIndex}`,
      mimeType: "image/png", immutable: true, createdAt: "2026-07-21T12:03:00.000Z", version: "1.0.0"
    });
  }
  candidate.cropEvidenceRefs = JSON.stringify(references);
  const result = harness.service.reviewEvidence({ candidateId: "candidate-20" });
  assert.equal(result.crops.length, 5);
  assert.equal(harness.previews.length, 10);
  assert.equal(harness.audits.length, 1);
});

test("ingestOcrCandidates limita a cinco referencias de casilla por renglon", () => {
  const harness = createHarness();
  const refs = Array.from({ length: 6 }, (_, digitIndex) => ({
    cropId: `crop-${digitIndex}`, digitIndex, visualEvidenceId: "evidence-visual"
  }));
  assert.throws(
    () => harness.service.ingestCandidates({
      documentId: "document-1",
      candidates: [{ rowIndex: 1, rawDigits: "", digitConfidences: [], overallConfidence: 0, cropEvidenceRefs: refs }]
    }),
    (error) => error.code === "INVALID_ARRAY"
  );
});

test("el router expone reviewEvidence sin recibir identificadores Drive", async () => {
  const router = await readFile(path.join(ROOT, "server/Router.gs"), "utf8");
  assert.match(router, /reviewEvidence:\s*function \(\) \{ return KcmOcrWorkflowService\.reviewEvidence\(input\); \}/);
  assert.doesNotMatch(router, /reviewEvidence\(input\.driveFileId\)/);
  assert.doesNotMatch(router, /evidencePreview:\s*function/);
});

test("el esquema reserva referencias separadas para recorte visual y procesado", async () => {
  const config = await readFile(path.join(ROOT, "server/00_Config.gs"), "utf8");
  assert.match(config, /"cropEvidenceId", "cropEvidenceRefs"/);
  assert.doesNotMatch(config, /OCR_RESULTADOS[^\n]*(?:dataUrl|base64|bytes)/i);
});
