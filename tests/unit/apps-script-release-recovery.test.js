import assert from "node:assert/strict";
import crypto from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";

const source = await readFile(path.resolve("src/apps-script/services/ReleaseService.gs"), "utf8");
const INTEGRITY_SECRET = "synthetic-release-integrity-secret-2026-tests-only";

function signedBytes(buffer) {
  return [...buffer].map((byte) => byte > 127 ? byte - 256 : byte);
}

function fail(code, message) {
  const error = new Error(message);
  error.code = code;
  throw error;
}

function createValidation() {
  return {
    fail,
    identifier(value) {
      const text = String(value ?? "");
      if (!/^[A-Za-z0-9_-]{1,100}$/.test(text)) fail("INVALID_IDENTIFIER", "Identificador invalido");
      return text;
    },
    employeeId(value) {
      const text = String(value ?? "");
      if (!/^\d{5}$/.test(text)) fail("INVALID_EMPLOYEE_ID", "Numero invalido");
      return text;
    },
    dateIso(value) {
      const text = String(value ?? "");
      if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) fail("INVALID_DATE", "Fecha invalida");
      return text;
    },
    text(value, _field, maximum, required) {
      const text = String(value ?? "").trim();
      if ((required && !text) || text.length > maximum) fail("INVALID_INPUT", "Texto invalido");
      return text;
    },
    integer(value, minimum, maximum) {
      const number = Number(value);
      if (!Number.isInteger(number) || number < minimum || number > maximum) fail("INVALID_NUMBER", "Numero invalido");
      return number;
    },
    enumValue(value, allowed) {
      if (!allowed.includes(String(value))) fail("INVALID_ENUM", "Enum invalido");
      return String(value);
    },
    json(value, maximum) {
      const serialized = JSON.stringify(value);
      if (serialized.length > maximum) fail("INVALID_PAYLOAD", "JSON demasiado grande");
      return serialized;
    }
  };
}

