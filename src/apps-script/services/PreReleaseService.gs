/** Cotejo fisico y contrato comun ParticipantAttendance v1 para ambas rutas. */
var KcmPreReleaseService = (function () {
  "use strict";

  var OCR_ACCEPTED_DECISIONS = Object.freeze({ AUTO_ACEPTADO: true, CONFIRMADO_HUMANO: true });
  var OCR_EMPTY_DECISION = "CONFIRMADO_VACIO";

  function invalidOcrState(message) {
    KcmValidation.fail("INVALID_STATE", message);
  }

  function parsedArrayStrict(value, message) {
    if (Array.isArray(value)) return value;
    try {
      var parsed = value === undefined || value === null || value === "" ? [] : JSON.parse(String(value));
      if (Array.isArray(parsed)) return parsed;
    } catch (ignored) { /* Se transforma en un error de dominio sanitizado. */ }
    invalidOcrState(message);
  }

  function hasHumanResolution(candidate) {
    return String(candidate.correctionActor || "").trim() !== "" &&
      /^\d{4}-\d{2}-\d{2}T/.test(String(candidate.correctionAt || "")) &&
      String(candidate.correctionReason || "").trim() !== "";
  }

  function assertCompletedBatch(batch, strictRemote) {
    if (!batch || String(batch.status) !== "COMPLETADO") invalidOcrState("Un lote de recortes OCR permanece incompleto");
    var totalPairs = Number(batch.totalPairs);
    var storedVariants = Number(batch.storedVariants);
    var linkedCandidates = Number(batch.linkedCandidates);
    var chunkCount = Number(batch.chunkCount);
    var completedChunks = parsedArrayStrict(batch.completedChunks, "El progreso del lote OCR esta corrupto");
    if (!Number.isInteger(totalPairs) || totalPairs < 1 || totalPairs > 200 ||
        storedVariants !== totalPairs * 2 || !Number.isInteger(linkedCandidates) ||
        linkedCandidates < 1 || linkedCandidates > Math.min(40, totalPairs) ||
        !Number.isInteger(chunkCount) || chunkCount < 1 || completedChunks.length !== chunkCount) {
      invalidOcrState("El journal del lote OCR no coincide con su evidencia");
    }
    if (strictRemote && (totalPairs !== 200 || storedVariants !== 400 || linkedCandidates !== 40)) {
      invalidOcrState("El lote remoto no contiene cuarenta renglones y doscientas parejas de recorte");
    }
    var seenChunks = Object.create(null);
    completedChunks.forEach(function (value) {
      var index = Number(value);
      if (!Number.isInteger(index) || index < 0 || index >= chunkCount || seenChunks[index]) {
        invalidOcrState("El progreso del lote OCR esta corrupto");
      }
      seenChunks[index] = true;
    });
    return batch;
  }

  function cropReferences(candidate) {
    var references = parsedArrayStrict(candidate.cropEvidenceRefs, "Las referencias de recorte OCR estan corruptas");
    if (references.length !== 5) invalidOcrState("Cada renglon OCR requiere cinco referencias de casilla integras");
    return references.map(function (reference, digitIndex) {
      var expectedCropId = "r" + String(candidate.rowIndex).padStart(2, "0") + "-d" + String(digitIndex + 1);
      if (!reference || typeof reference !== "object" || Number(reference.digitIndex) !== digitIndex ||
          String(reference.cropId || "") !== expectedCropId) {
        invalidOcrState("La geometria de un renglon OCR no coincide con sus cinco casillas");
      }
      var visualEvidenceId = String(reference.visualEvidenceId || "");
      var processedEvidenceId = String(reference.processedEvidenceId || "");
      if (!/^[A-Za-z0-9_-]{1,100}$/.test(visualEvidenceId) ||
          !/^[A-Za-z0-9_-]{1,100}$/.test(processedEvidenceId) ||
          visualEvidenceId === processedEvidenceId) {
        invalidOcrState("Cada casilla OCR requiere evidencia visual y procesada separada");
      }
      return {
        cropId: expectedCropId, digitIndex: digitIndex,
        visualEvidenceId: visualEvidenceId, processedEvidenceId: processedEvidenceId
      };
    });
  }

  function assertOriginalEvidence(document, session, evidenceById) {
    var evidence = evidenceById[String(document.evidenceId || "")];
    if (!evidence || String(evidence.sessionId) !== String(session.sessionId) ||
        String(evidence.kind) !== "LISTA_FISICA_ORIGINAL" ||
        !KcmServiceSupport.asBoolean(evidence.immutable) ||
        String(evidence.sha256) !== String(document.sha256) ||
        ["image/png", "image/jpeg", "application/pdf"].indexOf(String(evidence.mimeType)) === -1 ||
        !/^[A-Za-z0-9_-]{1,200}$/.test(String(evidence.driveFileId || ""))) {
      invalidOcrState("La evidencia original del documento OCR no conserva su integridad");
    }
  }

  function assertCropEvidence(evidence, expected, batchByRequest, usedEvidenceIds) {
    var evidenceId = String(evidence && evidence.evidenceId || "");
    if (!evidence || usedEvidenceIds[evidenceId]) invalidOcrState("Una evidencia de casilla OCR falta o fue reutilizada");
    usedEvidenceIds[evidenceId] = true;
    if (String(evidence.sessionId) !== expected.sessionId ||
        String(evidence.documentId) !== expected.documentId ||
        String(evidence.candidateId) !== expected.candidateId ||
        String(evidence.cropId) !== expected.cropId || String(evidence.variant) !== expected.variant ||
        String(evidence.kind) !== expected.kind || String(evidence.status) !== "LISTA" ||
        !KcmServiceSupport.asBoolean(evidence.immutable) ||
        ["image/png", "image/jpeg"].indexOf(String(evidence.mimeType)) === -1 ||
        !/^[a-f0-9]{64}$/.test(String(evidence.sha256)) || Number(evidence.byteSize) < 1 ||
        !/^[A-Za-z0-9_-]{1,200}$/.test(String(evidence.driveFileId || ""))) {
      invalidOcrState("Una evidencia de casilla OCR no conserva su integridad");
    }
    var requestId = String(evidence.requestId || "");
    var batch = batchByRequest[requestId];
    if (!requestId || (expected.requestId && requestId !== expected.requestId) || !batch ||
        String(batch.sessionId) !== expected.sessionId || String(batch.documentId) !== expected.documentId) {
      invalidOcrState("Una evidencia OCR no esta vinculada a un lote durable");
    }
    assertCompletedBatch(batch, expected.strictRemote);
  }

  function assertOcrReadyForPreRelease(session, repo) {
    var documents = repo.list(KcmConfig.SHEETS.OCR_DOCUMENTS, function (row) {
      return String(row.sessionId) === String(session.sessionId);
    });
    var documentById = Object.create(null);
    documents.forEach(function (document) {
      var documentId = String(document.documentId || "");
      if (!documentId || documentById[documentId]) invalidOcrState("Los documentos OCR de la sesion no son unicos");
      documentById[documentId] = document;
    });
    var candidates = repo.list(KcmConfig.SHEETS.OCR_RESULTS, function (row) {
      return Boolean(documentById[String(row.documentId)]);
    });
    var attendances = repo.list(KcmConfig.SHEETS.ATTENDANCES, function (row) {
      return String(row.sessionId) === String(session.sessionId);
    });
    var ocrAttendances = attendances.filter(function (row) { return String(row.captureRoute) === "OCR"; });
    if (!candidates.length && !ocrAttendances.length) return { enabled: false, exclusions: [], candidateCount: 0 };
    if (!candidates.length) invalidOcrState("La ruta OCR tiene asistencias sin candidatos durables");

    var evidenceById = Object.create(null);
    repo.list(KcmConfig.SHEETS.EVIDENCE).forEach(function (evidence) {
      var evidenceId = String(evidence.evidenceId || "");
      if (!evidenceId || evidenceById[evidenceId]) invalidOcrState("Los identificadores de evidencia OCR no son unicos");
      evidenceById[evidenceId] = evidence;
    });
    var batchByRequest = Object.create(null);
    repo.list(KcmConfig.SHEETS.OCR_CROP_BATCHES).forEach(function (batch) {
      var requestId = String(batch.requestId || "");
      if (requestId && batchByRequest[requestId]) invalidOcrState("Los requestId de lotes OCR no son unicos");
      if (requestId) batchByRequest[requestId] = batch;
    });
    var usedEvidenceIds = Object.create(null);
    var rowsByDocument = Object.create(null);
    var acceptedEmployeeIds = Object.create(null);
    var exclusions = [];
    var checkedDocuments = Object.create(null);
    var candidateCounts = Object.create(null);
    var mockMode = typeof KcmConfig.isMockMode === "function" && KcmConfig.isMockMode();

    candidates.forEach(function (candidate) {
      var candidateId = String(candidate.candidateId || "");
      var document = documentById[String(candidate.documentId)];
      var rowIndex = Number(candidate.rowIndex);
      if (!candidateId || !document || !Number.isInteger(rowIndex) || rowIndex < 1 || rowIndex > 40) {
        invalidOcrState("Un candidato OCR no conserva su identidad geometrica");
      }
      if (String(document.status) !== "REVISION_OCR") invalidOcrState("Un documento OCR no termino su procesamiento durable");
      if (!checkedDocuments[String(document.documentId)]) {
        assertOriginalEvidence(document, session, evidenceById);
        checkedDocuments[String(document.documentId)] = true;
      }
      candidateCounts[String(document.documentId)] = (candidateCounts[String(document.documentId)] || 0) + 1;
      var rowKey = String(document.documentId) + "|" + rowIndex;
      if (rowsByDocument[rowKey]) invalidOcrState("El OCR contiene el mismo renglon mas de una vez");
      rowsByDocument[rowKey] = true;

      var decision = String(candidate.decision || "");
      var normalizedEmployeeId = String(candidate.normalizedEmployeeId || "");
      if (OCR_ACCEPTED_DECISIONS[decision]) {
        if (!/^\d{5}$/.test(normalizedEmployeeId)) invalidOcrState("Un candidato OCR confirmado no conserva cinco digitos");
        if (decision === "CONFIRMADO_HUMANO" && !hasHumanResolution(candidate)) invalidOcrState("Una correccion OCR no conserva actor, fecha y motivo");
        if (acceptedEmployeeIds[normalizedEmployeeId]) invalidOcrState("El OCR contiene una identidad confirmada mas de una vez");
        acceptedEmployeeIds[normalizedEmployeeId] = candidateId;
      } else if (decision === OCR_EMPTY_DECISION) {
        if (normalizedEmployeeId || String(candidate.correctedValue || "") || !hasHumanResolution(candidate)) {
          invalidOcrState("Un renglon sin participante no conserva su decision humana auditable");
        }
        exclusions.push({
          type: "OCR_ROW_NO_PARTICIPANT", candidateId: candidateId,
          documentId: String(document.documentId), rowIndex: rowIndex,
          decision: OCR_EMPTY_DECISION, reasons: ["RENGLON_SIN_PARTICIPANTE"],
          resolvedBy: String(candidate.correctionActor), resolvedAt: String(candidate.correctionAt),
          reason: String(candidate.correctionReason)
        });
      } else {
        invalidOcrState("Todos los renglones OCR requieren una decision humana o automatica definitiva");
      }

      cropReferences(candidate).forEach(function (reference) {
        [{ evidenceId: reference.visualEvidenceId, variant: "CROP_VISUAL", kind: "OCR_CROP_VISUAL" },
         { evidenceId: reference.processedEvidenceId, variant: "CROP_PROCESSED", kind: "OCR_CROP_PROCESSED" }].forEach(function (item) {
          assertCropEvidence(evidenceById[item.evidenceId], {
            sessionId: String(session.sessionId), documentId: String(document.documentId),
            candidateId: candidateId, cropId: reference.cropId,
            variant: item.variant, kind: item.kind,
            requestId: String(document.ocrRequestId || ""),
            strictRemote: !mockMode || Boolean(String(document.ocrRequestId || ""))
          }, batchByRequest, usedEvidenceIds);
        });
      });
    });

    Object.keys(checkedDocuments).forEach(function (documentId) {
      var document = documentById[documentId];
      var remoteRequestId = String(document.ocrRequestId || "");
      var strictRemote = !mockMode || Boolean(remoteRequestId);
      if (!mockMode && !remoteRequestId) invalidOcrState("Un documento OCR productivo no conserva su requestId remoto");
      if (strictRemote && candidateCounts[documentId] !== 40) {
        invalidOcrState("Un documento OCR remoto no contiene exactamente cuarenta candidatos");
      }
      if (strictRemote) {
        for (var rowIndex = 1; rowIndex <= 40; rowIndex += 1) {
          if (!rowsByDocument[documentId + "|" + rowIndex]) invalidOcrState("Un documento OCR remoto tiene renglones faltantes");
        }
      }
    });

    Object.keys(acceptedEmployeeIds).forEach(function (employeeId) {
      var matching = attendances.filter(function (attendance) {
        return String(attendance.employeeId).padStart(5, "0") === employeeId;
      });
      if (matching.length !== 1 || !KcmServiceSupport.asBoolean(matching[0].identityValidated)) {
        invalidOcrState("Un candidato OCR confirmado no converge en una asistencia con identidad validada");
      }
    });
    ocrAttendances.forEach(function (attendance) {
      var employeeId = String(attendance.employeeId).padStart(5, "0");
      var isRetracted = String(attendance.status) === "EXCLUIDA" &&
        !KcmServiceSupport.asBoolean(attendance.identityValidated) &&
        !KcmServiceSupport.asBoolean(attendance.attendanceProven) &&
        !KcmServiceSupport.asBoolean(attendance.released);
      if (!acceptedEmployeeIds[employeeId] && !isRetracted) invalidOcrState("Una asistencia OCR no tiene candidato confirmado correspondiente");
    });
    return { enabled: true, exclusions: exclusions, candidateCount: candidates.length };
  }

  function blockingReasons(attendance, session) {
    var reasons = [];
    if (!KcmServiceSupport.asBoolean(attendance.identityValidated)) reasons.push("IDENTIDAD_INVALIDA");
    if (!KcmServiceSupport.asBoolean(attendance.attendanceProven)) reasons.push("ASISTENCIA_NO_COMPROBADA");
    if (String(attendance.examStatus) === "EXAMEN_NO_ENCONTRADO") reasons.push("EXAMEN_NO_ENCONTRADO");
    else if (String(attendance.examStatus) !== "EXAMEN_CONFIRMADO") reasons.push("EXAMEN_NO_CONFIRMADO");
    if (!KcmServiceSupport.asBoolean(session.authorized)) reasons.push("SESION_NO_AUTORIZADA");
    if (KcmServiceSupport.asBoolean(attendance.released)) reasons.push("YA_LIBERADO_PREVIAMENTE");
    return reasons;
  }

  function participantAttendance(attendance, session) {
    return {
      attendanceId: String(attendance.attendanceId), sessionId: String(attendance.sessionId),
      employeeId: String(attendance.employeeId).padStart(5, "0"),
      captureRoute: String(attendance.captureRoute),
      identityValidated: KcmServiceSupport.asBoolean(attendance.identityValidated),
      attendanceProven: KcmServiceSupport.asBoolean(attendance.attendanceProven),
      examStatus: String(attendance.examStatus),
      sessionAuthorized: KcmServiceSupport.asBoolean(session.authorized),
      released: KcmServiceSupport.asBoolean(attendance.released),
      blockingReasons: blockingReasons(attendance, session),
      sourceEvidenceId: attendance.sourceEvidenceId ? String(attendance.sourceEvidenceId) : null,
      version: KcmConfig.CONTRACT_VERSION
    };
  }

  function assertPhysicalAttendanceEvidence(evidence, session) {
    if (!evidence || String(evidence.sessionId) !== String(session.sessionId)) {
      KcmValidation.fail("NOT_FOUND", "La evidencia no corresponde a la sesion");
    }
    var byteSize = Number(evidence.byteSize);
    if (String(evidence.kind) !== "LISTA_FISICA_ORIGINAL" ||
        String(evidence.status) !== "LISTA" ||
        !KcmServiceSupport.asBoolean(evidence.immutable) ||
        ["image/png", "image/jpeg", "application/pdf"].indexOf(String(evidence.mimeType)) === -1 ||
        !/^[a-f0-9]{64}$/.test(String(evidence.sha256 || "")) ||
        !isFinite(byteSize) || Math.floor(byteSize) !== byteSize || byteSize < 1 ||
        !/^[A-Za-z0-9_-]{1,200}$/.test(String(evidence.driveFileId || ""))) {
      KcmValidation.fail("INVALID_STATE", "La evidencia fisica no esta vigente ni lista para cotejo");
    }
    return evidence;
  }

  function reconcilePhysicalAttendance(input) {
    var identity = KcmAuth.requireRoles(["CAPACITACION", "ADMINISTRADOR"]);
    var lock;
    if (typeof KcmScriptLock !== "undefined") {
      lock = KcmScriptLock.acquire(30000, "Existe otro cotejo en proceso; reintente");
    } else {
      lock = LockService.getScriptLock();
      if (!lock.tryLock(30000)) {
        var busy = new Error("Existe otro cotejo en proceso; reintente");
        busy.code = "CONFLICT"; busy.retryable = true; throw busy;
      }
    }
    try {
    var session = KcmServiceSupport.session(input.sessionId);
    if (["CERRADA", "EVIDENCIA_RECIBIDA", "REVISION_OCR", "PRELIBERACION"].indexOf(String(session.status)) === -1) KcmValidation.fail("INVALID_STATE", "La sesion no esta lista para cotejo");
    var attendedIds = KcmValidation.stringArray(input.attendedEmployeeIds || [], KcmValidation.employeeId, 40);
    if (new Set(attendedIds).size !== attendedIds.length) KcmValidation.fail("DUPLICATE", "El cotejo contiene numeros duplicados");
    var evidenceId = KcmValidation.identifier(input.evidenceId, "evidenceId");
    var repo = KcmServiceSupport.repository();
    assertOcrReadyForPreRelease(session, repo);
    var evidence = repo.findOne(KcmConfig.SHEETS.EVIDENCE, function (row) {
      return String(row.evidenceId) === evidenceId;
    });
    assertPhysicalAttendanceEvidence(evidence, session);
    var attendances = repo.list(KcmConfig.SHEETS.ATTENDANCES, function (row) { return String(row.sessionId) === session.sessionId; });
    var known = {};
    attendances.forEach(function (row) {
      if (KcmServiceSupport.asBoolean(row.identityValidated)) known[String(row.employeeId).padStart(5, "0")] = true;
    });
    attendedIds.forEach(function (employeeId) {
      if (!known[employeeId]) KcmValidation.fail("NOT_FOUND", "El cotejo contiene una identidad no capturada");
    });
    var now = KcmServiceSupport.nowIso();
    var selected = {};
    attendedIds.forEach(function (id) { selected[id] = true; });
    var updates = attendances.map(function (row) {
      var proven = KcmServiceSupport.asBoolean(row.identityValidated) && Boolean(selected[String(row.employeeId).padStart(5, "0")]);
      return {
        attendanceId: row.attendanceId, attendanceProven: proven,
        status: proven ? "COTEJADA" : "EXCLUIDA", sourceEvidenceId: evidenceId,
        updatedAt: now
      };
    });
    repo.updateMany(KcmConfig.SHEETS.ATTENDANCES, "attendanceId", updates);
    if (String(session.status) !== "PRELIBERACION") repo.updateMany(KcmConfig.SHEETS.SESSIONS, "sessionId", [{ sessionId: session.sessionId, status: "PRELIBERACION" }]);
    KcmServiceSupport.auditMany(identity, attendances.map(function (row) {
      var proven = KcmServiceSupport.asBoolean(row.identityValidated) && Boolean(selected[String(row.employeeId).padStart(5, "0")]);
      return { sessionId: session.sessionId, entityType: "Attendance", entityId: row.attendanceId, action: "PHYSICAL_ATTENDANCE_RECONCILED", previousState: row.status, newState: proven ? "COTEJADA" : "EXCLUIDA", evidenceId: evidenceId };
    }));
    return preview(session.sessionId);
    } finally {
      lock.releaseLock();
    }
  }

  function preview(sessionId) {
    KcmAuth.requireRoles(["CAPACITACION", "ADMINISTRADOR", "AUDITOR"]);
    var session = KcmServiceSupport.session(sessionId);
    var repo = KcmServiceSupport.repository();
    var ocrReadiness = assertOcrReadyForPreRelease(session, repo);
    var rows = repo.list(KcmConfig.SHEETS.ATTENDANCES, function (row) { return String(row.sessionId) === session.sessionId; });
    var participants = rows.map(function (row) { return participantAttendance(row, session); });
    var included = participants.filter(function (item) { return item.blockingReasons.length === 0; });
    var excluded = participants.filter(function (item) { return item.blockingReasons.length > 0; });
    return {
      session: session, participants: participants, included: included, excluded: excluded,
      ocrExclusions: ocrReadiness.exclusions,
      counts: {
        total: participants.length, included: included.length, excluded: excluded.length,
        ocrCandidateRows: ocrReadiness.candidateCount,
        ocrExcludedRows: ocrReadiness.exclusions.length
      }
    };
  }

  return Object.freeze({
    reconcilePhysicalAttendance: reconcilePhysicalAttendance, preview: preview,
    participantAttendance: participantAttendance, assertOcrReadyForPreRelease: assertOcrReadyForPreRelease
  });
}());
