import { CONTRACT_VERSION } from "../shared/contracts.js";
import { SimulatedOcrProvider } from "./adapters/simulated-provider.js";
import { TEMPLATE_GEOMETRY } from "./config/template-geometry.js";
import { validateInputFile } from "./preprocessing/file-validation.js";
import { createNormalizationPlan } from "./preprocessing/normalization-plan.js";
import { segmentTemplate } from "./segmentation/template-segmenter.js";
import { createOcrCandidates } from "./validation/candidate-validator.js";

export function runLocalOcrPipeline({
  bytes,
  declaredMimeType,
  sessionId,
  documentId,
  evidenceId,
  actor,
  provider = new SimulatedOcrProvider(),
  recognitionHints = [],
  employeeRoster,
  createdAt = new Date().toISOString(),
  fileLimits,
  thresholds
}) {
  for (const [name, value] of Object.entries({ sessionId, documentId, evidenceId, actor })) {
    if (typeof value !== "string" || value.trim() === "") throw new TypeError(`${name} es obligatorio`);
  }
  if (!provider || typeof provider.recognize !== "function") throw new TypeError("El proveedor OCR debe implementar recognize");

  const file = validateInputFile(bytes, { declaredMimeType, limits: fileLimits });
  const normalization = createNormalizationPlan(file);
  const dimensions = normalization.targetDimensions ?? TEMPLATE_GEOMETRY.source;
  const segmentation = segmentTemplate({ width: dimensions.width, height: dimensions.height });
  const recognition = provider.recognize({ segmentation, hints: recognitionHints });
  const candidates = createOcrCandidates(recognition.rows, {
    documentId,
    employeeRoster,
    thresholds
  });
  const requiresReview = candidates.some((candidate) => candidate.decision === "REVISION_REQUERIDA");

  const document = Object.freeze({
    documentId,
    sessionId,
    evidenceId,
    sha256: file.sha256,
    mimeType: file.detectedMimeType,
    byteSize: file.byteSize,
    pageCount: file.pageCount,
    status: requiresReview ? "REVISION_OCR" : "PROCESADO",
    createdBy: actor,
    createdAt: new Date(createdAt).toISOString(),
    version: CONTRACT_VERSION
  });

  return Object.freeze({
    document,
    file,
    normalization,
    segmentation,
    recognition,
    candidates
  });
}