function createHarness({ employeeIds = ["00123"], failures = {}, matrixConflict = false, matrixMixedConflict = false, throwBeforeWrite = false } = {}) {
  let uuid = 0;
  const tables = {
    SESIONES: [{
      sessionId: "session-release", trainingId: "training-release", date: "2026-07-22",
      status: "LISTA_PARA_LIBERAR", authorized: true
    }],
    ASISTENCIAS: employeeIds.map((employeeId, index) => ({
      attendanceId: `attendance-${index + 1}`, sessionId: "session-release", employeeId,
      captureRoute: index ? "OCR" : "DIGITAL", identityValidated: true, attendanceProven: true,
      examStatus: "EXAMEN_CONFIRMADO", status: "EXAMEN_CONFIRMADO", released: false
    })),
    LIBERACIONES: [],
    LIBERACION_LOTES: [],
    AUDITORIA: []
  };
  const matrix = new Map();
  let matrixWriteCalls = 0;
  let currentMappingVersion = "mapping-v1";
  let throwWrite = throwBeforeWrite;
  const failureCounts = { ...failures };

  function maybeFail(key) {
    if (Number(failureCounts[key] ?? 0) > 0) {
      failureCounts[key] -= 1;
      throw new Error(`synthetic failure ${key}`);
    }
  }

  const repository = {
    list(name, predicate) {
      const rows = tables[name] ?? [];
      const copies = rows.map((row) => ({ ...row }));
      return predicate ? copies.filter(predicate) : copies;
    },
    findOne(name, predicate) { return this.list(name, predicate)[0] ?? null; },
    insertMany(name, rows) {
      if (name === "LIBERACIONES") maybeFail("insertRelease");
      tables[name].push(...rows.map((row) => ({ ...row })));
      return rows;
    },
    updateMany(name, keyField, updates) {
      if (name === "LIBERACION_LOTES") {
        const phase = updates[0]?.phase;
        if (phase === "MATRIZ_APLICADA") maybeFail("batchMatrix");
        if (phase === "DOMINIO_APLICADO") maybeFail("batchDomain");
        if (phase === "COMPLETADO") maybeFail("batchComplete");
      }
      if (name === "SESIONES") maybeFail("sessionUpdate");
      return updates.map((patch) => {
        const row = tables[name].find((item) => String(item[keyField]) === String(patch[keyField]));
        if (!row) fail("NOT_FOUND", "Registro sintetico ausente");
        Object.assign(row, patch);
        return { ...row };
      });
    },
    replaceOne(name, keyField, replacement) {
      if (name === "LIBERACION_LOTES") {
        if (replacement.phase === "MATRIZ_APLICADA") maybeFail("batchMatrix");
        if (replacement.phase === "DOMINIO_APLICADO") maybeFail("batchDomain");
        if (replacement.phase === "COMPLETADO") maybeFail("batchComplete");
      }
      const row = tables[name].find((item) => String(item[keyField]) === String(replacement[keyField]));
      if (!row) fail("NOT_FOUND", "Registro sintetico ausente");
      Object.keys(row).forEach((field) => delete row[field]);
      Object.assign(row, replacement);
      return { ...row };
    }
  };

  function preReleasePreview() {
    const session = { ...tables.SESIONES[0] };
    const participants = tables.ASISTENCIAS.map((row) => ({
      ...row,
      sessionAuthorized: session.authorized === true,
      blockingReasons: [
        ...(row.identityValidated === true ? [] : ["IDENTIDAD_INVALIDA"]),
        ...(row.attendanceProven === true ? [] : ["ASISTENCIA_NO_COMPROBADA"]),
        ...(row.examStatus === "EXAMEN_CONFIRMADO" ? [] : ["EXAMEN_NO_CONFIRMADO"]),
        ...(session.authorized === true ? [] : ["SESION_NO_AUTORIZADA"]),
        ...(row.released ? ["YA_LIBERADO_PREVIAMENTE"] : [])
      ]
    }));
    return {
      session,
      participants,
      included: participants.filter((row) => row.blockingReasons.length === 0),
      excluded: participants.filter((row) => row.blockingReasons.length > 0),
      ocrExclusions: [],
      counts: { total: participants.length, included: participants.filter((row) => !row.released).length, excluded: participants.filter((row) => row.released).length, ocrCandidateRows: 0, ocrExcludedRows: 0 }
    };
  }

  function makePlan(session, included) {
    const mapping = {
      trainingId: session.trainingId, destinationSheet: "HC", destinationColumn: "J",
      destinationHeader: "CURSO SINTETICO", headerRow: 3,
      mappingVersion: currentMappingVersion, overwritePolicy: "NO_OVERWRITE"
    };
    return {
      session: { ...session }, mapping, completionDate: session.date,
      entries: included.map((item) => ({
        attendanceId: item.attendanceId, employeeId: item.employeeId,
        trainingId: session.trainingId, mappingVersion: mapping.mappingVersion,
        idempotencyKey: `${session.sessionId}|${item.employeeId}|${session.trainingId}|${mapping.mappingVersion}`,
        completionDate: session.date
      }))
    };
  }

  function publicResult(entry, status) {
    return { ...entry, status };
  }

  const matrixGateway = {
    plan: makePlan,
    commitSupported: () => true,
    assertWriteSupported: () => true,
    preview(plan) {
      if (matrixMixedConflict) {
        return plan.entries.map((entry, index) => publicResult(entry, index === 0 ? "ALREADY_APPLIED" : "EXISTING_VALUE_CONFLICT"));
      }
      if (matrixConflict) {
        return plan.entries.map((entry, index) => publicResult(entry, index === plan.entries.length - 1 ? "EXISTING_VALUE_CONFLICT" : "ATOMIC_BATCH_ABORTED"));
      }
      return plan.entries.map((entry) => publicResult(entry, matrix.has(entry.idempotencyKey) ? "IDEMPOTENCY_CONFLICT" : "READY"));
    },
    write(plan, context) {
      matrixWriteCalls += 1;
      if (throwWrite) { throwWrite = false; throw new Error("synthetic worker before matrix write"); }
      const recovered = plan.entries.every((entry) => {
        const existing = matrix.get(entry.idempotencyKey);
        return existing && existing.batchId === context.batchId && existing.planHash === context.planHash;
      });
      if (!recovered && plan.mapping.mappingVersion !== currentMappingVersion) fail("RELEASE_CONFLICT", "mapping changed");
      return plan.entries.map((entry) => {
        const existing = matrix.get(entry.idempotencyKey);
        if (existing) {
          const sameBatch = existing.batchId === context.batchId && existing.planHash === context.planHash;
          return publicResult(entry, sameBatch ? "RECOVERED" : "IDEMPOTENCY_CONFLICT");
        }
        matrix.set(entry.idempotencyKey, {
          completionDate: entry.completionDate, batchId: context.batchId, planHash: context.planHash
        });
        return publicResult(entry, "WRITTEN");
      });
    },
    verifyApplied(plan, context, expectedResults) {
      for (const result of expectedResults) {
        const existing = matrix.get(result.idempotencyKey);
        if (!existing || existing.batchId !== context.batchId || existing.planHash !== context.planHash ||
            !["WRITTEN", "RECOVERED", "ALREADY_APPLIED"].includes(result.status)) {
          fail("RELEASE_CONFLICT", "matrix effect missing");
        }
      }
      return expectedResults.map((entry) => publicResult(entry, "RECOVERED"));
    }
  };

  const serviceSupport = {
    repository: () => repository,
    uuid: () => `synthetic-${++uuid}`,
    nowIso: () => "2026-07-22T12:00:00.000Z",
    asBoolean: (value) => value === true || String(value).toLowerCase() === "true",
    session(sessionId) {
      const row = tables.SESIONES.find((item) => item.sessionId === sessionId);
      if (!row) fail("NOT_FOUND", "Sesion ausente");
      return { ...row };
    },
    audit(_identity, input) {
      if (input.action === "RELEASE_BLOCKED") maybeFail("auditBlocked");
      const event = { eventId: `audit-${++uuid}`, timestamp: "2026-07-22T12:00:00.000Z", ...input };
      tables.AUDITORIA.push(event);
      return event;
    }
  };

  const context = vm.createContext({
    Array, Boolean, Date, Error, JSON, Math, Number, Object, RegExp, String,
    KcmConfig: {
      CONTRACT_VERSION: "1.0.0",
      releaseIntegritySecret: () => INTEGRITY_SECRET,
      SHEETS: {
        SESSIONS: "SESIONES", ATTENDANCES: "ASISTENCIAS", RELEASES: "LIBERACIONES",
        RELEASE_BATCHES: "LIBERACION_LOTES", AUDIT: "AUDITORIA"
      }
    },
    KcmValidation: createValidation(),
    KcmAuth: { requireRoles: () => ({ actor: "operator@example.invalid", role: "CAPACITACION" }) },
    KcmServiceSupport: serviceSupport,
    KcmPreReleaseService: { preview: preReleasePreview },
    KcmMatrixGateway: matrixGateway,
    LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock: () => undefined }) },
    Utilities: {
      DigestAlgorithm: { SHA_256: "sha256" }, Charset: { UTF_8: "utf8" },
      computeDigest(_algorithm, value) { return signedBytes(crypto.createHash("sha256").update(String(value)).digest()); },
      computeHmacSha256Signature(value, secret) {
        return signedBytes(crypto.createHmac("sha256", secret).update(String(value)).digest());
      }
    }
  });
  new vm.Script(source, { filename: "ReleaseService.gs" }).runInContext(context);
  return {
    service: context.KcmReleaseService,
    tables,
    matrix,
    matrixWriteCalls: () => matrixWriteCalls,
    setMappingVersion: (value) => { currentMappingVersion = value; },
    resignBatch(batch) {
      const payload = [
        batch.batchId, batch.sessionId, batch.requestId, batch.mappingVersion,
        batch.planHash, batch.plan, batch.results, batch.phase, batch.status,
        batch.createdBy, batch.createdAt, batch.updatedAt, batch.version
      ].map(String).join("\n");
      batch.journalMac = crypto.createHmac("sha256", INTEGRITY_SECRET)
        .update(`RELEASE_JOURNAL_V1\n${payload}`).digest("hex");
    }
  };
}

