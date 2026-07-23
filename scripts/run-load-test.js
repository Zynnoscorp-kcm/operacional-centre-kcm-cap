#!/usr/bin/env node
import { performance } from "node:perf_hooks";
import { pathToFileURL } from "node:url";
import { createInMemoryCore } from "../src/core/index.js";
import { OCR_DECISIONS } from "../src/shared/contracts.js";

export async function runLoadTest({ recordCount = 500, sessionCapacity = 40 } = {}) {
  const employees = Array.from({ length: recordCount }, (_, index) => ({
    employeeId: String(index + 1).padStart(5, "0"),
    displayName: `Participante sintetico ${index + 1}`,
    area: "AREA_SINTETICA",
    position: "PUESTO_SINTETICO",
    shift: "T1",
    active: true
  }));
  const core = createInMemoryCore({ employees });
  const startedAt = performance.now();
  let captured = 0;

  for (let offset = 0; offset < employees.length; offset += sessionCapacity) {
    const group = employees.slice(offset, offset + sessionCapacity);
    const sessionNumber = Math.floor(offset / sessionCapacity) + 1;
    const session = {
      sessionId: `load-session-${String(sessionNumber).padStart(2, "0")}`,
      authorized: true
    };
    for (const [index, employee] of group.entries()) {
      const common = {
        session,
        actor: "load-test@example.invalid",
        role: "CAPACITACION",
        requestId: `capture-${sessionNumber}-${index}`,
        attendanceProven: true
      };
      if ((offset + index) % 2 === 0) {
        core.capture.registerDigital({ ...common, employeeId: employee.employeeId });
      } else {
        core.capture.registerOcr({
          ...common,
          evidenceId: `synthetic-evidence-${sessionNumber}`,
          candidate: {
            decision: OCR_DECISIONS.AUTO_ACCEPTED,
            normalizedEmployeeId: employee.employeeId
          }
        });
      }
      captured += 1;
    }
    core.exams.reconcile({
      sessionId: session.sessionId,
      receivedExamCount: group.length,
      missingEmployeeIds: [],
      actor: "load-test@example.invalid",
      requestId: `exams-${sessionNumber}`
    });
    await core.release.release({
      sessionId: session.sessionId,
      trainingId: "training-load-synthetic",
      mappingVersion: "v1",
      releaseDate: "2026-07-21",
      actor: "load-test@example.invalid",
      requestId: `release-${sessionNumber}`
    });
  }

  const elapsedMs = performance.now() - startedAt;
  return Object.freeze({
    recordCount,
    sessionCapacity,
    sessionCount: Math.ceil(recordCount / sessionCapacity),
    captured,
    matrixWrites: core.matrix.writeCount,
    effectiveReleases: core.repositories.releases.effectiveCount,
    auditEvents: core.audit.list().length,
    elapsedMs: Number(elapsedMs.toFixed(3)),
    recordsPerSecond: Number((recordCount / (elapsedMs / 1000)).toFixed(2))
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = await runLoadTest();
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

