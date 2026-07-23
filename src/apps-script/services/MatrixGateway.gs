/** MatrixGateway configurable; nunca recibe IDs de destino desde el cliente. */
var KcmMatrixGateway = (function () {
  "use strict";

  var EFFECTIVE_RESULTS = Object.freeze({ WRITTEN: true, ALREADY_APPLIED: true, RECOVERED: true });
  var CONTEXT_PHASES_FOR_WRITE = Object.freeze({ PENDIENTE: true });
  var CONTEXT_PHASES_FOR_VERIFY = Object.freeze({
    PENDIENTE: true, MATRIZ_APLICADA: true, DOMINIO_APLICADO: true, COMPLETADO: true
  });

  function bytesToHex(bytes) {
    return bytes.map(function (byte) {
      var unsigned = byte < 0 ? byte + 256 : byte;
      return ("0" + unsigned.toString(16)).slice(-2);
    }).join("");
  }

  function hmacHex(purpose, value) {
    return bytesToHex(Utilities.computeHmacSha256Signature(
      String(purpose) + "\n" + String(value),
      KcmConfig.releaseIntegritySecret(),
      Utilities.Charset.UTF_8
    ));
  }

  function sha256(value) {
    return bytesToHex(Utilities.computeDigest(
      Utilities.DigestAlgorithm.SHA_256,
      String(value),
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

  function mappingRecord(found) {
    var result = {
      trainingId: KcmValidation.identifier(String(found.trainingId), "trainingId"),
      destinationSheet: KcmValidation.text(String(found.destinationSheet), "destinationSheet", 100, true),
      destinationColumn: KcmValidation.text(String(found.destinationColumn), "destinationColumn", 3, true).toUpperCase(),
      destinationHeader: KcmValidation.text(String(found.destinationHeader), "destinationHeader", 500, true),
      headerRow: KcmValidation.integer(found.headerRow, 1, 100),
      mappingVersion: KcmValidation.text(String(found.mappingVersion), "mappingVersion", 60, true),
      overwritePolicy: KcmValidation.enumValue(String(found.overwritePolicy), ["NO_OVERWRITE"])
    };
    if (!/^[A-Z]{1,3}$/.test(result.destinationColumn) ||
        !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,59}$/.test(result.mappingVersion)) {
      KcmValidation.fail("INVALID_INPUT", "El mapeo de matriz configurado es invalido");
    }
    return result;
  }

  function mapping(trainingId) {
    var normalizedTrainingId = KcmValidation.identifier(String(trainingId), "trainingId");
    var matches = KcmServiceSupport.repository().list(KcmConfig.SHEETS.MATRIX_MAPPING, function (row) {
      return String(row.trainingId) === normalizedTrainingId && KcmServiceSupport.asBoolean(row.active);
    });
    if (!matches.length) KcmValidation.fail("NOT_FOUND", "No existe un mapeo activo para la capacitacion");
    if (matches.length !== 1) KcmValidation.fail("RELEASE_CONFLICT", "La capacitacion no tiene exactamente un mapeo activo");
    return mappingRecord(matches[0]);
  }

  function sameMapping(left, right) {
    return ["trainingId", "destinationSheet", "destinationColumn", "destinationHeader", "headerRow", "mappingVersion", "overwritePolicy"]
      .every(function (field) { return String(left[field]) === String(right[field]); });
  }

  function assertMappingCurrent(expected) {
    var current = mapping(String(expected.trainingId));
    if (!sameMapping(current, expected)) {
      KcmValidation.fail("RELEASE_CONFLICT", "El mapeo activo cambio antes de confirmar la liberacion");
    }
    return current;
  }

  function idempotencyKey(session, employeeId, map) {
    return [session.sessionId, employeeId, session.trainingId, map.mappingVersion].join("|");
  }

  function plan(session, participantAttendances) {
    var map = mapping(String(session.trainingId));
    var completionDate = KcmValidation.dateIso(String(session.date));
    var seenEmployees = Object.create(null);
    var seenAttendances = Object.create(null);
    return {
      session: session, mapping: map, completionDate: completionDate,
      entries: participantAttendances.map(function (participant) {
        var attendanceId = KcmValidation.identifier(String(participant.attendanceId), "attendanceId");
        var employeeId = KcmValidation.employeeId(participant.employeeId);
        if (seenEmployees[employeeId] || seenAttendances[attendanceId]) {
          KcmValidation.fail("RELEASE_CONFLICT", "El plan de liberacion contiene registros duplicados");
        }
        seenEmployees[employeeId] = true;
        seenAttendances[attendanceId] = true;
        return {
          attendanceId: attendanceId,
          employeeId: employeeId,
          trainingId: String(session.trainingId), mappingVersion: map.mappingVersion,
          idempotencyKey: idempotencyKey(session, employeeId, map),
          completionDate: completionDate
        };
      })
    };
  }

  function contextPayload(writePlan, context) {
    return [
      String(context.batchId), String(writePlan.session.sessionId), String(context.requestId),
      String(context.planHash), String(writePlan.mapping.mappingVersion), String(context.journalMac)
    ].join("|");
  }

  function markerFor(writePlan, context, entry) {
    var payload = [
      String(context.batchId), String(writePlan.session.sessionId), String(context.requestId),
      String(context.planHash), String(writePlan.mapping.mappingVersion), String(entry.idempotencyKey)
    ].join("|");
    return "KCM_RELEASE_V2:" + String(context.batchId) + ":" + hmacHex("MATRIX_MARKER_V2", payload);
  }

  function assertDurableContext(writePlan, context, allowedPhases) {
    if (!context || typeof context !== "object" || Array.isArray(context)) {
      KcmValidation.fail("RELEASE_CONFLICT", "Falta el contexto durable de liberacion");
    }
    var batchId = KcmValidation.identifier(String(context.batchId || ""), "batchId");
    var requestId = KcmValidation.identifier(String(context.requestId || ""), "requestId");
    var planHash = String(context.planHash || "");
    var journalMac = String(context.journalMac || "");
    var contextMac = String(context.contextMac || "");
    if (!/^[a-f0-9]{64}$/.test(planHash) || !/^[a-f0-9]{64}$/.test(journalMac) || !/^[a-f0-9]{64}$/.test(contextMac)) {
      KcmValidation.fail("RELEASE_CONFLICT", "El contexto durable de liberacion es invalido");
    }
    var normalized = {
      batchId: batchId, requestId: requestId, planHash: planHash,
      journalMac: journalMac, contextMac: contextMac
    };
    var expectedMac = hmacHex("MATRIX_CONTEXT_V1", contextPayload(writePlan, normalized));
    if (!constantTimeEqual(expectedMac, contextMac)) {
      KcmValidation.fail("RELEASE_CONFLICT", "El contexto durable de liberacion no conserva su autenticidad");
    }
    var matches = KcmServiceSupport.repository().list(KcmConfig.SHEETS.RELEASE_BATCHES, function (row) {
      return String(row.batchId) === batchId;
    });
    if (matches.length !== 1) KcmValidation.fail("RELEASE_CONFLICT", "El lote durable de liberacion no es unico");
    var batch = matches[0];
    var serializedPlan = JSON.stringify(writePlan);
    if (!allowedPhases[String(batch.phase)] || String(batch.sessionId) !== String(writePlan.session.sessionId) ||
        String(batch.requestId) !== requestId || String(batch.mappingVersion) !== String(writePlan.mapping.mappingVersion) ||
        String(batch.planHash) !== planHash || String(batch.journalMac) !== journalMac ||
        String(batch.plan || "") !== serializedPlan || sha256(serializedPlan) !== planHash) {
      KcmValidation.fail("RELEASE_CONFLICT", "El contexto no coincide con el lote durable vigente");
    }
    return normalized;
  }

  function normalizedDate(value) {
    if (value instanceof Date && !isNaN(value.getTime())) return Utilities.formatDate(value, KcmConfig.TIME_ZONE, "yyyy-MM-dd");
    return String(value || "").trim();
  }

  function normalizedHeader(value) {
    return String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "")
      .replace(/\s+/g, " ").trim().toUpperCase();
  }

  function hasBlockingConflict(results) {
    return results.some(function (result) {
      return ["READY", "ALREADY_APPLIED", "RECOVERED"].indexOf(String(result.status)) === -1;
    });
  }

  function abortReadyEntries(results) {
    return results.map(function (result) {
      return result.status === "READY" ? Object.assign({}, result, { status: "ATOMIC_BATCH_ABORTED" }) : result;
    });
  }

  function publicResults(results) {
    return results.map(function (result) {
      return {
        attendanceId: result.attendanceId, employeeId: result.employeeId,
        trainingId: result.trainingId, mappingVersion: result.mappingVersion,
        idempotencyKey: result.idempotencyKey, completionDate: result.completionDate,
        status: result.status
      };
    });
  }

  function mockRowsByDestination(writePlan, context) {
    var repo = KcmServiceSupport.repository();
    var rows = repo.list(KcmConfig.SHEETS.MOCK_MATRIX);
    var byKey = Object.create(null);
    var byCell = Object.create(null);
    rows.forEach(function (row) {
      var key = String(row.idempotencyKey || "");
      var employeeId = String(row.employeeId || "").padStart(5, "0");
      var trainingId = String(row.trainingId || "");
      var cell = employeeId + "|" + trainingId;
      if (key && byKey[key]) KcmValidation.fail("RELEASE_CONFLICT", "La matriz simulada contiene claves duplicadas");
      if (/^\d{5}\|.+/.test(cell) && byCell[cell]) KcmValidation.fail("RELEASE_CONFLICT", "La matriz simulada contiene destinos duplicados");
      if (key) byKey[key] = row;
      if (/^\d{5}\|.+/.test(cell)) byCell[cell] = row;
    });
    var results = writePlan.entries.map(function (entry) {
      var existingKey = byKey[entry.idempotencyKey];
      var cell = entry.employeeId + "|" + entry.trainingId;
      if (existingKey) {
        var expectedMarker = context ? markerFor(writePlan, context, entry) : "";
        var same = Boolean(context) && String(existingKey.sessionId) === String(writePlan.session.sessionId) &&
          String(existingKey.employeeId).padStart(5, "0") === entry.employeeId &&
          String(existingKey.trainingId) === entry.trainingId &&
          String(existingKey.mappingVersion) === entry.mappingVersion &&
          normalizedDate(existingKey.completionDate) === entry.completionDate &&
          String(existingKey.batchId) === String(context.batchId) &&
          String(existingKey.planHash) === String(context.planHash) &&
          constantTimeEqual(String(existingKey.marker || ""), expectedMarker);
        return Object.assign({}, entry, { status: same ? "RECOVERED" : "IDEMPOTENCY_CONFLICT" });
      }
      if (byCell[cell]) return Object.assign({}, entry, { status: "EXISTING_VALUE_CONFLICT" });
      return Object.assign({}, entry, { status: "READY" });
    });
    return { repo: repo, results: results };
  }

  function writeMock(writePlan, context, inspected) {
    inspected = inspected || mockRowsByDestination(writePlan, context);
    var results = inspected.results;
    if (hasBlockingConflict(results)) return publicResults(abortReadyEntries(results));
    var inserts = [];
    results.forEach(function (result) {
      if (result.status === "READY") {
        inserts.push({
          idempotencyKey: result.idempotencyKey, sessionId: writePlan.session.sessionId,
          employeeId: result.employeeId, trainingId: result.trainingId,
          mappingVersion: result.mappingVersion, completionDate: result.completionDate,
          batchId: context.batchId, planHash: context.planHash,
          marker: markerFor(writePlan, context, result), createdAt: KcmServiceSupport.nowIso()
        });
      }
    });
    inspected.repo.insertMany(KcmConfig.SHEETS.MOCK_MATRIX, inserts);
    return publicResults(results.map(function (result) {
      return result.status === "READY" ? Object.assign({}, result, { status: "WRITTEN" }) : result;
    }));
  }

  function inspectSheets(writePlan, context) {
    var spreadsheetId = KcmConfig.property("KCM_MATRIX_SPREADSHEET_ID", "");
    var employeeColumn = KcmConfig.property("KCM_MATRIX_EMPLOYEE_COLUMN", "B").toUpperCase();
    var firstDataRow = Number(KcmConfig.property("KCM_MATRIX_FIRST_DATA_ROW", String(writePlan.mapping.headerRow + 1)));
    if (!spreadsheetId || !/^[A-Z]{1,3}$/.test(employeeColumn) || !Number.isInteger(firstDataRow) || firstDataRow < 1) {
      KcmValidation.fail("INTERNAL_ERROR", "La matriz no esta configurada");
    }
    var sheet = SpreadsheetApp.openById(spreadsheetId).getSheetByName(writePlan.mapping.destinationSheet);
    if (!sheet) KcmValidation.fail("INTERNAL_ERROR", "La hoja destino de matriz no existe");
    var actualHeader = sheet.getRange(writePlan.mapping.destinationColumn + writePlan.mapping.headerRow).getDisplayValue();
    if (normalizedHeader(actualHeader) !== normalizedHeader(writePlan.mapping.destinationHeader)) {
      KcmValidation.fail("RELEASE_CONFLICT", "El encabezado de la matriz cambio desde la version de mapeo");
    }
    var lastRow = sheet.getLastRow();
    var rowCount = Math.max(lastRow - firstDataRow + 1, 0);
    if (!rowCount) KcmValidation.fail("NOT_FOUND", "La matriz no contiene trabajadores");
    var employeeValues = sheet.getRange(employeeColumn + firstDataRow + ":" + employeeColumn + lastRow).getDisplayValues();
    var targetRange = sheet.getRange(writePlan.mapping.destinationColumn + firstDataRow + ":" + writePlan.mapping.destinationColumn + lastRow);
    var targetValues = targetRange.getValues();
    var targetNotes = targetRange.getNotes();
    var targetFormulas = targetRange.getFormulas();
    var employeeRows = Object.create(null);
    employeeValues.forEach(function (row, index) {
      var id = String(row[0]).trim().padStart(5, "0");
      if (!/^\d{5}$/.test(id)) return;
      if (employeeRows[id]) KcmValidation.fail("RELEASE_CONFLICT", "La matriz contiene numeros de trabajador duplicados");
      employeeRows[id] = firstDataRow + index;
    });
    var seenAddresses = Object.create(null);
    var results = writePlan.entries.map(function (entry) {
      var rowNumber = employeeRows[entry.employeeId];
      if (!rowNumber) return Object.assign({}, entry, { status: "EMPLOYEE_NOT_FOUND" });
      var address = writePlan.mapping.destinationColumn + rowNumber;
      if (seenAddresses[address]) KcmValidation.fail("RELEASE_CONFLICT", "El plan de liberacion contiene destinos duplicados");
      seenAddresses[address] = true;
      var offset = rowNumber - firstDataRow;
      var current = targetValues[offset][0];
      var currentNote = String(targetNotes[offset][0] || "");
      var currentFormula = String(targetFormulas[offset][0] || "");
      var marker = context ? markerFor(writePlan, context, entry) : "";
      if (currentFormula) return Object.assign({}, entry, { status: "EXISTING_FORMULA_CONFLICT" });
      if (current !== "" && current !== null) {
        if (context && normalizedDate(current) === entry.completionDate && constantTimeEqual(currentNote, marker)) {
          return Object.assign({}, entry, { status: "RECOVERED" });
        }
        return Object.assign({}, entry, { status: "EXISTING_VALUE_CONFLICT" });
      }
      if (currentNote) return Object.assign({}, entry, { status: "EXISTING_NOTE_CONFLICT" });
      return Object.assign({}, entry, { status: "READY" });
    });
    return { sheet: sheet, results: results };
  }

  function preview(writePlan) {
    assertMappingCurrent(writePlan.mapping);
    var results = KcmConfig.isMockMode()
      ? mockRowsByDestination(writePlan, null).results
      : inspectSheets(writePlan, null).results;
    if (hasBlockingConflict(results)) results = abortReadyEntries(results);
    return publicResults(results);
  }

  function assertWriteSupported() {
    if (!KcmConfig.isMockMode()) {
      KcmValidation.fail(
        "RELEASE_CONFLICT",
        "La escritura directa en la matriz real esta deshabilitada; se requiere un gateway con precondicion atomica"
      );
    }
    return true;
  }

  function commitSupported() {
    return KcmConfig.isMockMode();
  }

  function write(writePlan, context) {
    var durable = assertDurableContext(writePlan, context, CONTEXT_PHASES_FOR_WRITE);
    var inspected = KcmConfig.isMockMode()
      ? mockRowsByDestination(writePlan, durable)
      : inspectSheets(writePlan, durable);
    if (inspected.results.length && inspected.results.every(function (result) {
      return String(result.status) === "RECOVERED";
    })) {
      return publicResults(inspected.results);
    }
    assertMappingCurrent(writePlan.mapping);
    assertWriteSupported();
    return writeMock(writePlan, durable, inspected);
  }

  function verifyApplied(writePlan, context, expectedResults) {
    var durable = assertDurableContext(writePlan, context, CONTEXT_PHASES_FOR_VERIFY);
    var actual = KcmConfig.isMockMode()
      ? mockRowsByDestination(writePlan, durable).results
      : inspectSheets(writePlan, durable).results;
    var expectedByKey = Object.create(null);
    expectedResults.forEach(function (result) {
      if (!EFFECTIVE_RESULTS[String(result.status)]) {
        KcmValidation.fail("RELEASE_CONFLICT", "El journal no contiene un lote de matriz efectivo");
      }
      expectedByKey[String(result.idempotencyKey)] = result;
    });
    if (actual.length !== expectedResults.length || actual.some(function (result) {
      return !expectedByKey[String(result.idempotencyKey)] || String(result.status) !== "RECOVERED";
    })) {
      KcmValidation.fail("RELEASE_CONFLICT", "La matriz no confirma los efectos autenticados del lote");
    }
    return publicResults(actual);
  }

  return Object.freeze({
    mapping: mapping, assertMappingCurrent: assertMappingCurrent, plan: plan,
    preview: preview, write: write, verifyApplied: verifyApplied,
    assertWriteSupported: assertWriteSupported, commitSupported: commitSupported
  });
}());