const input = Object.freeze({ sessionId: "session-release", requestId: "request-release" });

test("reanuda si la matriz se escribio pero fallo persistir la fase y no duplica efectos", () => {
  const harness = createHarness({ failures: { batchMatrix: 1 } });
  assert.throws(() => harness.service.execute(input), /synthetic failure batchMatrix/);
  assert.equal(harness.matrix.size, 1);
  assert.equal(harness.tables.LIBERACION_LOTES[0].phase, "PENDIENTE");

  const recovered = harness.service.execute(input);
  assert.equal(recovered.release.status, "LIBERADA_TOTAL");
  assert.equal(recovered.results[0].status, "RECOVERED");
  assert.equal(harness.tables.ASISTENCIAS[0].released, true);
  assert.equal(harness.tables.LIBERACIONES.length, 1);
  assert.equal(harness.tables.LIBERACION_LOTES[0].phase, "COMPLETADO");
  assert.equal(harness.tables.AUDITORIA.filter((event) => event.action === "MATRIX_RELEASED").length, 1);

  const replay = harness.service.execute(input);
  assert.equal(replay.repeated, true);
  assert.equal(harness.tables.LIBERACIONES.length, 1);
  assert.equal(harness.tables.AUDITORIA.filter((event) => event.action === "MATRIX_RELEASED").length, 1);
});

