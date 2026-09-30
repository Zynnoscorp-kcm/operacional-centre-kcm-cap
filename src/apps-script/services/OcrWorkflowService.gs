var KcmOcrWorkflowService = (function () {
  "use strict";

  var TECHNICAL_OCR_FLAGS = Object.freeze({
    PAGE_ALIGNMENT_REVIEW_REQUIRED: true,
    ROW_NOT_DETECTED: true,
    BLANK_ROW: true,
    BLANK_DIGIT: true,
    LOW_CONTRAST_IMAGE: true,
    PAGE_BOUNDARY_NOT_DISTINCT: true,
    FULL_FRAME_FALLBACK: true
  });
  var HUMAN_REVIEW_POLICY_FLAG = "HUMAN_REVIEW_REQUIRED_BY_POLICY";

  var REVIEW_VARIANTS = Object.freeze({
    ORIGINAL: Object.freeze({ field: null, cropScoped: false, kinds: ["LISTA_FISICA_ORIGINAL"] }),
    CROP_LEGACY: Object.freeze({ field: "cropEvidenceId", cropScoped: false, kinds: ["OCR_CROP", "OCR_CROP_VISUAL", "OCR_CROP_PROCESSED"] }),
    CROP_VISUAL: Object.freeze({ field: "visualEvidenceId", cropScoped: true, kinds: ["OCR_CROP_VISUAL"] }),
    CROP_PROCESSED: Object.freeze({ field: "processedEvidenceId", cropScoped: true, kinds: ["OCR_CROP_PROCESSED"] })
  });

  function safeDigits(value, exact) {
    var normalized = String(value || "");
    var pattern = exact ? /^\d{5}$/ : /^\d{0,5}$/;
    return pattern.test(normalized) ? normalized : "";
  }

  function safeConfidence(value) {
    var number = Number(value);
    return isFinite(number) && number >= 0 && number <= 1 ? number : 0;
  }

  function safeTokens(value, maximum) {
    return KcmServiceSupport.parseArray(value).slice(0, maximum).map(String).filter(function (item) {
      return /^[A-Z0-9_]{1,60}$/.test(item);
    });
  }

  function evidenceVariants(candidate, document) {
    var variants = [];
    if (document && document.evidenceId) variants.push("ORIGINAL");
    if (candidate.cropEvidenceId) variants.push("CROP_LEGACY");
    return variants;
  }

  function storedCropEvidenceRefs(value) {
    var seenIds = Object.create(null);
    var seenDigits = Object.create(null);
    var parsed = KcmServiceSupport.parseArray(value);
    if (!Array.isArray(parsed)) return [];
    return parsed.slice(0, 5).map(function (input) {
      var cropId = String(input && input.cropId || "");
      var digitIndex = Number(input && input.digitIndex);
      var visualEvidenceId = String(input && input.visualEvidenceId || "");
      var processedEvidenceId = String(input && input.processedEvidenceId || "");
      if (!/^[A-Za-z0-9_-]{1,100}$/.test(cropId) || !Number.isInteger(digitIndex) || digitIndex < 0 || digitIndex > 4) return null;
      if (seenIds[cropId] || seenDigits[digitIndex]) return null;
      if (visualEvidenceId && !/^[A-Za-z0-9_-]{1,100}$/.test(visualEvidenceId)) return null;
      if (processedEvidenceId && !/^[A-Za-z0-9_-]{1,100}$/.test(processedEvidenceId)) return null;
      seenIds[cropId] = true;
      seenDigits[digitIndex] = true;
      return {
        cropId: cropId, digitIndex: digitIndex,
        visualEvidenceId: visualEvidenceId,
        processedEvidenceId: processedEvidenceId
      };
    }).filter(Boolean).sort(function (left, right) { return left.digitIndex - right.digitIndex; });
  }

  function strictStoredCropEvidenceRefs(value) {
    var parsed = KcmServiceSupport.parseArray(value);
    if (!Array.isArray(parsed) || parsed.length < 1 || parsed.length > 5) {
      KcmValidation.fail("NOT_FOUND", "Los recortes de revision no estan disponibles");
    }
    var references = storedCropEvidenceRefs(parsed);
    if (references.length !== parsed.length) KcmValidation.fail("NOT_FOUND", "Los recortes de revision no estan disponibles");
    return references;
  }

  function normalizeCropEvidenceRefs(value) {
    if (value === undefined || value === null || value === "") return "[]";
    if (!Array.isArray(value) || value.length > 5) KcmValidation.fail("INVALID_ARRAY", "Se permiten hasta cinco referencias de casilla");
    var normalized = value.map(function (input) {
      if (!input || typeof input !== "object") KcmValidation.fail("INVALID_INPUT", "Referencia de casilla invalida");
      return {
        cropId: KcmValidation.identifier(input.cropId, "cropId"),
        digitIndex: KcmValidation.integer(input.digitIndex, 0, 4),
        visualEvidenceId: input.visualEvidenceId ? KcmValidation.identifier(input.visualEvidenceId, "visualEvidenceId") : "",
        processedEvidenceId: input.processedEvidenceId ? KcmValidation.identifier(input.processedEvidenceId, "processedEvidenceId") : ""
      };
    });
    var ids = Object.create(null);
    var digits = Object.create(null);
    normalized.forEach(function (reference) {
      if (ids[reference.cropId] || digits[reference.digitIndex]) KcmValidation.fail("DUPLICATE", "Las referencias de casilla deben ser unicas");
      ids[reference.cropId] = true;
      digits[reference.digitIndex] = true;
    });
    return KcmValidation.json(normalized, 2000);
  }

  function candidateDto(candidate, document) {
    var confidences = KcmServiceSupport.parseArray(candidate.digitConfidences).slice(0, 5).map(safeConfidence);
    var rowIndex = Number(candidate.rowIndex);
    var allowedDecisions = ["AUTO_ACEPTADO", "REVISION_REQUERIDA", "CONFIRMADO_HUMANO", "CONFIRMADO_VACIO", "RECHAZADO"];
    var decision = String(candidate.decision || "");
    return {
      candidateId: String(candidate.candidateId),
      documentId: String(candidate.documentId),
      rowIndex: Number.isInteger(rowIndex) && rowIndex >= 1 && rowIndex <= 40 ? rowIndex : null,
      rawDigits: safeDigits(candidate.rawDigits, false),
      digitConfidences: confidences.length === 5 ? confidences : [],
      overallConfidence: safeConfidence(candidate.overallConfidence),
      normalizedEmployeeId: safeDigits(candidate.normalizedEmployeeId, true),
      decision: allowedDecisions.indexOf(decision) === -1 ? "REVISION_REQUERIDA" : decision,
      validationFlags: safeTokens(candidate.validationFlags, 20),
      originalValue: safeDigits(candidate.originalValue, false),
      correctedValue: safeDigits(candidate.correctedValue, true),
      correctionAt: /^\d{4}-\d{2}-\d{2}T/.test(String(candidate.correctionAt || "")) ? String(candidate.correctionAt) : "",
      correctionReason: String(candidate.correctionReason || "").slice(0, 300),
      evidenceVariants: evidenceVariants(candidate, document),
      cropEvidenceRefs: storedCropEvidenceRefs(candidate.cropEvidenceRefs).map(function (reference) {
        var variants = [];
        if (reference.visualEvidenceId) variants.push("CROP_VISUAL");
        if (reference.processedEvidenceId) variants.push("CROP_PROCESSED");
        return { cropId: reference.cropId, digitIndex: reference.digitIndex, evidenceVariants: variants };
      })
    };
  }

  function documentDto(document) {
    return {
      documentId: String(document.documentId), sessionId: String(document.sessionId),
      evidenceId: String(document.evidenceId), sha256: String(document.sha256),
      mimeType: String(document.mimeType), byteSize: Number(document.byteSize),
      pageCount: Number(document.pageCount), status: String(document.status),
      createdAt: String(document.createdAt), version: String(document.version)
    };
  }

  function evidenceDto(evidence) {
    return {
      evidenceId: String(evidence.evidenceId), kind: String(evidence.kind),
      sha256: String(evidence.sha256), mimeType: String(evidence.mimeType),
      immutable: KcmServiceSupport.asBoolean(evidence.immutable),
      createdAt: String(evidence.createdAt), version: String(evidence.version)
    };
  }

  function reviewEvidenceDto(evidence) {
    return {
      kind: String(evidence.kind), sha256: String(evidence.sha256),
      mimeType: String(evidence.mimeType),
      immutable: KcmServiceSupport.asBoolean(evidence.immutable)
    };
  }

  function evidenceIndex(repo) {
    var index = Object.create(null);
    repo.list(KcmConfig.SHEETS.EVIDENCE).forEach(function (evidence) {
      index[String(evidence.evidenceId)] = evidence;
    });
    return index;
  }

  function assertLinkedEvidence(evidence, document, candidate, variant) {
    var rule = REVIEW_VARIANTS[variant];
    if (!evidence || String(evidence.sessionId) !== String(document.sessionId)) {
      KcmValidation.fail("NOT_FOUND", "La evidencia de revision no esta disponible");
    }
    if (rule.kinds.indexOf(String(evidence.kind)) === -1) {
      KcmValidation.fail("NOT_FOUND", "La evidencia de revision no esta disponible");
    }
    if (!KcmServiceSupport.asBoolean(evidence.immutable)) {
      KcmValidation.fail("NOT_FOUND", "La evidencia de revision no esta disponible");
    }
    if (variant !== "ORIGINAL" && ["image/png", "image/jpeg"].indexOf(String(evidence.mimeType)) === -1) {
      KcmValidation.fail("NOT_FOUND", "La evidencia de revision no esta disponible");
    }
    if (evidence.documentId && String(evidence.documentId) !== String(document.documentId)) {
      KcmValidation.fail("NOT_FOUND", "La evidencia de revision no esta disponible");
    }
    if (candidate && evidence.candidateId && String(evidence.candidateId) !== String(candidate.candidateId)) {
      KcmValidation.fail("NOT_FOUND", "La evidencia de revision no esta disponible");
    }
    return evidence;
  }

  function validateCandidateEvidenceReferences(document, candidates, repo) {
    var byId = evidenceIndex(repo);
    candidates.forEach(function (candidate) {
      var legacyId = String(candidate.cropEvidenceId || "");
      if (legacyId) assertLinkedEvidence(byId[legacyId], document, candidate, "CROP_LEGACY");
      storedCropEvidenceRefs(candidate.cropEvidenceRefs).forEach(function (reference) {
        ["CROP_VISUAL", "CROP_PROCESSED"].forEach(function (variant) {
          var id = String(reference[REVIEW_VARIANTS[variant].field] || "");
          if (id) assertLinkedEvidence(byId[id], document, candidate, variant);
        });
      });
    });
  }

  function assertCompletedCandidateCropEvidence(document, candidate, repo) {
    var references = strictStoredCropEvidenceRefs(candidate.cropEvidenceRefs);
    if (references.length !== 5) KcmValidation.fail("INVALID_STATE", "El renglon no tiene cinco casillas de evidencia completas");
    var byId = evidenceIndex(repo);
    var batchesByRequest = Object.create(null);
    repo.list(KcmConfig.SHEETS.OCR_CROP_BATCHES, function (row) {
      return String(row.sessionId) === String(document.sessionId) && String(row.documentId) === String(document.documentId);
    }).forEach(function (batch) { batchesByRequest[String(batch.requestId)] = batch; });
    var usedEvidenceIds = Object.create(null);
    references.forEach(function (reference, digitIndex) {
      var expectedCropId = "r" + String(candidate.rowIndex).padStart(2, "0") + "-d" + String(digitIndex + 1);
      if (reference.digitIndex !== digitIndex || reference.cropId !== expectedCropId) {
        KcmValidation.fail("INVALID_STATE", "La geometria de los recortes del renglon no es integra");
      }
      [{ field: "visualEvidenceId", variant: "CROP_VISUAL", kind: "OCR_CROP_VISUAL" },
       { field: "processedEvidenceId", variant: "CROP_PROCESSED", kind: "OCR_CROP_PROCESSED" }].forEach(function (rule) {
        var evidenceId = String(reference[rule.field] || "");
        var evidence = byId[evidenceId];
        if (!evidenceId || usedEvidenceIds[evidenceId]) KcmValidation.fail("INVALID_STATE", "Las evidencias de casilla no son unicas");
        usedEvidenceIds[evidenceId] = true;
        assertLinkedEvidence(evidence, document, candidate, rule.variant);
        if (String(evidence.documentId) !== String(document.documentId) ||
            String(evidence.candidateId) !== String(candidate.candidateId) ||
            String(evidence.cropId) !== expectedCropId || String(evidence.variant) !== rule.variant ||
            String(evidence.kind) !== rule.kind || String(evidence.status) !== "LISTA" ||
            !/^[a-f0-9]{64}$/.test(String(evidence.sha256)) || Number(evidence.byteSize) < 1 ||
            !/^[A-Za-z0-9_-]{1,200}$/.test(String(evidence.driveFileId || ""))) {
          KcmValidation.fail("INVALID_STATE", "Una evidencia de casilla no conserva su integridad");
        }
        var requestId = String(evidence.requestId || "");
        var batch = batchesByRequest[requestId];
        if (!requestId || !batch || String(batch.status) !== "COMPLETADO") {
          KcmValidation.fail("INVALID_STATE", "El lote de recortes del renglon no esta completado");
        }
      });
    });
    return references;
  }

  function retryableConflict(message) {
    var error = new Error(message);
    error.code = "CONFLICT";
    error.retryable = true;
    throw error;
  }

  function acquireOcrMutationLock() {
    if (typeof KcmScriptLock !== "undefined") {
      return KcmScriptLock.acquire(30000, "Existe otra operacion OCR en curso; reintente");
    }
    var lock = LockService.getScriptLock();
    if (!lock.tryLock(30000)) retryableConflict("Existe otra operacion OCR en curso; reintente");
    return lock;
  }

  function auditOnce(identity, repo, input, requestScoped, ownedLock) {
    var requestId = String(input.requestId || "");
    var lock = ownedLock ? null : acquireOcrMutationLock();
    try {
      var matches = repo.list(KcmConfig.SHEETS.AUDIT, function (row) {
        return String(row.sessionId || "") === String(input.sessionId || "") &&
          String(row.entityType || "") === String(input.entityType || "") &&
          String(row.entityId || "") === String(input.entityId || "") &&
          String(row.action || "") === String(input.action || "") &&
          String(row.previousState || "") === String(input.previousState || "") &&
          String(row.newState || "") === String(input.newState || "") &&
          String(row.reason || "") === String(input.reason || "");
      });
      if (matches.length > 1) KcmValidation.fail("INVALID_STATE", "La auditoria OCR contiene eventos duplicados");
      if (matches.length === 1) {
        if (requestId && String(matches[0].requestId || "") !== requestId) {
          KcmValidation.fail("INVALID_STATE", "La auditoria OCR conserva una solicitud distinta");
        }
        return matches[0];
      }
      if (!requestId) return KcmServiceSupport.audit(identity, input);
      requestId = KcmValidation.identifier(requestId, "requestId");
      var scopedMatches = repo.list(KcmConfig.SHEETS.AUDIT, function (row) {
        return String(row.sessionId || "") === String(input.sessionId || "") &&
          String(row.entityType || "") === String(input.entityType || "") &&
          String(row.entityId || "") === String(input.entityId || "") &&
          String(row.action || "") === String(input.action || "") &&
          (requestScoped === false || String(row.requestId || "") === requestId);
      });
      if (scopedMatches.length > 1) KcmValidation.fail("INVALID_STATE", "La auditoria OCR contiene eventos duplicados");
      if (scopedMatches.length === 1) return scopedMatches[0];
      return KcmServiceSupport.audit(identity, Object.assign({}, input, { requestId: requestId }));
    } finally {
      if (lock) lock.releaseLock();
    }
  }

  function sessionDocuments(repo, sessionId) {
    return repo.list(KcmConfig.SHEETS.OCR_DOCUMENTS, function (row) {
      return String(row.sessionId) === String(sessionId);
    });
  }

  function assertOnlyDocument(repo, document) {
    var documents = sessionDocuments(repo, document.sessionId);
    if (documents.length !== 1 || String(documents[0].documentId) !== String(document.documentId)) {
      KcmValidation.fail("INVALID_STATE", "La sesion OCR no conserva un unico documento fuente");
    }
  }

  function assertOriginalUploadEvidence(evidence, document) {
    if (!evidence || String(evidence.evidenceId) !== String(document.evidenceId) ||
        String(evidence.sessionId) !== String(document.sessionId) ||
        String(evidence.kind) !== "LISTA_FISICA_ORIGINAL" ||
        String(evidence.sha256) !== String(document.sha256) ||
        String(evidence.mimeType) !== String(document.mimeType) ||
        !KcmServiceSupport.asBoolean(evidence.immutable) ||
        (evidence.documentId && String(evidence.documentId) !== String(document.documentId)) ||
        (evidence.byteSize !== undefined && evidence.byteSize !== "" && Number(evidence.byteSize) !== Number(document.byteSize)) ||
        (evidence.status && String(evidence.status) !== "LISTA") ||
        !/^[A-Za-z0-9_-]{1,200}$/.test(String(evidence.driveFileId || ""))) {
      KcmValidation.fail("INVALID_STATE", "La evidencia original no conserva su vinculo inmutable");
    }
    return evidence;
  }

  function reconcileUploadedSession(repo, session, document) {
    var sessionStatus = String(session.status);
    var documentStatus = String(document.status);
    if (documentStatus === "RECIBIDO" && sessionStatus === "CERRADA") {
      repo.updateMany(KcmConfig.SHEETS.SESSIONS, "sessionId", [{ sessionId: session.sessionId, status: "EVIDENCIA_RECIBIDA" }]);
      session.status = "EVIDENCIA_RECIBIDA";
      return true;
    }
    var valid = (documentStatus === "RECIBIDO" && sessionStatus === "EVIDENCIA_RECIBIDA") ||
      (documentStatus === "OCR_EN_PROCESO" && sessionStatus === "OCR_EN_PROCESO") ||
      (documentStatus === "REVISION_OCR" && sessionStatus === "REVISION_OCR");
    if (!valid) KcmValidation.fail("INVALID_STATE", "Los estados de la sesion y su documento OCR no coinciden");
    return false;
  }

  function upload(input) {
    var identity = KcmAuth.requireRoles(["CAPACITACION", "ADMINISTRADOR"]);
    var sessionId = KcmValidation.identifier(input.sessionId, "sessionId");
    var initialSession = KcmServiceSupport.session(sessionId);
    if (["CERRADA", "EVIDENCIA_RECIBIDA", "OCR_EN_PROCESO", "REVISION_OCR"].indexOf(String(initialSession.status)) === -1) KcmValidation.fail("INVALID_STATE", "La sesion no admite evidencia OCR");
    var declaredMime = KcmValidation.enumValue(input.mimeType, ["image/jpeg", "image/png", "application/pdf"]);
    var parsed = KcmDriveEvidenceRepository.parseDataUrl(input.dataUrl, declaredMime);
    var repo = KcmServiceSupport.repository();
    var lock = acquireOcrMutationLock();
    try {
      var session = KcmServiceSupport.session(sessionId);
      if (["CERRADA", "EVIDENCIA_RECIBIDA", "OCR_EN_PROCESO", "REVISION_OCR"].indexOf(String(session.status)) === -1) KcmValidation.fail("INVALID_STATE", "La sesion no admite evidencia OCR");
      var documents = sessionDocuments(repo, sessionId);
      if (documents.length > 1) KcmValidation.fail("INVALID_STATE", "La sesion OCR contiene mas de un documento fuente");
      var hashMatches = repo.list(KcmConfig.SHEETS.OCR_DOCUMENTS, function (row) { return String(row.sha256) === parsed.sha256; });
      if (hashMatches.length > 1) KcmValidation.fail("INVALID_STATE", "El hash OCR no conserva una identidad documental unica");
      var originalMatches = repo.list(KcmConfig.SHEETS.EVIDENCE, function (row) {
        return String(row.kind) === "LISTA_FISICA_ORIGINAL" && String(row.sha256) === parsed.sha256;
      });
      if (originalMatches.length > 1) KcmValidation.fail("INVALID_STATE", "El hash OCR no conserva una evidencia original unica");
      if (originalMatches.length === 1 && String(originalMatches[0].sessionId) !== sessionId) {
        KcmValidation.fail("DUPLICATE", "El archivo ya fue cargado en otra sesion");
      }
      if (hashMatches.length === 1) {
        var duplicate = hashMatches[0];
        if (String(duplicate.sessionId) !== sessionId) KcmValidation.fail("DUPLICATE", "El archivo ya fue cargado en otra sesion");
        if (documents.length !== 1 || String(documents[0].documentId) !== String(duplicate.documentId)) {
          KcmValidation.fail("INVALID_STATE", "La sesion OCR no conserva una identidad documental unica");
        }
        var duplicateEvidence = repo.findOne(KcmConfig.SHEETS.EVIDENCE, function (row) {
          return String(row.evidenceId) === String(duplicate.evidenceId);
        });
        assertOriginalUploadEvidence(duplicateEvidence, duplicate);
        var repaired = reconcileUploadedSession(repo, session, duplicate);
        auditOnce(identity, repo, {
          sessionId: sessionId, entityType: "Evidence", entityId: duplicateEvidence.evidenceId,
          action: "OCR_EVIDENCE_STORED", newState: "IMMUTABLE", evidenceId: duplicateEvidence.evidenceId
        }, false, true);
        if (repaired) {
          auditOnce(identity, repo, {
            sessionId: sessionId, entityType: "Evidence", entityId: duplicateEvidence.evidenceId,
            action: "OCR_EVIDENCE_UPLOAD_RECOVERED", previousState: "CERRADA", newState: "EVIDENCIA_RECIBIDA",
            evidenceId: duplicateEvidence.evidenceId
          }, false, true);
        }
        return { duplicate: true, document: documentDto(duplicate), evidence: evidenceDto(duplicateEvidence) };
      }
      if (documents.length) KcmValidation.fail("CONFLICT", "La sesion ya tiene un documento OCR diferente");
      if (String(session.status) !== "CERRADA") KcmValidation.fail("INVALID_STATE", "Una sesion sin documento OCR solo admite la primera carga desde CERRADA");

      var safeName = "evidencia-" + session.sessionCode + "-" + parsed.sha256.slice(0, 12) + (declaredMime === "application/pdf" ? ".pdf" : declaredMime === "image/png" ? ".png" : ".jpg");
      var stored = KcmDriveEvidenceRepository.saveOriginal(parsed, safeName);
      var evidenceId = KcmDriveEvidenceRepository.stableId("original-evidence", sessionId + "|" + parsed.sha256);
      var documentId = KcmDriveEvidenceRepository.stableId("ocr-document", sessionId + "|" + parsed.sha256);
      var timestamp = KcmServiceSupport.nowIso();
      var evidence = originalMatches[0] || repo.findOne(KcmConfig.SHEETS.EVIDENCE, function (row) {
        return String(row.evidenceId) === evidenceId;
      });
      var document = {
        documentId: documentId, sessionId: sessionId, evidenceId: evidence ? String(evidence.evidenceId) : evidenceId,
        sha256: parsed.sha256, mimeType: parsed.mimeType, byteSize: parsed.byteSize,
        pageCount: parsed.pageCount, status: "RECIBIDO", createdBy: identity.actor,
        createdAt: timestamp, version: KcmConfig.CONTRACT_VERSION
      };
      if (evidence) {
        assertOriginalUploadEvidence(evidence, document);
        if (String(evidence.driveFileId) !== String(stored.driveFileId)) {
          KcmValidation.fail("CONFLICT", "La evidencia original no coincide con el archivo canonico de Drive");
        }
      } else {
        evidence = {
          evidenceId: evidenceId, sessionId: sessionId, kind: "LISTA_FISICA_ORIGINAL",
          driveFileId: stored.driveFileId, sha256: parsed.sha256, mimeType: parsed.mimeType,
          immutable: true, createdBy: identity.actor, createdAt: timestamp,
          version: KcmConfig.CONTRACT_VERSION, documentId: documentId,
          byteSize: parsed.byteSize, status: "LISTA"
        };
        repo.insertMany(KcmConfig.SHEETS.EVIDENCE, [evidence]);
      }
      repo.insertMany(KcmConfig.SHEETS.OCR_DOCUMENTS, [document]);
      reconcileUploadedSession(repo, session, document);
      auditOnce(identity, repo, {
        sessionId: sessionId, entityType: "Evidence", entityId: evidence.evidenceId,
        action: "OCR_EVIDENCE_STORED", newState: "IMMUTABLE", evidenceId: evidence.evidenceId
      }, false, true);
      return { duplicate: false, document: documentDto(document), evidence: evidenceDto(evidence) };
    } finally {
      parsed.bytes = [];
      lock.releaseLock();
    }
  }

  function beginProcessing(documentId) {
    var identity = KcmAuth.requireRoles(["CAPACITACION", "ADMINISTRADOR"]);
    var id = KcmValidation.identifier(documentId, "documentId");
    var repo = KcmServiceSupport.repository();
    var document = repo.findOne(KcmConfig.SHEETS.OCR_DOCUMENTS, function (row) { return String(row.documentId) === id; });
    if (!document) KcmValidation.fail("NOT_FOUND", "El documento OCR no existe");
    assertOnlyDocument(repo, document);
    var session = KcmServiceSupport.session(document.sessionId);
    var documentStatus = String(document.status);
    var sessionStatus = String(session.status);
    var repairable = (documentStatus === "RECIBIDO" || documentStatus === "OCR_EN_PROCESO") &&
      (sessionStatus === "EVIDENCIA_RECIBIDA" || sessionStatus === "OCR_EN_PROCESO");
    if (!repairable) KcmValidation.fail("INVALID_STATE", "Los estados no admiten iniciar el procesamiento OCR");
    if (sessionStatus === "EVIDENCIA_RECIBIDA") repo.updateMany(KcmConfig.SHEETS.SESSIONS, "sessionId", [{ sessionId: session.sessionId, status: "OCR_EN_PROCESO" }]);
    var updated = documentStatus === "OCR_EN_PROCESO" ? document :
      repo.updateMany(KcmConfig.SHEETS.OCR_DOCUMENTS, "documentId", [{ documentId: id, status: "OCR_EN_PROCESO" }])[0];
    KcmServiceSupport.audit(identity, { sessionId: session.sessionId, entityType: "OcrDocument", entityId: id, action: "OCR_PROCESSING_STARTED", previousState: document.status, newState: "OCR_EN_PROCESO", evidenceId: document.evidenceId });
    return updated;
  }

  function normalizeCandidates(document, candidates) {
    var repo = KcmServiceSupport.repository();
    var autoAcceptThreshold = KcmConfig.ocrAutoAcceptThreshold();
    var digitThreshold = KcmConfig.ocrDigitThreshold();
    var requireHumanReview = KcmConfig.ocrRequireHumanReview();
    var duplicateCounts = {};
    var rowCounts = {};
    candidates.forEach(function (input, index) {
      var rowIndex = Number(input.rowIndex === undefined ? index + 1 : input.rowIndex);
      var raw = String(input.rawDigits || "");
      rowCounts[rowIndex] = (rowCounts[rowIndex] || 0) + 1;
      if (/^\d{5}$/.test(raw)) duplicateCounts[raw] = (duplicateCounts[raw] || 0) + 1;
    });
    return candidates.map(function (input, index) {
      var rowIndex = KcmValidation.integer(input.rowIndex === undefined ? index + 1 : input.rowIndex, 1, 40);
      if (rowCounts[rowIndex] > 1) KcmValidation.fail("DUPLICATE", "El OCR contiene el mismo renglon mas de una vez");
      var raw = KcmValidation.text(input.rawDigits || "", "rawDigits", 5, false);
      if (raw && !/^\d{1,5}$/.test(raw)) KcmValidation.fail("INVALID_INPUT", "El OCR solo puede contener digitos");
      var confidences = Array.isArray(input.digitConfidences) ? input.digitConfidences.map(Number) : [];
      if (confidences.some(function (value) { return !isFinite(value) || value < 0 || value > 1; })) KcmValidation.fail("INVALID_INPUT", "Confianza OCR invalida");
      var confidence = Number(input.overallConfidence || 0);
      if (!isFinite(confidence) || confidence < 0 || confidence > 1) KcmValidation.fail("INVALID_INPUT", "Confianza OCR invalida");
      var normalized = /^\d{5}$/.test(raw) ? raw : "";
      var employee = normalized ? repo.findOne(KcmConfig.SHEETS.EMPLOYEES, function (row) { return String(row.employeeId).padStart(5, "0") === normalized && KcmServiceSupport.asBoolean(row.active); }) : null;
      var technicalInput = input.technicalFlags === undefined ? [] : input.technicalFlags;
      if (!Array.isArray(technicalInput) || technicalInput.length > 20) KcmValidation.fail("INVALID_ARRAY", "Banderas tecnicas OCR invalidas");
      var flags = [];
      var seenFlags = Object.create(null);
      technicalInput.forEach(function (value) {
        var flag = String(value || "");
        if (!TECHNICAL_OCR_FLAGS[flag] || seenFlags[flag]) KcmValidation.fail("INVALID_INPUT", "Bandera tecnica OCR invalida");
        seenFlags[flag] = true;
        flags.push(flag);
      });
      function addFlag(flag) {
        if (!seenFlags[flag]) { seenFlags[flag] = true; flags.push(flag); }
      }
      if (!raw) addFlag("BLANK");
      if (raw && !normalized) addFlag("NOT_FIVE_DIGITS");
      if (normalized && !employee) addFlag("EMPLOYEE_NOT_FOUND");
      if (normalized && duplicateCounts[normalized] > 1) addFlag("DUPLICATE_IN_DOCUMENT");
      if (confidence < autoAcceptThreshold) addFlag("LOW_CONFIDENCE");
      if (confidences.length !== 5 || confidences.some(function (value) { return value < digitThreshold; })) addFlag("LOW_DIGIT_CONFIDENCE");
      if (requireHumanReview) addFlag(HUMAN_REVIEW_POLICY_FLAG);
      return {
        candidateId: KcmServiceSupport.uuid(), documentId: document.documentId,
        rowIndex: rowIndex, rawDigits: raw, digitConfidences: KcmValidation.json(confidences, 200),
        overallConfidence: confidence, normalizedEmployeeId: normalized,
        decision: flags.length ? "REVISION_REQUERIDA" : "AUTO_ACEPTADO",
        validationFlags: KcmValidation.json(flags, 300), originalValue: raw,
        correctedValue: "", correctionActor: "", correctionAt: "", correctionReason: "",
        correctionRequestId: "", correctionPreviousDecision: "", correctionPreviousEmployeeId: "",
        cropEvidenceId: input.cropEvidenceId ? KcmValidation.identifier(input.cropEvidenceId, "cropEvidenceId") : "",
        cropEvidenceRefs: normalizeCropEvidenceRefs(input.cropEvidenceRefs),
        version: KcmConfig.CONTRACT_VERSION
      };
    });
  }

  function ensureOcrAttendance(session, candidate, evidenceId, identity, requestId) {
    if (["AUTO_ACEPTADO", "CONFIRMADO_HUMANO"].indexOf(candidate.decision) === -1 || !candidate.normalizedEmployeeId) return null;
    var repo = KcmServiceSupport.repository();
    var matches = repo.list(KcmConfig.SHEETS.ATTENDANCES, function (row) {
      return String(row.sessionId) === session.sessionId && String(row.employeeId).padStart(5, "0") === candidate.normalizedEmployeeId;
    });
    if (matches.length > 1) KcmValidation.fail("INVALID_STATE", "La asistencia OCR no conserva una identidad unica");
    var existing = matches[0] || null;
    if (existing) {
      if (String(existing.captureRoute) === "OCR") {
        if (String(existing.sourceEvidenceId || "") !== String(evidenceId || "")) {
          KcmValidation.fail("INVALID_STATE", "La asistencia OCR no corresponde a su evidencia fuente");
        }
        var retractions = repo.list(KcmConfig.SHEETS.AUDIT, function (row) {
          return String(row.sessionId || "") === String(session.sessionId) &&
            String(row.entityType || "") === "Attendance" &&
            String(row.entityId || "") === String(existing.attendanceId) &&
            ["OCR_ATTENDANCE_RETRACTED_CORRECTION", "OCR_ATTENDANCE_RETRACTED_EMPTY_ROW"].indexOf(String(row.action || "")) !== -1;
        });
        if (retractions.length > 1) KcmValidation.fail("INVALID_STATE", "La asistencia OCR contiene retracciones duplicadas");
        var wasExcluded = String(existing.status) === "EXCLUIDA";
        if (wasExcluded) {
          if (KcmServiceSupport.asBoolean(existing.released) || KcmServiceSupport.asBoolean(existing.identityValidated) ||
              KcmServiceSupport.asBoolean(existing.attendanceProven) || retractions.length !== 1) {
            KcmValidation.fail("INVALID_STATE", "La asistencia OCR excluida no puede reactivarse de forma segura");
          }
          existing = repo.updateMany(KcmConfig.SHEETS.ATTENDANCES, "attendanceId", [{
            attendanceId: existing.attendanceId, identityValidated: true, attendanceProven: false,
            examStatus: "EXAMEN_PENDIENTE", status: "PENDIENTE_COTEJO", released: false,
            updatedAt: KcmServiceSupport.nowIso()
          }])[0];
        } else if (!KcmServiceSupport.asBoolean(existing.identityValidated)) {
          KcmValidation.fail("INVALID_STATE", "La asistencia OCR existente no conserva identidad valida");
        }
        if (retractions.length === 1) {
          auditOnce(identity, repo, {
            sessionId: session.sessionId, entityType: "Attendance", entityId: existing.attendanceId,
            action: "OCR_ATTENDANCE_REACTIVATED", previousState: "EXCLUIDA",
            newState: "PENDIENTE_COTEJO", requestId: requestId || "", evidenceId: evidenceId
          }, false);
        }
        auditOnce(identity, repo, {
          sessionId: session.sessionId, entityType: "Attendance", entityId: existing.attendanceId,
          action: "OCR_ATTENDANCE_CAPTURED", newState: String(existing.status || "PENDIENTE_COTEJO"),
          requestId: requestId || "", evidenceId: evidenceId
        }, false);
      }
      return existing;
    }
    var timestamp = KcmServiceSupport.nowIso();
    var attendance = {
      attendanceId: KcmServiceSupport.uuid(), sessionId: session.sessionId,
      employeeId: candidate.normalizedEmployeeId, captureRoute: "OCR",
      identityValidated: true, attendanceProven: false, examStatus: "EXAMEN_PENDIENTE",
      status: "PENDIENTE_COTEJO", released: false, sourceEvidenceId: evidenceId,
      createdAt: timestamp, updatedAt: timestamp, version: KcmConfig.CONTRACT_VERSION
    };
    repo.insertMany(KcmConfig.SHEETS.ATTENDANCES, [attendance]);
    auditOnce(identity, repo, {
      sessionId: session.sessionId, entityType: "Attendance", entityId: attendance.attendanceId,
      action: "OCR_ATTENDANCE_CAPTURED", newState: attendance.status,
      requestId: requestId || "", evidenceId: evidenceId
    }, false);
    return attendance;
  }

  function comparableTechnicalFlags(value) {
    return KcmServiceSupport.parseArray(value).map(String).filter(function (flag) {
      return TECHNICAL_OCR_FLAGS[flag];
    }).sort();
  }

  function sameNumbers(left, right) {
    if (left.length !== right.length) return false;
    return left.every(function (value, index) { return Number(value) === Number(right[index]); });
  }

  function reuseRemoteCandidates(repo, documentId, inputs) {
    var existing = repo.list(KcmConfig.SHEETS.OCR_RESULTS, function (row) {
      return String(row.documentId) === documentId;
    });
    if (!existing.length) return null;
    if (existing.length !== inputs.length) KcmValidation.fail("INVALID_STATE", "Los resultados OCR existentes estan incompletos");
    var byRow = Object.create(null);
    existing.forEach(function (candidate) {
      var rowIndex = Number(candidate.rowIndex);
      if (!Number.isInteger(rowIndex) || rowIndex < 1 || rowIndex > 40 || byRow[rowIndex]) {
        KcmValidation.fail("INVALID_STATE", "Los resultados OCR existentes no conservan su integridad");
      }
      byRow[rowIndex] = candidate;
    });
    return inputs.map(function (input, index) {
      var rowIndex = Number(input.rowIndex === undefined ? index + 1 : input.rowIndex);
      var candidate = byRow[rowIndex];
      var technicalInput = Array.isArray(input.technicalFlags) ? input.technicalFlags.map(String).sort() : [];
      if (!candidate || String(candidate.rawDigits || "") !== String(input.rawDigits || "") ||
          !sameNumbers(KcmServiceSupport.parseArray(candidate.digitConfidences), Array.isArray(input.digitConfidences) ? input.digitConfidences : []) ||
          Number(candidate.overallConfidence) !== Number(input.overallConfidence || 0) ||
          JSON.stringify(comparableTechnicalFlags(candidate.validationFlags)) !== JSON.stringify(technicalInput)) {
        KcmValidation.fail("CONFLICT", "El reintento OCR no coincide con los resultados existentes");
      }
      return candidate;
    });
  }

  function reconcileCandidateEffects(identity, repo, document, session, candidates, requestId, requireFullForm) {
    if (requireFullForm && candidates.length !== 40) {
      KcmValidation.fail("INVALID_STATE", "El procesamiento remoto no conserva los cuarenta renglones esperados");
    }
    var ids = Object.create(null);
    var rows = Object.create(null);
    var acceptedEmployees = Object.create(null);
    candidates.forEach(function (candidate) {
      var candidateId = String(candidate.candidateId || "");
      var rowIndex = Number(candidate.rowIndex);
      if (!candidateId || ids[candidateId] || !Number.isInteger(rowIndex) || rowIndex < 1 || rowIndex > 40 || rows[rowIndex] ||
          String(candidate.documentId) !== String(document.documentId)) {
        KcmValidation.fail("INVALID_STATE", "Los resultados OCR no conservan su identidad por renglon");
      }
      ids[candidateId] = true;
      rows[rowIndex] = true;
      var decision = String(candidate.decision || "");
      if (["AUTO_ACEPTADO", "REVISION_REQUERIDA", "CONFIRMADO_HUMANO", "CONFIRMADO_VACIO", "RECHAZADO"].indexOf(decision) === -1) {
        KcmValidation.fail("INVALID_STATE", "Un resultado OCR contiene una decision invalida");
      }
      var employeeId = acceptedCandidateEmployeeId(candidate);
      if (!employeeId) return;
      if (acceptedEmployees[employeeId]) KcmValidation.fail("DUPLICATE", "Dos resultados OCR aceptados contienen el mismo numero");
      acceptedEmployees[employeeId] = true;
      var employee = repo.findOne(KcmConfig.SHEETS.EMPLOYEES, function (row) {
        return String(row.employeeId).padStart(5, "0") === employeeId && KcmServiceSupport.asBoolean(row.active);
      });
      if (!employee) KcmValidation.fail("INVALID_STATE", "Una decision OCR aceptada ya no conserva identidad valida");
      var effectiveCandidate = Object.assign({}, candidate, { normalizedEmployeeId: employeeId });
      ensureOcrAttendance(session, effectiveCandidate, document.evidenceId, identity, requestId);
    });
    auditOnce(identity, repo, {
      sessionId: session.sessionId, entityType: "OcrDocument", entityId: document.documentId,
      action: "OCR_RESULTS_INGESTED", previousState: "OCR_EN_PROCESO",
      newState: requireFullForm ? "OCR_EN_PROCESO" : String(document.status),
      requestId: requestId || "", evidenceId: document.evidenceId
    }, true);
    return candidates;
  }

  function ingestCandidatesInternal(input, deferReviewState) {
    var identity = KcmAuth.requireRoles(["CAPACITACION", "ADMINISTRADOR"]);
    var documentId = KcmValidation.identifier(input.documentId, "documentId");
    var requestId = input.requestId ? KcmValidation.identifier(input.requestId, "requestId") : "";
    var repo = KcmServiceSupport.repository();
    var document = repo.findOne(KcmConfig.SHEETS.OCR_DOCUMENTS, function (row) { return String(row.documentId) === documentId; });
    if (!document) KcmValidation.fail("NOT_FOUND", "El documento OCR no existe");
    if (deferReviewState) {
      if (!requestId) KcmValidation.fail("INVALID_INPUT", "El requestId OCR es obligatorio");
      if (String(document.ocrRequestId || "") !== requestId) KcmValidation.fail("CONFLICT", "El documento OCR pertenece a otra solicitud");
    }
    var candidatesInput = input.candidates;
    if (!Array.isArray(candidatesInput) || candidatesInput.length > 40) KcmValidation.fail("INVALID_ARRAY", "Se permiten hasta cuarenta renglones");
    var candidates = deferReviewState ? reuseRemoteCandidates(repo, documentId, candidatesInput) : null;
    if (!candidates) {
      candidates = normalizeCandidates(document, candidatesInput);
      validateCandidateEvidenceReferences(document, candidates, repo);
      repo.insertMany(KcmConfig.SHEETS.OCR_RESULTS, candidates);
    }
    if (!deferReviewState) repo.updateMany(KcmConfig.SHEETS.OCR_DOCUMENTS, "documentId", [{ documentId: documentId, status: "REVISION_OCR" }]);
    var session = KcmServiceSupport.session(document.sessionId);
    if (!deferReviewState && String(session.status) === "OCR_EN_PROCESO") repo.updateMany(KcmConfig.SHEETS.SESSIONS, "sessionId", [{ sessionId: session.sessionId, status: "REVISION_OCR" }]);
    if (!deferReviewState) document.status = "REVISION_OCR";
    reconcileCandidateEffects(identity, repo, document, session, candidates, requestId, deferReviewState);
    return candidates.map(function (candidate) { return candidateDto(candidate, document); });
  }

  function ingestCandidates(input) {
    if (input && Object.prototype.hasOwnProperty.call(input, "deferReviewState")) {
      KcmValidation.fail("INVALID_INPUT", "El estado de procesamiento OCR no puede controlarse desde el cliente");
    }
    return ingestCandidatesInternal(input, false);
  }

  function ingestCandidatesForRemote(input) {
    return ingestCandidatesInternal(input, true);
  }

  function reconcileCandidatesForRemote(input) {
    var identity = KcmAuth.requireRoles(["CAPACITACION", "ADMINISTRADOR"]);
    var documentId = KcmValidation.identifier(input.documentId, "documentId");
    var requestId = KcmValidation.identifier(input.requestId, "requestId");
    var repo = KcmServiceSupport.repository();
    var document = repo.findOne(KcmConfig.SHEETS.OCR_DOCUMENTS, function (row) {
      return String(row.documentId) === documentId;
    });
    if (!document) KcmValidation.fail("NOT_FOUND", "El documento OCR no existe");
    if (String(document.ocrRequestId || "") !== requestId) KcmValidation.fail("CONFLICT", "El documento OCR pertenece a otra solicitud");
    if (["OCR_EN_PROCESO", "REVISION_OCR"].indexOf(String(document.status)) === -1) {
      KcmValidation.fail("INVALID_STATE", "El documento OCR no admite reconciliar sus resultados");
    }
    var session = KcmServiceSupport.session(document.sessionId);
    if (["OCR_EN_PROCESO", "REVISION_OCR"].indexOf(String(session.status)) === -1) {
      KcmValidation.fail("INVALID_STATE", "La sesion OCR no admite reconciliar sus resultados");
    }
    var candidates = repo.list(KcmConfig.SHEETS.OCR_RESULTS, function (row) {
      return String(row.documentId) === documentId;
    });
    reconcileCandidateEffects(identity, repo, document, session, candidates, requestId, true);
    return candidates.map(function (candidate) { return candidateDto(candidate, document); }).sort(function (left, right) {
      return left.rowIndex - right.rowIndex;
    });
  }

  function acceptedCandidateEmployeeId(candidate) {
    if (["AUTO_ACEPTADO", "CONFIRMADO_HUMANO"].indexOf(String(candidate.decision)) === -1) return "";
    var employeeId = String(candidate.correctedValue || candidate.normalizedEmployeeId || "");
    return /^\d{5}$/.test(employeeId) ? employeeId : "";
  }

  function hasOtherAcceptedCandidate(repo, sessionId, candidateId, employeeId) {
    var documentIds = Object.create(null);
    repo.list(KcmConfig.SHEETS.OCR_DOCUMENTS, function (row) {
      return String(row.sessionId) === String(sessionId);
    }).forEach(function (document) { documentIds[String(document.documentId)] = true; });
    return Boolean(repo.findOne(KcmConfig.SHEETS.OCR_RESULTS, function (row) {
      return String(row.candidateId) !== String(candidateId) && Boolean(documentIds[String(row.documentId)]) &&
        acceptedCandidateEmployeeId(row) === employeeId;
    }));
  }

  function retractExclusiveOcrAttendance(repo, session, document, candidate, employeeId, identity, reason, action, requestId) {
    if (!/^\d{5}$/.test(String(employeeId || ""))) return null;
    if (hasOtherAcceptedCandidate(repo, session.sessionId, candidate.candidateId, employeeId)) return null;
    var attendance = repo.findOne(KcmConfig.SHEETS.ATTENDANCES, function (row) {
      return String(row.sessionId) === String(session.sessionId) && String(row.employeeId).padStart(5, "0") === employeeId;
    });
    if (!attendance || String(attendance.captureRoute) !== "OCR" ||
        String(attendance.sourceEvidenceId || "") !== String(document.evidenceId || "")) return null;
    if (KcmServiceSupport.asBoolean(attendance.released)) {
      KcmValidation.fail("INVALID_STATE", "Una asistencia OCR ya liberada no puede reclasificarse");
    }
    var alreadyExcluded = String(attendance.status) === "EXCLUIDA" &&
      !KcmServiceSupport.asBoolean(attendance.identityValidated) &&
      !KcmServiceSupport.asBoolean(attendance.attendanceProven);
    var previousState = alreadyExcluded ? "PENDIENTE_COTEJO" : String(attendance.status);
    var updated = attendance;
    if (!alreadyExcluded) {
      updated = repo.updateMany(KcmConfig.SHEETS.ATTENDANCES, "attendanceId", [{
        attendanceId: attendance.attendanceId, identityValidated: false, attendanceProven: false,
        examStatus: "EXAMEN_PENDIENTE", status: "EXCLUIDA", updatedAt: KcmServiceSupport.nowIso()
      }])[0];
    }
    auditOnce(identity, repo, {
      sessionId: session.sessionId, entityType: "Attendance", entityId: attendance.attendanceId,
      action: action, previousState: previousState, newState: "EXCLUIDA",
      reason: reason, requestId: requestId, evidenceId: document.evidenceId
    }, false);
    return updated;
  }

  function assertReplayCorrection(candidate, identity, corrected, reason, decision) {
    if (String(candidate.decision) !== decision ||
        String(candidate.correctedValue || "") !== corrected ||
        String(candidate.correctionActor || "") !== String(identity.actor) ||
        String(candidate.correctionReason || "") !== reason ||
        !/^[A-Za-z0-9_-]{1,100}$/.test(String(candidate.correctionRequestId || "")) ||
        ["REVISION_REQUERIDA", "AUTO_ACEPTADO"].indexOf(String(candidate.correctionPreviousDecision || "")) === -1 ||
        !/^(?:|\d{5})$/.test(String(candidate.correctionPreviousEmployeeId || ""))) {
      KcmValidation.fail("INVALID_STATE", "La resolucion OCR ya fue confirmada con otro contenido");
    }
    return String(candidate.correctionRequestId);
  }

  function ensureCandidateResolutionAudit(identity, repo, session, document, candidate, action, requestId) {
    return auditOnce(identity, repo, {
      sessionId: session.sessionId, entityType: "OcrCandidate", entityId: candidate.candidateId,
      action: action, previousState: String(candidate.correctionPreviousDecision),
      newState: String(candidate.decision), reason: String(candidate.correctionReason),
      requestId: requestId, evidenceId: document.evidenceId
    }, true);
  }

  function replaceCandidate(repo, candidate, patch) {
    var intended = Object.assign({}, candidate, patch);
    delete intended.__rowNumber;
    return repo.replaceOne(KcmConfig.SHEETS.OCR_RESULTS, "candidateId", intended);
  }

  function reviewCandidate(input) {
    if (!input || typeof input !== "object" || Array.isArray(input)) KcmValidation.fail("INVALID_INPUT", "Revision OCR invalida");
    var identity = KcmAuth.requireRoles(["CAPACITACION", "ADMINISTRADOR"]);
    var candidateId = KcmValidation.identifier(input.candidateId, "candidateId");
    var requestId = KcmValidation.identifier(input.requestId, "requestId");
    var corrected = KcmValidation.employeeId(input.correctedValue);
    var reason = KcmValidation.text(input.reason, "reason", 300, true);
    var lock = acquireOcrMutationLock();
    try {
      var repo = KcmServiceSupport.repository();
      var candidate = repo.findOne(KcmConfig.SHEETS.OCR_RESULTS, function (row) { return String(row.candidateId) === candidateId; });
      if (!candidate) KcmValidation.fail("NOT_FOUND", "El candidato OCR no existe");
      var document = repo.findOne(KcmConfig.SHEETS.OCR_DOCUMENTS, function (row) { return String(row.documentId) === String(candidate.documentId); });
      if (!document) KcmValidation.fail("NOT_FOUND", "El documento OCR no existe");
      var session = KcmServiceSupport.session(document.sessionId);
      if (String(session.status) !== "REVISION_OCR") KcmValidation.fail("INVALID_STATE", "La revision OCR de la sesion ya esta cerrada");
      assertCompletedCandidateCropEvidence(document, candidate, repo);
      var employee = repo.findOne(KcmConfig.SHEETS.EMPLOYEES, function (row) { return String(row.employeeId).padStart(5, "0") === corrected && KcmServiceSupport.asBoolean(row.active); });
      if (!employee) KcmValidation.fail("NOT_FOUND", "No fue posible validar la identidad");
      var duplicate = repo.findOne(KcmConfig.SHEETS.OCR_RESULTS, function (row) {
        var value = String(row.correctedValue || row.normalizedEmployeeId || "").padStart(5, "0");
        return String(row.documentId) === String(candidate.documentId) && String(row.candidateId) !== candidateId && value === corrected && ["AUTO_ACEPTADO", "CONFIRMADO_HUMANO"].indexOf(String(row.decision)) !== -1;
      });
      if (duplicate) KcmValidation.fail("DUPLICATE", "El numero ya fue confirmado en otro renglon");
      if (String(candidate.decision) === "CONFIRMADO_HUMANO") {
        requestId = assertReplayCorrection(candidate, identity, corrected, reason, "CONFIRMADO_HUMANO");
        ensureOcrAttendance(session, candidate, document.evidenceId, identity, requestId);
        if (candidate.correctionPreviousEmployeeId && String(candidate.correctionPreviousEmployeeId) !== corrected) {
          retractExclusiveOcrAttendance(repo, session, document, candidate, String(candidate.correctionPreviousEmployeeId), identity, reason, "OCR_ATTENDANCE_RETRACTED_CORRECTION", requestId);
        }
        ensureCandidateResolutionAudit(identity, repo, session, document, candidate, "OCR_CANDIDATE_CORRECTED", requestId);
        return candidateDto(candidate, document);
      }
      if (["REVISION_REQUERIDA", "AUTO_ACEPTADO"].indexOf(String(candidate.decision)) === -1) {
        KcmValidation.fail("INVALID_STATE", "El renglon OCR ya no admite correccion");
      }
      var previousDecision = String(candidate.decision);
      var previousEmployeeId = acceptedCandidateEmployeeId(candidate);
      var patch = {
        candidateId: candidateId, normalizedEmployeeId: corrected,
        decision: "CONFIRMADO_HUMANO", correctedValue: corrected,
        correctionActor: identity.actor, correctionAt: KcmServiceSupport.nowIso(),
        correctionReason: reason, correctionRequestId: requestId,
        correctionPreviousDecision: previousDecision,
        correctionPreviousEmployeeId: previousEmployeeId
      };
      var prospective = Object.assign({}, candidate, patch);
      var updated = replaceCandidate(repo, candidate, patch);
      ensureOcrAttendance(session, updated, document.evidenceId, identity, requestId);
      if (previousEmployeeId && previousEmployeeId !== corrected) {
        retractExclusiveOcrAttendance(repo, session, document, updated, previousEmployeeId, identity, reason, "OCR_ATTENDANCE_RETRACTED_CORRECTION", requestId);
      }
      ensureCandidateResolutionAudit(identity, repo, session, document, updated, "OCR_CANDIDATE_CORRECTED", requestId);
      return candidateDto(updated, document);
    } finally {
      lock.releaseLock();
    }
  }

  function confirmEmptyCandidate(input) {
    if (!input || typeof input !== "object" || Array.isArray(input)) KcmValidation.fail("INVALID_INPUT", "Revision OCR invalida");
    var identity = KcmAuth.requireRoles(["CAPACITACION", "ADMINISTRADOR"]);
    var candidateId = KcmValidation.identifier(input.candidateId, "candidateId");
    var requestId = KcmValidation.identifier(input.requestId, "requestId");
    var reason = KcmValidation.text(input.reason, "reason", 300, true);
    var lock = acquireOcrMutationLock();
    try {
      var repo = KcmServiceSupport.repository();
      var candidate = repo.findOne(KcmConfig.SHEETS.OCR_RESULTS, function (row) { return String(row.candidateId) === candidateId; });
      if (!candidate) KcmValidation.fail("NOT_FOUND", "El candidato OCR no existe");
      var document = repo.findOne(KcmConfig.SHEETS.OCR_DOCUMENTS, function (row) { return String(row.documentId) === String(candidate.documentId); });
      if (!document) KcmValidation.fail("NOT_FOUND", "El documento OCR no existe");
      var session = KcmServiceSupport.session(document.sessionId);
      if (String(session.status) !== "REVISION_OCR") KcmValidation.fail("INVALID_STATE", "La revision OCR de la sesion ya esta cerrada");
      assertCompletedCandidateCropEvidence(document, candidate, repo);
      if (String(candidate.decision) === "CONFIRMADO_VACIO") {
        requestId = assertReplayCorrection(candidate, identity, "", reason, "CONFIRMADO_VACIO");
        retractExclusiveOcrAttendance(
          repo, session, document, candidate, String(candidate.correctionPreviousEmployeeId || ""), identity,
          reason, "OCR_ATTENDANCE_RETRACTED_EMPTY_ROW", requestId
        );
        ensureCandidateResolutionAudit(identity, repo, session, document, candidate, "OCR_ROW_CONFIRMED_EMPTY", requestId);
        return candidateDto(candidate, document);
      }
      if (["REVISION_REQUERIDA", "AUTO_ACEPTADO"].indexOf(String(candidate.decision)) === -1) {
        KcmValidation.fail("INVALID_STATE", "Solo un renglon pendiente o autoaceptado puede confirmarse sin participante");
      }
      var previousDecision = String(candidate.decision);
      var previousEmployeeId = acceptedCandidateEmployeeId(candidate);
      var flags = safeTokens(candidate.validationFlags, 20);
      ["HUMAN_REVIEW_COMPLETED", "EMPTY_ROW_CONFIRMED"].forEach(function (flag) {
        if (flags.indexOf(flag) === -1) flags.push(flag);
      });
      var patch = {
        candidateId: candidateId, normalizedEmployeeId: "", decision: "CONFIRMADO_VACIO",
        validationFlags: KcmValidation.json(flags, 500), correctedValue: "",
        correctionActor: identity.actor, correctionAt: KcmServiceSupport.nowIso(), correctionReason: reason,
        correctionRequestId: requestId, correctionPreviousDecision: previousDecision,
        correctionPreviousEmployeeId: previousEmployeeId
      };
      var updated = replaceCandidate(repo, candidate, patch);
      retractExclusiveOcrAttendance(
        repo, session, document, updated, previousEmployeeId, identity,
        reason, "OCR_ATTENDANCE_RETRACTED_EMPTY_ROW", requestId
      );
      ensureCandidateResolutionAudit(identity, repo, session, document, updated, "OCR_ROW_CONFIRMED_EMPTY", requestId);
      return candidateDto(updated, document);
    } finally {
      lock.releaseLock();
    }
  }

  function listCandidates(documentId) {
    var identity = KcmAuth.requireRoles(["CAPACITACION", "ADMINISTRADOR", "AUDITOR"]);
    var id = KcmValidation.identifier(documentId, "documentId");
    var repo = KcmServiceSupport.repository();
    var document = repo.findOne(KcmConfig.SHEETS.OCR_DOCUMENTS, function (row) { return String(row.documentId) === id; });
    if (!document) KcmValidation.fail("NOT_FOUND", "El documento OCR no existe");
    KcmServiceSupport.session(document.sessionId);
    var candidates = repo.list(KcmConfig.SHEETS.OCR_RESULTS, function (row) { return String(row.documentId) === id; })
      .map(function (candidate) { return candidateDto(candidate, document); })
      .sort(function (left, right) {
        var leftRow = left.rowIndex === null ? 999 : left.rowIndex;
        var rightRow = right.rowIndex === null ? 999 : right.rowIndex;
        return leftRow - rightRow || left.candidateId.localeCompare(right.candidateId);
      });
    KcmServiceSupport.audit(identity, {
      sessionId: document.sessionId, entityType: "OcrDocument", entityId: id,
      action: "OCR_CANDIDATES_VIEWED", newState: String(candidates.length), evidenceId: document.evidenceId
    });
    return candidates;
  }

  function reviewAllCropEvidence(identity, candidate, document, repo) {
    var references = strictStoredCropEvidenceRefs(candidate.cropEvidenceRefs);
    var byId = evidenceIndex(repo);
    var usedEvidenceIds = Object.create(null);
    var resolved = references.map(function (reference) {
      var visualId = String(reference.visualEvidenceId || "");
      var processedId = String(reference.processedEvidenceId || "");
      if (!visualId || !processedId || visualId === processedId || usedEvidenceIds[visualId] || usedEvidenceIds[processedId]) {
        KcmValidation.fail("NOT_FOUND", "Cada casilla requiere evidencia visual y procesada separada");
      }
      usedEvidenceIds[visualId] = true;
      usedEvidenceIds[processedId] = true;
      return {
        reference: reference,
        visual: assertLinkedEvidence(byId[visualId], document, candidate, "CROP_VISUAL"),
        processed: assertLinkedEvidence(byId[processedId], document, candidate, "CROP_PROCESSED")
      };
    });
    var crops = resolved.map(function (item) {
      return {
        cropId: item.reference.cropId,
        digitIndex: item.reference.digitIndex,
        originalDataUrl: KcmDriveEvidenceRepository.previewEvidence(item.visual),
        processedDataUrl: KcmDriveEvidenceRepository.previewEvidence(item.processed),
        originalSha256: String(item.visual.sha256),
        processedSha256: String(item.processed.sha256)
      };
    });
    KcmServiceSupport.audit(identity, {
      sessionId: document.sessionId, entityType: "OcrCandidate", entityId: candidate.candidateId,
      action: "OCR_REVIEW_CROPS_VIEWED", newState: String(crops.length), evidenceId: document.evidenceId
    });
    return { candidateId: String(candidate.candidateId), crops: crops };
  }

  function reviewEvidence(input) {
    var identity = KcmAuth.requireRoles(["CAPACITACION", "ADMINISTRADOR", "AUDITOR"]);
    var candidateId = KcmValidation.identifier(input.candidateId, "candidateId");
    var repo = KcmServiceSupport.repository();
    var candidate = repo.findOne(KcmConfig.SHEETS.OCR_RESULTS, function (row) { return String(row.candidateId) === candidateId; });
    if (!candidate) KcmValidation.fail("NOT_FOUND", "El candidato OCR no existe");
    var document = repo.findOne(KcmConfig.SHEETS.OCR_DOCUMENTS, function (row) { return String(row.documentId) === String(candidate.documentId); });
    if (!document) KcmValidation.fail("NOT_FOUND", "El documento OCR no existe");
    KcmServiceSupport.session(document.sessionId);
    var hasCropId = input.cropId !== undefined && input.cropId !== null && input.cropId !== "";
    var hasVariant = input.variant !== undefined && input.variant !== null && input.variant !== "";
    if (!hasCropId && !hasVariant) return reviewAllCropEvidence(identity, candidate, document, repo);
    if (hasCropId && !hasVariant) KcmValidation.fail("INVALID_INPUT", "La variante de evidencia es obligatoria");
    var variant = KcmValidation.enumValue(input.variant, Object.keys(REVIEW_VARIANTS));
    var rule = REVIEW_VARIANTS[variant];
    var cropId = "";
    var evidenceId;
    if (variant === "ORIGINAL") {
      evidenceId = String(document.evidenceId || "");
    } else if (rule.cropScoped) {
      cropId = KcmValidation.identifier(input.cropId, "cropId");
      var cropReference = strictStoredCropEvidenceRefs(candidate.cropEvidenceRefs).find(function (reference) { return reference.cropId === cropId; });
      evidenceId = cropReference ? String(cropReference[rule.field] || "") : "";
    } else {
      evidenceId = String(candidate[rule.field] || "");
    }
    if (!evidenceId) KcmValidation.fail("NOT_FOUND", "La evidencia de revision no esta disponible");
    var evidence = repo.findOne(KcmConfig.SHEETS.EVIDENCE, function (row) { return String(row.evidenceId) === evidenceId; });
    assertLinkedEvidence(evidence, document, candidate, variant);
    var preview = KcmDriveEvidenceRepository.previewEvidence(evidence);
    KcmServiceSupport.audit(identity, {
      sessionId: document.sessionId, entityType: "OcrCandidate", entityId: candidateId,
      action: "OCR_REVIEW_EVIDENCE_VIEWED", newState: cropId ? variant + ":" + cropId : variant, evidenceId: evidenceId
    });
    return {
      candidateId: candidateId, documentId: String(document.documentId),
      rowIndex: candidateDto(candidate, document).rowIndex, cropId: cropId, variant: variant,
      evidence: reviewEvidenceDto(evidence), dataUrl: preview
    };
  }

  return Object.freeze({
    upload: upload, beginProcessing: beginProcessing, ingestCandidates: ingestCandidates,
    ingestCandidatesForRemote: ingestCandidatesForRemote,
    reconcileCandidatesForRemote: reconcileCandidatesForRemote,
    reviewCandidate: reviewCandidate, confirmEmptyCandidate: confirmEmptyCandidate,
    listCandidates: listCandidates,
    reviewEvidence: reviewEvidence
  });
}());
