var KcmReleaseService = (function () {
  "use strict";

  var EFFECTIVE_STATUSES = Object.freeze({ WRITTEN: true, ALREADY_APPLIED: true, RECOVERED: true });
  var TERMINAL_PHASES = Object.freeze({ COMPLETADO: true, CONFLICTO: true });

  function acquireReleaseLock() {
    if (typeof KcmScriptLock !== "undefined") {
      return KcmScriptLock.acquire(30000, "Existe otra liberacion en proceso; reintente");
    }
    var lock = LockService.getScriptLock();
    if (!lock.tryLock(30000)) {
      var busy = new Error("Existe otra liberacion en proceso; reintente");
      busy.code = "CONFLICT"; busy.retryable = true; throw busy;
    }
    return lock;
  }

  function bytesToHex(bytes) {
    return bytes.map(function (byte) {
      var unsigned = byte < 0 ? byte + 256 : byte;
      return ("0" + unsigned.toString(16)).slice(-2);
    }).join("");
  }

  function sha256(value) {
    return bytesToHex(Utilities.computeDigest(
      Utilities.DigestAlgorithm.SHA_256,
      String(value),
      Utilities.Charset.UTF_8
    ));
  }

  function hmacHex(purpose, value) {
    return bytesToHex(Utilities.computeHmacSha256Signature(
      String(purpose) + "\n" + String(value),
      KcmConfig.releaseIntegritySecret(),
      Utilities.Charset.UTF_8
    ));
  }

  function constantTimeEqual(left, right) {
    var first = String(left || "");
    var second = String(right || "");
    var difference = first.length ^ second.length;
    var length = Math.max(first.length, second.length);
    for (var index = 0; index < length; index += 1) {
      difference |= (first.charCodeAt(index) || 0) ^ (second.charCodeAt(index) || 0);
    }
    return difference === 0;
  }

  function parseArrayStrict(value, message) {
    if (Array.isArray(value)) return value;
    try {
      var parsed = value === "" || value === null || value === undefined ? [] : JSON.parse(String(value));
      if (Array.isArray(parsed)) return parsed;
    } catch (ignored) {  }
    KcmValidation.fail("RELEASE_CONFLICT", message);
  }

  function parseObjectStrict(value, message) {
    if (value && typeof value === "object" && !Array.isArray(value)) return value;
    try {
      var parsed = JSON.parse(String(value || ""));
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed;
    } catch (ignored) {  }
    KcmValidation.fail("RELEASE_CONFLICT", message);
  }

  function exactKeys(value, keys, message) {
    var actual = Object.keys(value).sort();
    var expected = keys.slice().sort();
    if (actual.length !== expected.length || expected.some(function (key, index) { return actual[index] !== key; })) {
      KcmValidation.fail("RELEASE_CONFLICT", message);
    }
  }

  function canonicalPlan(writePlan) {
    if (!writePlan || typeof writePlan !== "object" || !writePlan.session || !writePlan.mapping || !Array.isArray(writePlan.entries)) {
      KcmValidation.fail("RELEASE_CONFLICT", "El plan de liberacion no es valido");
    }
    return {
      session: {
        sessionId: KcmValidation.identifier(String(writePlan.session.sessionId), "sessionId"),
        trainingId: KcmValidation.identifier(String(writePlan.session.trainingId), "trainingId"),
        date: KcmValidation.dateIso(String(writePlan.session.date))
      },
      mapping: {
        trainingId: KcmValidation.identifier(String(writePlan.mapping.trainingId), "trainingId"),
        destinationSheet: KcmValidation.text(String(writePlan.mapping.destinationSheet), "destinationSheet", 100, true),
        destinationColumn: KcmValidation.text(String(writePlan.mapping.destinationColumn), "destinationColumn", 3, true).toUpperCase(),
        destinationHeader: KcmValidation.text(String(writePlan.mapping.destinationHeader), "destinationHeader", 500, true),
        headerRow: KcmValidation.integer(writePlan.mapping.headerRow, 1, 100),
        mappingVersion: KcmValidation.text(String(writePlan.mapping.mappingVersion), "mappingVersion", 60, true),
        overwritePolicy: KcmValidation.enumValue(String(writePlan.mapping.overwritePolicy), ["NO_OVERWRITE"])
      },
      completionDate: KcmValidation.dateIso(String(writePlan.completionDate)),
      entries: writePlan.entries.map(function (entry) {
        return {
          attendanceId: KcmValidation.identifier(String(entry.attendanceId), "attendanceId"),
          employeeId: KcmValidation.employeeId(String(entry.employeeId)),
          trainingId: KcmValidation.identifier(String(entry.trainingId), "trainingId"),
          mappingVersion: KcmValidation.text(String(entry.mappingVersion), "mappingVersion", 60, true),
          idempotencyKey: String(entry.idempotencyKey),
          completionDate: KcmValidation.dateIso(String(entry.completionDate))
        };
      })
    };
  }

  function validatePlan(plan) {
    exactKeys(plan, ["session", "mapping", "completionDate", "entries"], "El journal de liberacion esta corrupto");
    exactKeys(plan.session, ["sessionId", "trainingId", "date"], "El journal de liberacion esta corrupto");
    exactKeys(plan.mapping, ["trainingId", "destinationSheet", "destinationColumn", "destinationHeader", "headerRow", "mappingVersion", "overwritePolicy"], "El journal de liberacion esta corrupto");
    if (!Array.isArray(plan.entries) || plan.entries.length < 1 || plan.entries.length > 40) {
      KcmValidation.fail("RELEASE_CONFLICT", "El journal de liberacion no contiene un lote valido");
    }
    plan.entries.forEach(function (entry) {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) KcmValidation.fail("RELEASE_CONFLICT", "El journal de liberacion esta corrupto");
      exactKeys(entry, ["attendanceId", "employeeId", "trainingId", "mappingVersion", "idempotencyKey", "completionDate"], "El journal de liberacion esta corrupto");
    });
    var normalized = canonicalPlan(plan);
    if (normalized.session.trainingId !== normalized.mapping.trainingId ||
        normalized.session.date !== normalized.completionDate ||
        !/^[A-Z]{1,3}$/.test(normalized.mapping.destinationColumn) ||
        !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,59}$/.test(normalized.mapping.mappingVersion)) {
      KcmValidation.fail("RELEASE_CONFLICT", "El journal de liberacion no coincide con su mapeo");
    }
    var seenEmployees = Object.create(null);
    var seenAttendances = Object.create(null);
    var seenKeys = Object.create(null);
    normalized.entries.forEach(function (entry) {
      var expectedKey = [normalized.session.sessionId, entry.employeeId, entry.trainingId, entry.mappingVersion].join("|");
      if (entry.idempotencyKey !== expectedKey || entry.trainingId !== normalized.session.trainingId ||
          entry.mappingVersion !== normalized.mapping.mappingVersion || entry.completionDate !== normalized.completionDate ||
          seenEmployees[entry.employeeId] || seenAttendances[entry.attendanceId] || seenKeys[entry.idempotencyKey]) {
        KcmValidation.fail("RELEASE_CONFLICT", "El journal de liberacion contiene registros inconsistentes");
      }
      seenEmployees[entry.employeeId] = true;
      seenAttendances[entry.attendanceId] = true;
      seenKeys[entry.idempotencyKey] = true;
    });
    return normalized;
  }

  function validateResults(plan, results) {
    if (!Array.isArray(results) || results.length !== plan.entries.length) {
      KcmValidation.fail("RELEASE_CONFLICT", "Los resultados no coinciden con el plan de liberacion");
    }
    var allowedStatuses = Object.freeze({
      WRITTEN: true, ALREADY_APPLIED: true, RECOVERED: true, ATOMIC_BATCH_ABORTED: true,
      EMPLOYEE_NOT_FOUND: true, EXISTING_VALUE_CONFLICT: true, EXISTING_NOTE_CONFLICT: true,
      EXISTING_FORMULA_CONFLICT: true, IDEMPOTENCY_CONFLICT: true
    });
    var entriesByKey = Object.create(null);
    plan.entries.forEach(function (entry) { entriesByKey[entry.idempotencyKey] = entry; });
    var seen = Object.create(null);
    return results.map(function (result) {
      if (!result || typeof result !== "object" || Array.isArray(result)) KcmValidation.fail("RELEASE_CONFLICT", "Los resultados de liberacion estan corruptos");
      exactKeys(result, ["attendanceId", "employeeId", "trainingId", "mappingVersion", "idempotencyKey", "completionDate", "status"], "Los resultados de liberacion estan corruptos");
      var key = String(result.idempotencyKey || "");
      var entry = entriesByKey[key];
      if (!entry || seen[key] || !allowedStatuses[String(result.status)] ||
          String(result.attendanceId) !== entry.attendanceId || String(result.employeeId) !== entry.employeeId ||
          String(result.trainingId) !== entry.trainingId || String(result.mappingVersion) !== entry.mappingVersion ||
          String(result.completionDate) !== entry.completionDate) {
        KcmValidation.fail("RELEASE_CONFLICT", "Los resultados no coinciden con el plan de liberacion");
      }
      seen[key] = true;
      return {
        attendanceId: entry.attendanceId, employeeId: entry.employeeId, trainingId: entry.trainingId,
        mappingVersion: entry.mappingVersion, idempotencyKey: entry.idempotencyKey,
        completionDate: entry.completionDate, status: String(result.status)
      };
    });
  }

  function planEnvelope(writePlan) {
    var plan = validatePlan(canonicalPlan(writePlan));
    var serialized = KcmValidation.json(plan, 45000);
    return { plan: plan, serialized: serialized, hash: sha256(serialized) };
  }

  function journalPayload(batch) {
    return [
      String(batch.batchId), String(batch.sessionId), String(batch.requestId),
      String(batch.mappingVersion), String(batch.planHash), String(batch.plan),
      String(batch.results), String(batch.phase), String(batch.status), String(batch.createdBy),
      String(batch.createdAt), String(batch.updatedAt), String(batch.version)
    ].join("\n");
  }

  function signBatch(batch) {
    return hmacHex("RELEASE_JOURNAL_V1", journalPayload(batch));
  }

  function assertBatchIntegrity(batch) {
    if (!batch || typeof batch !== "object" || !/^[a-f0-9]{64}$/.test(String(batch.journalMac || "")) ||
        !constantTimeEqual(signBatch(batch), String(batch.journalMac))) {
      KcmValidation.fail("RELEASE_CONFLICT", "El journal de liberacion no conserva su autenticidad");
    }
    return batch;
  }

  function restorePlan(batch) {
    assertBatchIntegrity(batch);
    var serialized = String(batch.plan || "");
    if (!/^[a-f0-9]{64}$/.test(String(batch.planHash || "")) || sha256(serialized) !== String(batch.planHash)) {
      KcmValidation.fail("RELEASE_CONFLICT", "El journal de liberacion no conserva su integridad");
    }
    var plan = validatePlan(parseObjectStrict(serialized, "El journal de liberacion esta corrupto"));
    if (String(batch.mappingVersion) !== plan.mapping.mappingVersion || String(batch.sessionId) !== plan.session.sessionId) {
      KcmValidation.fail("RELEASE_CONFLICT", "El journal de liberacion no coincide con su sesion");
    }
    return plan;
  }

  function matrixContext(batch, plan) {
    assertBatchIntegrity(batch);
    var context = {
      batchId: String(batch.batchId), requestId: String(batch.requestId),
      planHash: String(batch.planHash), journalMac: String(batch.journalMac)
    };
    var payload = [
      context.batchId, String(plan.session.sessionId), context.requestId,
      context.planHash, String(plan.mapping.mappingVersion), context.journalMac
    ].join("|");
    context.contextMac = hmacHex("MATRIX_CONTEXT_V1", payload);
    return context;
  }

  function effectiveResults(results) {
    return results.filter(function (result) { return Boolean(EFFECTIVE_STATUSES[String(result.status)]); });
  }

  function matrixConflicts(results) {
    return results.filter(function (result) { return !EFFECTIVE_STATUSES[String(result.status)] && String(result.status) !== "READY"; });
  }

  function batchDto(batch) {
    assertBatchIntegrity(batch);
    return {
      batchId: String(batch.batchId), sessionId: String(batch.sessionId), requestId: String(batch.requestId),
      mappingVersion: String(batch.mappingVersion), phase: String(batch.phase), status: String(batch.status),
      results: parseArrayStrict(batch.results, "Los resultados de liberacion estan corruptos"),
      createdBy: String(batch.createdBy), createdAt: String(batch.createdAt), updatedAt: String(batch.updatedAt || batch.createdAt),
      version: String(batch.version)
    };
  }

  function preview(sessionId) {
    KcmAuth.requireRoles(["CAPACITACION", "ADMINISTRADOR", "AUDITOR"]);
    var preRelease = KcmPreReleaseService.preview(sessionId);
    var writePlan = KcmMatrixGateway.plan(preRelease.session, preRelease.included);
    var matrixResults = writePlan.entries.length ? KcmMatrixGateway.preview(writePlan) : [];
    var allowed = matrixResults.filter(function (result) { return result.status === "READY"; });
    var blocked = matrixConflicts(matrixResults);
    var supported = KcmMatrixGateway.commitSupported();
    var excluded = preRelease.excluded.map(function (participant) {
      return { attendanceId: participant.attendanceId, employeeId: participant.employeeId, reasons: participant.blockingReasons };
    }).concat(blocked.map(function (result) {
      return { attendanceId: result.attendanceId, employeeId: result.employeeId, reasons: [result.status] };
    })).concat(preRelease.ocrExclusions.map(function (item) {
      return { attendanceId: null, employeeId: null, candidateId: item.candidateId, rowIndex: item.rowIndex, reasons: item.reasons, disposition: "NO_PARTICIPANTE" };
    }));
    return {
      sessionId: preRelease.session.sessionId,
      mapping: writePlan.mapping,
      completionDate: writePlan.completionDate,
      included: allowed.map(function (entry) {
        return { attendanceId: entry.attendanceId, employeeId: entry.employeeId, idempotencyKey: entry.idempotencyKey, matrixStatus: entry.status };
      }),
      excluded: excluded,
      counts: {
        total: preRelease.participants.length,
        included: allowed.length,
        excluded: preRelease.excluded.length + blocked.length,
        ocrCandidateRows: preRelease.counts.ocrCandidateRows,
        ocrExcludedRows: preRelease.counts.ocrExcludedRows
      },
      atomicBatchReady: supported && blocked.length === 0,
      commitSupported: supported
    };
  }

  function auditOnce(identity, repo, input) {
    var existing = repo.findOne(KcmConfig.SHEETS.AUDIT, function (row) {
      return String(row.requestId) === String(input.requestId) && String(row.entityId) === String(input.entityId) && String(row.action) === String(input.action);
    });
    return existing || KcmServiceSupport.audit(identity, input);
  }

  function uniqueBatch(repo, predicate, message) {
    var matches = repo.list(KcmConfig.SHEETS.RELEASE_BATCHES, predicate);
    if (matches.length > 1) KcmValidation.fail("RELEASE_CONFLICT", message);
    return matches.length ? matches[0] : null;
  }

  function loadBatchById(repo, batchId) {
    var batch = uniqueBatch(repo, function (row) { return String(row.batchId) === String(batchId); }, "El journal contiene lotes duplicados");
    if (!batch) KcmValidation.fail("RELEASE_CONFLICT", "El lote durable desaparecio durante la liberacion");
    return assertBatchIntegrity(batch);
  }

  function updateBatch(repo, batch, patch) {
    assertBatchIntegrity(batch);
    var intended = Object.assign({}, batch, patch, { updatedAt: KcmServiceSupport.nowIso() });
    delete intended.__rowNumber;
    intended.journalMac = signBatch(intended);
    repo.replaceOne(KcmConfig.SHEETS.RELEASE_BATCHES, "batchId", intended);
    var stored = loadBatchById(repo, intended.batchId);
    if (!constantTimeEqual(String(stored.journalMac), intended.journalMac)) {
      KcmValidation.fail("RELEASE_CONFLICT", "El journal cambio durante la actualizacion");
    }
    return stored;
  }

  function createBatch(repo, identity, session, requestId, writePlan) {
    var existing = uniqueBatch(repo, function (row) {
      return String(row.sessionId) === String(session.sessionId) && String(row.requestId) === String(requestId);
    }, "El requestId tiene mas de un lote de liberacion");
    if (existing) KcmValidation.fail("RELEASE_CONFLICT", "El requestId ya tiene un lote durable");
    var envelope = planEnvelope(writePlan);
    var timestamp = KcmServiceSupport.nowIso();
    var batch = {
      batchId: KcmServiceSupport.uuid(), sessionId: session.sessionId, requestId: requestId,
      mappingVersion: envelope.plan.mapping.mappingVersion, planHash: envelope.hash, plan: envelope.serialized,
      results: "[]", phase: "PENDIENTE", status: "PENDIENTE", createdBy: identity.actor,
      createdAt: timestamp, updatedAt: timestamp, version: KcmConfig.CONTRACT_VERSION
    };
    batch.journalMac = signBatch(batch);
    repo.insertMany(KcmConfig.SHEETS.RELEASE_BATCHES, [batch]);
    var stored = loadBatchById(repo, batch.batchId);
    if (!constantTimeEqual(stored.journalMac, batch.journalMac)) {
      KcmValidation.fail("RELEASE_CONFLICT", "No fue posible confirmar el lote durable");
    }
    return stored;
  }

  function validateCurrentDomain(plan, batch, allowReleased, allowFinalizedSession) {
    var session = KcmServiceSupport.session(plan.session.sessionId);
    var allowedStatuses = ["LISTA_PARA_LIBERAR", "LIBERADA_PARCIAL"];
    if (allowFinalizedSession) allowedStatuses.push("LIBERADA_TOTAL");
    if (String(session.trainingId) !== plan.session.trainingId || String(session.date) !== plan.session.date ||
        allowedStatuses.indexOf(String(session.status)) === -1 ||
        !KcmServiceSupport.asBoolean(session.authorized)) {
      KcmValidation.fail("INVALID_STATE", "La sesion cambio o dejo de estar autorizada para liberar");
    }
    var preRelease = KcmPreReleaseService.preview(plan.session.sessionId);
    var participantsByAttendance = Object.create(null);
    preRelease.participants.forEach(function (participant) {
      var attendanceId = String(participant.attendanceId);
      if (participantsByAttendance[attendanceId]) KcmValidation.fail("RELEASE_CONFLICT", "La sesion contiene asistencias duplicadas");
      participantsByAttendance[attendanceId] = participant;
    });
    var plannedAttendances = Object.create(null);
    plan.entries.forEach(function (entry) {
      var participant = participantsByAttendance[entry.attendanceId];
      if (!participant || String(participant.sessionId) !== plan.session.sessionId ||
          String(participant.employeeId) !== entry.employeeId) {
        KcmValidation.fail("RELEASE_CONFLICT", "Una asistencia del lote ya no coincide con la sesion");
      }
      var blocking = (participant.blockingReasons || []).filter(function (reason) {
        return String(reason) !== "YA_LIBERADO_PREVIAMENTE";
      });
      if (blocking.length || (!allowReleased && KcmServiceSupport.asBoolean(participant.released))) {
        KcmValidation.fail("RELEASE_CONFLICT", "Una asistencia del lote dejo de ser elegible");
      }
      plannedAttendances[entry.attendanceId] = true;
    });
    preRelease.participants.forEach(function (participant) {
      var blocking = (participant.blockingReasons || []).filter(function (reason) {
        return String(reason) !== "YA_LIBERADO_PREVIAMENTE";
      });
      if (!KcmServiceSupport.asBoolean(participant.released) && !blocking.length && !plannedAttendances[String(participant.attendanceId)]) {
        KcmValidation.fail("RELEASE_CONFLICT", "La elegibilidad de la sesion cambio despues de congelar el lote");
      }
    });
    if (String(batch.sessionId) !== String(session.sessionId)) KcmValidation.fail("RELEASE_CONFLICT", "El lote no coincide con la sesion vigente");
    return session;
  }

  function releaseForKey(repo, idempotencyKey) {
    var matches = repo.list(KcmConfig.SHEETS.RELEASES, function (row) {
      return String(row.idempotencyKey) === String(idempotencyKey);
    });
    if (matches.length > 1) KcmValidation.fail("RELEASE_CONFLICT", "La clave idempotente tiene mas de una liberacion efectiva");
    return matches.length ? matches[0] : null;
  }

  function assertReleaseRow(row, batch, result) {
    if (!row || String(row.sessionId) !== String(batch.sessionId) || String(row.requestId) !== String(batch.requestId) ||
        String(row.idempotencyKey) !== String(result.idempotencyKey) || String(row.mappingVersion) !== String(batch.mappingVersion) ||
        String(row.status) !== "APLICADA") {
      KcmValidation.fail("RELEASE_CONFLICT", "Una liberacion efectiva no coincide con su lote durable");
    }
    var included = parseArrayStrict(row.included, "Una liberacion efectiva esta corrupta");
    var excluded = parseArrayStrict(row.excluded, "Una liberacion efectiva esta corrupta");
    if (included.length !== 1 || excluded.length !== 0 ||
        String(included[0].attendanceId) !== result.attendanceId || String(included[0].employeeId) !== result.employeeId) {
      KcmValidation.fail("RELEASE_CONFLICT", "Una liberacion efectiva no coincide con su asistencia");
    }
    return row;
  }

  function ensureEffectiveReleases(repo, batch, results) {
    var inserts = [];
    results.forEach(function (result) {
      var existing = releaseForKey(repo, result.idempotencyKey);
      if (existing) {
        assertReleaseRow(existing, batch, result);
        return;
      }
      inserts.push({
        releaseId: KcmServiceSupport.uuid(), sessionId: batch.sessionId, requestId: batch.requestId,
        idempotencyKey: result.idempotencyKey, mappingVersion: batch.mappingVersion,
        included: KcmValidation.json([{ attendanceId: result.attendanceId, employeeId: result.employeeId, status: result.status }], 2000),
        excluded: "[]", status: "APLICADA", createdBy: batch.createdBy,
        createdAt: KcmServiceSupport.nowIso(), version: KcmConfig.CONTRACT_VERSION
      });
    });
    if (inserts.length) repo.insertMany(KcmConfig.SHEETS.RELEASES, inserts);
    results.forEach(function (result) { assertReleaseRow(releaseForKey(repo, result.idempotencyKey), batch, result); });
  }

  function assertDomainApplied(repo, batch, results) {
    results.forEach(function (result) {
      var matches = repo.list(KcmConfig.SHEETS.ATTENDANCES, function (row) {
        return String(row.attendanceId) === String(result.attendanceId) && String(row.sessionId) === String(batch.sessionId);
      });
      if (matches.length !== 1 || String(matches[0].employeeId).padStart(5, "0") !== result.employeeId ||
          !KcmServiceSupport.asBoolean(matches[0].released) || String(matches[0].status) !== "LIBERADA") {
        KcmValidation.fail("RELEASE_CONFLICT", "El dominio no confirma una asistencia liberada");
      }
      assertReleaseRow(releaseForKey(repo, result.idempotencyKey), batch, result);
    });
  }

  function ensureDomainEffects(repo, batch, results) {
    var effective = effectiveResults(results);
    var now = KcmServiceSupport.nowIso();
    var updates = [];
    effective.forEach(function (result) {
      var matches = repo.list(KcmConfig.SHEETS.ATTENDANCES, function (row) {
        return String(row.attendanceId) === String(result.attendanceId) && String(row.sessionId) === String(batch.sessionId);
      });
      if (matches.length !== 1 || String(matches[0].employeeId).padStart(5, "0") !== result.employeeId) {
        KcmValidation.fail("RELEASE_CONFLICT", "Una asistencia del journal ya no coincide con el dominio");
      }
      if (!KcmServiceSupport.asBoolean(matches[0].released) || String(matches[0].status) !== "LIBERADA") {
        updates.push({ attendanceId: matches[0].attendanceId, released: true, status: "LIBERADA", updatedAt: now });
      }
    });
    if (updates.length) repo.updateMany(KcmConfig.SHEETS.ATTENDANCES, "attendanceId", updates);
    ensureEffectiveReleases(repo, batch, effective);
    assertDomainApplied(repo, batch, effective);
    return effective;
  }

  function applyDomain(repo, batch, results) {
    ensureDomainEffects(repo, batch, results);
    return updateBatch(repo, batch, { phase: "DOMINIO_APLICADO", status: "PENDIENTE" });
  }

  function ensureCompletionAudits(identity, repo, batch, results, outcome) {
    effectiveResults(results).forEach(function (result) {
      auditOnce(identity, repo, {
        sessionId: batch.sessionId, entityType: "Attendance", entityId: result.attendanceId,
        action: "MATRIX_RELEASED", previousState: "ELEGIBLE", newState: "LIBERADA", requestId: batch.requestId
      });
    });
    auditOnce(identity, repo, {
      sessionId: batch.sessionId, entityType: "ReleaseBatch", entityId: batch.batchId,
      action: "RELEASE_COMPLETED", previousState: "PENDIENTE", newState: outcome, requestId: batch.requestId
    });
  }

  function assertCompletedSessionProgress(plan, batch) {
    var session = KcmServiceSupport.session(batch.sessionId);
    var allowedStatuses = String(batch.status) === "LIBERADA_PARCIAL"
      ? ["LIBERADA_PARCIAL", "LISTA_PARA_LIBERAR", "LIBERADA_TOTAL"] : ["LIBERADA_TOTAL"];
    if (String(session.trainingId) !== String(plan.session.trainingId) ||
        String(session.date) !== String(plan.session.date) ||
        allowedStatuses.indexOf(String(session.status)) === -1 ||
        !KcmServiceSupport.asBoolean(session.authorized)) {
      KcmValidation.fail("RELEASE_CONFLICT", "La sesion no confirma la progresion del lote terminal");
    }
    return session;
  }

  function reconcileCompletedBatch(identity, repo, batch, plan) {
    if (String(batch.phase) !== "COMPLETADO" ||
        ["LIBERADA_TOTAL", "LIBERADA_PARCIAL"].indexOf(String(batch.status)) === -1) {
      KcmValidation.fail("RELEASE_CONFLICT", "El lote terminal no conserva un resultado valido");
    }
    var results = validateResults(plan, parseArrayStrict(batch.results, "Los resultados de liberacion estan corruptos"));
    assertCompletedSessionProgress(plan, batch);
    KcmMatrixGateway.verifyApplied(plan, matrixContext(batch, plan), results);
    ensureDomainEffects(repo, batch, results);
    ensureCompletionAudits(identity, repo, batch, results, String(batch.status));
    return results;
  }

  function finalize(repo, identity, batch, results) {
    var effective = effectiveResults(results);
    assertDomainApplied(repo, batch, effective);
    var attendances = repo.list(KcmConfig.SHEETS.ATTENDANCES, function (row) {
      return String(row.sessionId) === String(batch.sessionId);
    });
    var outcome = attendances.length && attendances.every(function (row) { return KcmServiceSupport.asBoolean(row.released); })
      ? "LIBERADA_TOTAL" : "LIBERADA_PARCIAL";
    var session = KcmServiceSupport.session(batch.sessionId);
    if (String(session.status) !== outcome) {
      if (["LISTA_PARA_LIBERAR", "LIBERADA_PARCIAL"].indexOf(String(session.status)) === -1) {
        KcmValidation.fail("INVALID_STATE", "La sesion no permite completar la liberacion");
      }
      repo.updateMany(KcmConfig.SHEETS.SESSIONS, "sessionId", [{ sessionId: batch.sessionId, status: outcome }]);
      session = KcmServiceSupport.session(batch.sessionId);
      if (String(session.status) !== outcome) KcmValidation.fail("RELEASE_CONFLICT", "No fue posible confirmar el estado de la sesion");
    }
    ensureCompletionAudits(identity, repo, batch, results, outcome);
    return updateBatch(repo, batch, { phase: "COMPLETADO", status: outcome });
  }

  function execute(input) {
    var identity = KcmAuth.requireRoles(["CAPACITACION", "ADMINISTRADOR"]);
    var requestId = KcmValidation.identifier(input.requestId, "requestId");
    var sessionId = KcmValidation.identifier(input.sessionId, "sessionId");
    var lock = acquireReleaseLock();
    try {
      var repo = KcmServiceSupport.repository();
      var sessionBatches = repo.list(KcmConfig.SHEETS.RELEASE_BATCHES, function (row) {
        return String(row.sessionId) === sessionId;
      });
      var seenBatchIds = Object.create(null);
      sessionBatches.forEach(function (storedBatch) {
        var storedBatchId = String(storedBatch.batchId || "");
        if (!storedBatchId || seenBatchIds[storedBatchId]) KcmValidation.fail("RELEASE_CONFLICT", "La sesion contiene lotes duplicados");
        seenBatchIds[storedBatchId] = true;
        restorePlan(storedBatch);
      });
      var requestBatches = sessionBatches.filter(function (row) { return String(row.requestId) === requestId; });
      if (requestBatches.length > 1) KcmValidation.fail("RELEASE_CONFLICT", "El requestId tiene mas de un lote de liberacion");
      var batch = requestBatches.length ? requestBatches[0] : null;
      var plan;
      var results;
      if (batch) {
        plan = restorePlan(batch);
        if (TERMINAL_PHASES[String(batch.phase)]) {
          var terminalResults = validateResults(plan, parseArrayStrict(batch.results, "Los resultados de liberacion estan corruptos"));
          if (String(batch.phase) === "CONFLICTO") {
            auditOnce(identity, repo, {
              sessionId: sessionId, entityType: "ReleaseBatch", entityId: batch.batchId,
              action: "RELEASE_BLOCKED", previousState: "PENDIENTE", newState: "CONFLICTO", requestId: requestId
            });
          } else {
            terminalResults = reconcileCompletedBatch(identity, repo, batch, plan);
          }
          return { repeated: true, release: batchDto(batch), results: terminalResults };
        }
      } else {
        var openBatches = sessionBatches.filter(function (row) { return !TERMINAL_PHASES[String(row.phase)]; });
        if (openBatches.length) {
          KcmValidation.fail("RELEASE_CONFLICT", "Existe un lote pendiente; reintente con su requestId original");
        }
        sessionBatches.forEach(function (storedBatch) {
          if (String(storedBatch.phase) !== "COMPLETADO") return;
          reconcileCompletedBatch(identity, repo, storedBatch, restorePlan(storedBatch));
        });
        var session = KcmServiceSupport.session(sessionId);
        if (["LISTA_PARA_LIBERAR", "LIBERADA_PARCIAL"].indexOf(String(session.status)) === -1) KcmValidation.fail("INVALID_STATE", "La sesion no esta lista para liberar");
        if (!KcmServiceSupport.asBoolean(session.authorized)) KcmValidation.fail("FORBIDDEN", "La sesion no ha sido autorizada");
        var preRelease = KcmPreReleaseService.preview(sessionId);
        if (!preRelease.included.length) KcmValidation.fail("RELEASE_CONFLICT", "No hay registros elegibles para liberar");
        var newPlan = KcmMatrixGateway.plan(session, preRelease.included);
        var preflight = KcmMatrixGateway.preview(newPlan);
        KcmMatrixGateway.assertWriteSupported();
        batch = createBatch(repo, identity, session, requestId, newPlan);
        plan = restorePlan(batch);
        validateCurrentDomain(plan, batch, false);
        if (matrixConflicts(preflight).length) {
          results = validateResults(plan, preflight);
          batch = updateBatch(repo, batch, { results: KcmValidation.json(results, 30000), phase: "CONFLICTO", status: "CONFLICTO" });
          auditOnce(identity, repo, { sessionId: sessionId, entityType: "ReleaseBatch", entityId: batch.batchId, action: "RELEASE_BLOCKED", previousState: "PENDIENTE", newState: "CONFLICTO", requestId: requestId });
          return { repeated: false, release: batchDto(batch), results: results };
        }
      }

      if (String(batch.phase) === "PENDIENTE") {
        validateCurrentDomain(plan, batch, false);
        results = validateResults(plan, KcmMatrixGateway.write(plan, matrixContext(batch, plan)));
        if (matrixConflicts(results).length) {
          batch = updateBatch(repo, batch, { results: KcmValidation.json(results, 30000), phase: "CONFLICTO", status: "CONFLICTO" });
          auditOnce(identity, repo, { sessionId: sessionId, entityType: "ReleaseBatch", entityId: batch.batchId, action: "RELEASE_BLOCKED", previousState: "PENDIENTE", newState: "CONFLICTO", requestId: requestId });
          return { repeated: false, release: batchDto(batch), results: results };
        }
        batch = updateBatch(repo, batch, { results: KcmValidation.json(results, 30000), phase: "MATRIZ_APLICADA", status: "PENDIENTE" });
      }
      if (String(batch.phase) === "MATRIZ_APLICADA") {
        results = validateResults(plan, parseArrayStrict(batch.results, "Los resultados de liberacion estan corruptos"));
        validateCurrentDomain(plan, batch, true, false);
        KcmMatrixGateway.verifyApplied(plan, matrixContext(batch, plan), results);
        batch = applyDomain(repo, batch, results);
      }
      if (String(batch.phase) === "DOMINIO_APLICADO") {
        results = validateResults(plan, parseArrayStrict(batch.results, "Los resultados de liberacion estan corruptos"));
        validateCurrentDomain(plan, batch, true, true);
        KcmMatrixGateway.verifyApplied(plan, matrixContext(batch, plan), results);
        batch = finalize(repo, identity, batch, results);
      }
      if (String(batch.phase) !== "COMPLETADO") KcmValidation.fail("RELEASE_CONFLICT", "La liberacion no alcanzo un estado terminal");
      return { repeated: false, release: batchDto(batch), results: results };
    } finally {
      lock.releaseLock();
    }
  }

  return Object.freeze({ preview: preview, execute: execute });
}());