test("reanuda despues de marcar asistencia y antes de crear la liberacion efectiva", () => {
  const harness = createHarness({ failures: { insertRelease: 1 } });
  assert.throws(() => harness.service.execute(input), /synthetic failure insertRelease/);
  assert.equal(harness.tables.ASISTENCIAS[0].released, true);
  assert.equal(harness.tables.LIBERACION_LOTES[0].phase, "MATRIZ_APLICADA");
  assert.equal(harness.tables.LIBERACIONES.length, 0);

  const recovered = harness.service.execute(input);
  assert.equal(recovered.release.status, "LIBERADA_TOTAL");
  assert.equal(harness.tables.LIBERACIONES.length, 1);
  assert.equal(harness.matrix.size, 1);
  assert.equal(harness.matrixWriteCalls(), 1);
});

test("repara cierre y auditoria sin duplicar eventos si falla completar el journal", () => {
  const harness = createHarness({ failures: { batchComplete: 1 } });
  assert.throws(() => harness.service.execute(input), /synthetic failure batchComplete/);
  assert.equal(harness.tables.SESIONES[0].status, "LIBERADA_TOTAL");
  assert.equal(harness.tables.LIBERACION_LOTES[0].phase, "DOMINIO_APLICADO");
  assert.equal(harness.tables.AUDITORIA.filter((event) => event.action === "RELEASE_COMPLETED").length, 1);

  const recovered = harness.service.execute(input);
  assert.equal(recovered.release.phase, "COMPLETADO");
  assert.equal(harness.tables.AUDITORIA.filter((event) => event.action === "RELEASE_COMPLETED").length, 1);
});

test("un conflicto de matriz aborta el lote completo antes de tocar asistencias", () => {
  const harness = createHarness({ employeeIds: ["00123", "00456"], matrixConflict: true });
  const preview = harness.service.preview("session-release");
  assert.equal(preview.atomicBatchReady, false);
  assert.equal(preview.included.length, 0);
  assert.deepEqual(preview.excluded.slice(-2).map((item) => item.reasons[0]), ["ATOMIC_BATCH_ABORTED", "EXISTING_VALUE_CONFLICT"]);

  const result = harness.service.execute(input);
  assert.equal(result.release.phase, "CONFLICTO");
  assert.equal(harness.matrix.size, 0);
  assert.ok(harness.tables.ASISTENCIAS.every((row) => row.released === false));
  assert.equal(harness.tables.LIBERACIONES.length, 0);
});

test("un conflicto mixto no adopta efectos previos ni declara el lote completado", () => {
  const harness = createHarness({ employeeIds: ["00123", "00456"], matrixMixedConflict: true });
  const result = harness.service.execute(input);

  assert.equal(result.release.phase, "CONFLICTO");
  assert.equal(harness.matrixWriteCalls(), 0);
  assert.ok(harness.tables.ASISTENCIAS.every((row) => row.released === false));
  assert.equal(harness.tables.LIBERACIONES.length, 0);
  assert.equal(harness.tables.AUDITORIA.filter((event) => event.action === "RELEASE_BLOCKED").length, 1);
});

