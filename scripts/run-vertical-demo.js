#!/usr/bin/env node
import { pathToFileURL } from "node:url";
import { createInMemoryCore } from "../src/core/index.js";
import {
  applyHumanCorrection,
  createSyntheticAttendancePng,
  SimulatedOcrProvider,
  TEMPLATE_GEOMETRY,
  runRasterOcrPipeline
} from "../src/ocr/index.js";

export async function runVerticalDemo() {
  let sequence = 0;
  const fixedClock = () => new Date("2026-07-21T12:00:00.000Z");
  const idFactory = () => `synthetic-id-${String(++sequence).padStart(4, "0")}`;
  const employees = ["00001", "00002", "00003"].map((employeeId, index) => ({
    employeeId,
    displayName: `Participante sintetico ${index + 1}`,
    area: "AREA_SINTETICA",
    position: "PUESTO_SINTETICO",
    shift: "T1",
    active: true
  }));
  const employeeRoster = new Set(employees.map(({ employeeId }) => employeeId));
  const core = createInMemoryCore({ employees, clock: fixedClock, idFactory });
  const session = { sessionId: "session-demo-001", authorized: true };

  const digital = core.capture.registerDigital({
    session,
    employeeId: "00001",
    attendanceProven: true,
    actor: "trainer@example.invalid",
    requestId: "request-digital-001",
    evidenceId: "evidence-list-001"
  });

  const ocr = runRasterOcrPipeline({
    bytes: createSyntheticAttendancePng(),
    declaredMimeType: "image/png",
    sessionId: session.sessionId,
    documentId: "ocr-document-001",
    evidenceId: "evidence-list-001",
    actor: "training@example.invalid",
    createdAt: fixedClock().toISOString(),
    employeeRoster,
    provider: new SimulatedOcrProvider(),
    allowSimulatedProvider: true,
    normalizationOptions: {
      quadrilateral: [
        { x: 0, y: 0 },
        { x: TEMPLATE_GEOMETRY.source.width - 1, y: 0 },
        { x: TEMPLATE_GEOMETRY.source.width - 1, y: TEMPLATE_GEOMETRY.source.height - 1 },
        { x: 0, y: TEMPLATE_GEOMETRY.source.height - 1 }
      ]
    },
    recognitionHints: [
      { rowIndex: 1, observedDigits: "00002", digitConfidences: [0.998, 0.998, 0.998, 0.998, 0.998] },
      { rowIndex: 2, observedDigits: "0000?", digitConfidences: [0.99, 0.99, 0.99, 0.99, 0.40] }
    ]
  });
  const corrected = applyHumanCorrection(ocr.candidates[1], {
    correctedValue: "00003",
    actor: "reviewer@example.invalid",
    reason: "Revision visual de las cinco casillas sinteticas",
    correctedAt: "2026-07-21T12:05:00.000Z",
    employeeRoster
  });

  const ocrAuto = core.capture.registerOcr({
    session,
    candidate: ocr.candidates[0],
    attendanceProven: true,
    actor: "training@example.invalid",
    requestId: "request-ocr-001",
    evidenceId: "evidence-list-001"
  });
  const ocrReviewed = core.capture.registerOcr({
    session,
    candidate: corrected.candidate,
    attendanceProven: true,
    actor: "reviewer@example.invalid",
    requestId: "request-ocr-002",
    evidenceId: "evidence-list-001"
  });

  const reconciliation = core.exams.reconcile({
    sessionId: session.sessionId,
    receivedExamCount: 2,
    missingEmployeeIds: ["00003"],
    actor: "training@example.invalid",
    requestId: "request-exams-001"
  });
  const releaseInput = {
    sessionId: session.sessionId,
    trainingId: "training-demo-001",
    mappingVersion: "v1",
    releaseDate: "2026-07-21",
    actor: "training@example.invalid",
    requestId: "request-release-001"
  };
  const preview = core.release.preview(releaseInput);
  const released = await core.release.release(releaseInput);
  const repeated = await core.release.release(releaseInput);

  return Object.freeze({
    contractVersion: digital.version,
    participantAttendanceRoutes: [digital.captureRoute, ocrAuto.captureRoute, ocrReviewed.captureRoute],
    leadingZeroIds: [digital.employeeId, ocrAuto.employeeId, ocrReviewed.employeeId],
    ocr: {
      documentStatus: ocr.document.status,
      sha256: ocr.document.sha256,
      rowsDetected: ocr.segmentation.rowsDetected,
      digitCrops: ocr.segmentation.digitCrops.length,
      normalization: ocr.normalization.mode,
      pixelTransformApplied: ocr.normalization.pixelTransformApplied,
      reviewedRow: corrected.correction.rowIndex,
      correctionBefore: corrected.correction.before,
      correctionAfter: corrected.correction.after
    },
    reconciliation: {
      eligibleAttendanceCount: reconciliation.eligibleAttendanceCount,
      receivedExamCount: reconciliation.receivedExamCount,
      missingEmployeeIds: reconciliation.missingEmployeeIds
    },
    preview: {
      included: preview.included.map(({ employeeId }) => employeeId),
      excluded: preview.excluded.map(({ employeeId, reasons }) => ({ employeeId, reasons }))
    },
    release: {
      status: released.status,
      effectiveWrites: released.effectiveWrites,
      repeatedStatus: repeated.status,
      repeatedEffectiveWrites: repeated.effectiveWrites,
      matrixWriteCount: core.matrix.writeCount
    },
    auditEventCount: core.audit.list().length
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = await runVerticalDemo();
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}