test("cada efecto usa una Release individual y el lote vive en su propio journal", () => {
  const harness = createHarness({ employeeIds: ["00123", "00456"] });
  const result = harness.service.execute(input);
  assert.equal(result.release.status, "LIBERADA_TOTAL");
  assert.equal(harness.tables.LIBERACIONES.length, 2);
  assert.equal(harness.tables.LIBERACION_LOTES.length, 1);
  for (const release of harness.tables.LIBERACIONES) {
    assert.match(release.idempotencyKey, /^session-release\|\d{5}\|training-release\|mapping-v1$/);
    assert.equal(JSON.parse(release.included).length, 1);
    assert.deepEqual(JSON.parse(release.excluded), []);
    assert.equal(release.status, "APLICADA");
  }
});

test("un PENDIENTE falla cerrado si el mapeo activo cambia antes del commit", () => {
  const harness = createHarness({ throwBeforeWrite: true });
  assert.throws(() => harness.service.execute(input), /synthetic worker before matrix write/);
  harness.setMappingVersion("mapping-v2");
  assert.throws(() => harness.service.execute(input), (error) => error.code === "RELEASE_CONFLICT");
  assert.equal(harness.tables.ASISTENCIAS[0].released, false);
  assert.equal(harness.tables.LIBERACION_LOTES[0].phase, "PENDIENTE");
});

test("un requestId nuevo no adopta el efecto de un lote pendiente", () => {
  const harness = createHarness({ failures: { batchMatrix: 1 } });
  assert.throws(() => harness.service.execute(input), /synthetic failure batchMatrix/);
  assert.equal(harness.matrix.size, 1);

  assert.throws(
    () => harness.service.execute({ sessionId: input.sessionId, requestId: "request-release-new" }),
    (error) => error.code === "RELEASE_CONFLICT" && /requestId original/.test(error.message)
  );
  assert.equal(harness.tables.LIBERACION_LOTES.length, 1);
  assert.equal(harness.tables.ASISTENCIAS[0].released, false);
  assert.equal(harness.tables.LIBERACIONES.length, 0);

  const recovered = harness.service.execute(input);
  assert.equal(recovered.results[0].status, "RECOVERED");
});

test("reanudar falla cerrado si se revoca autorizacion despues del efecto de matriz", () => {
  const harness = createHarness({ failures: { batchMatrix: 1 } });
  assert.throws(() => harness.service.execute(input), /synthetic failure batchMatrix/);
  harness.tables.SESIONES[0].authorized = false;

  assert.throws(() => harness.service.execute(input), (error) => error.code === "INVALID_STATE");
  assert.equal(harness.matrixWriteCalls(), 1);
  assert.equal(harness.tables.ASISTENCIAS[0].released, false);
  assert.equal(harness.tables.LIBERACIONES.length, 0);
});

test("revalida elegibilidad antes de reintentar el primer efecto", () => {
  const harness = createHarness({ throwBeforeWrite: true });
  assert.throws(() => harness.service.execute(input), /synthetic worker before matrix write/);
  harness.tables.ASISTENCIAS[0].examStatus = "EXAMEN_NO_ENCONTRADO";

  assert.throws(() => harness.service.execute(input), (error) => error.code === "RELEASE_CONFLICT");
  assert.equal(harness.matrixWriteCalls(), 1);
  assert.equal(harness.matrix.size, 0);
  assert.equal(harness.tables.ASISTENCIAS[0].released, false);
});

test("un lote PENDIENTE no escribe si la sesion pasa a ERROR", () => {
  const harness = createHarness({ throwBeforeWrite: true });
  assert.throws(() => harness.service.execute(input), /synthetic worker before matrix write/);
  harness.tables.SESIONES[0].status = "ERROR";

  assert.throws(() => harness.service.execute(input), (error) => error.code === "INVALID_STATE");
  assert.equal(harness.matrixWriteCalls(), 1);
  assert.equal(harness.matrix.size, 0);
  assert.equal(harness.tables.LIBERACIONES.length, 0);
});

test("alterar phase o results sin journalMac valido se detecta antes de efectos", () => {
  const harness = createHarness({ throwBeforeWrite: true });
  assert.throws(() => harness.service.execute(input), /synthetic worker before matrix write/);
  const batch = harness.tables.LIBERACION_LOTES[0];
  batch.phase = "MATRIZ_APLICADA";
  batch.results = "[]";

  assert.throws(
    () => harness.service.execute(input),
    (error) => error.code === "RELEASE_CONFLICT" && /autenticidad/.test(error.message)
  );
  assert.equal(harness.tables.ASISTENCIAS[0].released, false);
  assert.equal(harness.tables.LIBERACIONES.length, 0);
});

test("un phase falsificado incluso con MAC recalculado no sustituye verificar la matriz", () => {
  const harness = createHarness({ throwBeforeWrite: true });
  assert.throws(() => harness.service.execute(input), /synthetic worker before matrix write/);
  const batch = harness.tables.LIBERACION_LOTES[0];
  const plan = JSON.parse(batch.plan);
  batch.phase = "MATRIZ_APLICADA";
  batch.results = JSON.stringify(plan.entries.map((entry) => ({ ...entry, status: "WRITTEN" })));
  harness.resignBatch(batch);

  assert.throws(
    () => harness.service.execute(input),
    (error) => error.code === "RELEASE_CONFLICT" && /matrix effect missing/.test(error.message)
  );
  assert.equal(harness.tables.ASISTENCIAS[0].released, false);
  assert.equal(harness.tables.LIBERACIONES.length, 0);
});

test("un CONFLICTO terminal repara su auditoria si el primer append falla", () => {
  const harness = createHarness({ matrixConflict: true, failures: { auditBlocked: 1 } });
  assert.throws(() => harness.service.execute(input), /synthetic failure auditBlocked/);
  assert.equal(harness.tables.LIBERACION_LOTES[0].phase, "CONFLICTO");
  assert.equal(harness.tables.AUDITORIA.length, 0);

  const replay = harness.service.execute(input);
  assert.equal(replay.repeated, true);
  assert.equal(replay.release.phase, "CONFLICTO");
  assert.equal(harness.tables.AUDITORIA.filter((event) => event.action === "RELEASE_BLOCKED").length, 1);
});

test("un requestId distinto no omite un lote cuyo phase fue alterado sin MAC", () => {
  const harness = createHarness({ throwBeforeWrite: true });
  assert.throws(() => harness.service.execute(input), /synthetic worker before matrix write/);
  harness.tables.LIBERACION_LOTES[0].phase = "CONFLICTO";

  assert.throws(
    () => harness.service.execute({ sessionId: input.sessionId, requestId: "request-release-new" }),
    (error) => error.code === "RELEASE_CONFLICT" && /autenticidad/.test(error.message)
  );
  assert.equal(harness.tables.LIBERACION_LOTES.length, 1);
  assert.equal(harness.matrix.size, 0);
  assert.equal(harness.tables.LIBERACIONES.length, 0);
});

test("un replay COMPLETADO falla cerrado si desaparece el efecto de matriz", () => {
  const harness = createHarness();
  harness.service.execute(input);
  harness.matrix.clear();
  harness.tables.ASISTENCIAS[0].released = false;
  harness.tables.ASISTENCIAS[0].status = "EXAMEN_CONFIRMADO";
  harness.tables.LIBERACIONES.length = 0;
  harness.tables.AUDITORIA.length = 0;

  assert.throws(
    () => harness.service.execute(input),
    (error) => error.code === "RELEASE_CONFLICT" && /matrix effect missing/.test(error.message)
  );
  assert.equal(harness.tables.ASISTENCIAS[0].released, false);
  assert.equal(harness.tables.LIBERACIONES.length, 0);
  assert.equal(harness.tables.AUDITORIA.length, 0);
});

test("un replay COMPLETADO repara dominio y auditoria sólo tras verificar matriz", () => {
  const harness = createHarness();
  harness.service.execute(input);
  harness.tables.ASISTENCIAS[0].released = false;
  harness.tables.ASISTENCIAS[0].status = "EXAMEN_CONFIRMADO";
  harness.tables.LIBERACIONES.length = 0;
  harness.tables.AUDITORIA.length = 0;

  const replay = harness.service.execute(input);
  assert.equal(replay.repeated, true);
  assert.equal(harness.tables.ASISTENCIAS[0].released, true);
  assert.equal(harness.tables.LIBERACIONES.length, 1);
  assert.equal(harness.tables.AUDITORIA.filter((event) => event.action === "MATRIX_RELEASED").length, 1);
  assert.equal(harness.tables.AUDITORIA.filter((event) => event.action === "RELEASE_COMPLETED").length, 1);
});

test("un replay COMPLETADO verifica el mapeo congelado aunque el activo haya rotado", () => {
  const harness = createHarness();
  harness.service.execute(input);
  harness.setMappingVersion("mapping-v2");

  const replay = harness.service.execute(input);
  assert.equal(replay.repeated, true);
  assert.equal(replay.release.mappingVersion, "mapping-v1");
  assert.equal(harness.matrix.size, 1);
});

test("un PENDIENTE recupera un efecto autenticado si el mapeo rota despues del write", () => {
  const harness = createHarness({ failures: { batchMatrix: 1 } });
  assert.throws(() => harness.service.execute(input), /synthetic failure batchMatrix/);
  assert.equal(harness.tables.LIBERACION_LOTES[0].phase, "PENDIENTE");
  assert.equal(harness.matrix.size, 1);
  harness.setMappingVersion("mapping-v2");

  const recovered = harness.service.execute(input);
  assert.equal(recovered.release.status, "LIBERADA_TOTAL");
  assert.equal(recovered.results[0].status, "RECOVERED");
  assert.equal(harness.matrix.size, 1);
});

test("un lote PARCIAL sigue siendo reproducible despues de progresar la sesion a TOTAL", () => {
  const harness = createHarness({ employeeIds: ["00123", "00456"] });
  harness.tables.ASISTENCIAS[1].examStatus = "EXAMEN_PENDIENTE";
  const first = harness.service.execute(input);
  assert.equal(first.release.status, "LIBERADA_PARCIAL");

  harness.tables.ASISTENCIAS[1].examStatus = "EXAMEN_CONFIRMADO";
  const second = harness.service.execute({ sessionId: input.sessionId, requestId: "request-release-second" });
  assert.equal(second.release.status, "LIBERADA_TOTAL");

  const replay = harness.service.execute(input);
  assert.equal(replay.repeated, true);
  assert.equal(replay.release.status, "LIBERADA_PARCIAL");
  assert.equal(harness.tables.SESIONES[0].status, "LIBERADA_TOTAL");
});

test("un lote PARCIAL permite continuar tras la transicion autorizada a LISTA", () => {
  const harness = createHarness({ employeeIds: ["00123", "00456"] });
  harness.tables.ASISTENCIAS[1].examStatus = "EXAMEN_PENDIENTE";
  assert.equal(harness.service.execute(input).release.status, "LIBERADA_PARCIAL");
  harness.tables.SESIONES[0].status = "LISTA_PARA_LIBERAR";
  harness.tables.ASISTENCIAS[1].examStatus = "EXAMEN_CONFIRMADO";

  const completed = harness.service.execute({ sessionId: input.sessionId, requestId: "request-release-second" });
  assert.equal(completed.release.status, "LIBERADA_TOTAL");
  assert.equal(harness.tables.LIBERACION_LOTES.length, 2);
});

test("un request nuevo falla cerrado si un lote completado perdio su efecto historico", () => {
  const harness = createHarness({ employeeIds: ["00123", "00456"] });
  harness.tables.ASISTENCIAS[1].examStatus = "EXAMEN_PENDIENTE";
  const first = harness.service.execute(input);
  assert.equal(first.release.status, "LIBERADA_PARCIAL");
  harness.matrix.delete(first.results[0].idempotencyKey);
  harness.tables.ASISTENCIAS[1].examStatus = "EXAMEN_CONFIRMADO";

  assert.throws(
    () => harness.service.execute({ sessionId: input.sessionId, requestId: "request-release-second" }),
    (error) => error.code === "RELEASE_CONFLICT" && /matrix effect missing/.test(error.message)
  );
  assert.equal(harness.tables.LIBERACION_LOTES.length, 1);
  assert.equal(harness.tables.LIBERACIONES.length, 1);
  assert.equal(harness.tables.ASISTENCIAS[1].released, false);
});

test("un replay COMPLETADO repara status LIBERADA aunque released ya sea true", () => {
  const harness = createHarness();
  harness.service.execute(input);
  harness.tables.ASISTENCIAS[0].status = "EXAMEN_CONFIRMADO";
  harness.tables.ASISTENCIAS[0].released = true;

  const replay = harness.service.execute(input);
  assert.equal(replay.repeated, true);
  assert.equal(harness.tables.ASISTENCIAS[0].released, true);
  assert.equal(harness.tables.ASISTENCIAS[0].status, "LIBERADA");
});
