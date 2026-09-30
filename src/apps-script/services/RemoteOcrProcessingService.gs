var KcmRemoteOcrProcessingService = (function () {
  "use strict";

  var TECHNICAL_FLAGS = Object.freeze({
    PAGE_ALIGNMENT_REVIEW_REQUIRED: true,
    ROW_NOT_DETECTED: true,
    BLANK_ROW: true,
    BLANK_DIGIT: true,
    LOW_CONTRAST_IMAGE: true,
    PAGE_BOUNDARY_NOT_DISTINCT: true,
    FULL_FRAME_FALLBACK: true
  });
  var WORKER_LEASE_MS = 360000;

  function conflict(message, retryable) {
    var error = new Error(message);
    error.code = "CONFLICT";
    error.retryable = Boolean(retryable);
    throw error;
  }

  function findDocument(documentId, repo) {
    var document = repo.findOne(KcmConfig.SHEETS.OCR_DOCUMENTS, function (row) {
      return String(row.documentId) === documentId;
    });
    if (!document) KcmValidation.fail("NOT_FOUND", "El documento OCR no existe");
    return document;
  }

  function acquireLock() {
    if (typeof KcmScriptLock !== "undefined") {
      return KcmScriptLock.acquire(30000, "Existe otro procesamiento OCR en curso; reintente");
    }
    var lock = LockService.getScriptLock();
    if (!lock.tryLock(30000)) conflict("Existe otro procesamiento OCR en curso; reintente", true);
    return lock;
  }

  function auditOnce(identity, repo, input) {
    var lock = acquireLock();
    try {
      var requestId = KcmValidation.identifier(input.requestId, "requestId");
      var matches = repo.list(KcmConfig.SHEETS.AUDIT, function (row) {
        return String(row.sessionId || "") === String(input.sessionId || "") &&
          String(row.entityType || "") === String(input.entityType || "") &&
          String(row.entityId || "") === String(input.entityId || "") &&
          String(row.action || "") === String(input.action || "") &&
          String(row.requestId || "") === requestId;
      });
      if (matches.length > 1) conflict("La auditoria OCR contiene eventos duplicados", false);
      if (matches.length === 1) return matches[0];
      return KcmServiceSupport.audit(identity, Object.assign({}, input, { requestId: requestId }));
    } finally {
      lock.releaseLock();
    }
  }

  function ensureCompletionAudit(identity, repo, document, requestId, metadata) {
    return auditOnce(identity, repo, {
      sessionId: String(document.sessionId), entityType: "OcrDocument", entityId: String(document.documentId),
      action: "REMOTE_OCR_COMPLETED", previousState: "OCR_EN_PROCESO", newState: "REVISION_OCR",
      requestId: requestId, evidenceId: String(document.evidenceId), ocrMetadata: metadata || null
    });
  }

  function assertSingleSessionDocument(repo, document) {
    var documents = repo.list(KcmConfig.SHEETS.OCR_DOCUMENTS, function (row) {
      return String(row.sessionId) === String(document.sessionId);
    });
    if (documents.length !== 1 || String(documents[0].documentId) !== String(document.documentId)) {
      KcmValidation.fail("INVALID_STATE", "La sesion OCR no conserva un unico documento fuente");
    }
  }

  function originalEvidence(document, repo) {
    var evidence = repo.findOne(KcmConfig.SHEETS.EVIDENCE, function (row) {
      return String(row.evidenceId) === String(document.evidenceId);
    });
    if (!evidence || String(evidence.sessionId) !== String(document.sessionId) ||
        String(evidence.kind) !== "LISTA_FISICA_ORIGINAL" || !KcmServiceSupport.asBoolean(evidence.immutable) ||
        String(evidence.sha256).toLowerCase() !== String(document.sha256).toLowerCase() ||
        String(evidence.mimeType) !== String(document.mimeType)) {
      KcmValidation.fail("NOT_FOUND", "La evidencia OCR original no esta disponible");
    }
    return evidence;
  }

  function parsedArray(value) {
    return KcmServiceSupport.parseArray(value);
  }

  function comparableFlags(value) {
    return parsedArray(value).map(String).filter(function (flag) { return TECHNICAL_FLAGS[flag]; }).sort();
  }

  function sameNumbers(left, right) {
    if (left.length !== right.length) return false;
    return left.every(function (value, index) { return Number(value) === Number(right[index]); });
  }

  function reuseCandidates(repo, documentId, inputs) {
    var existing = repo.list(KcmConfig.SHEETS.OCR_RESULTS, function (row) {
      return String(row.documentId) === documentId;
    });
    if (!existing.length) return null;
    if (existing.length !== inputs.length) conflict("Los resultados OCR existentes estan incompletos", true);
    var byRow = Object.create(null);
    existing.forEach(function (candidate) {
      var rowIndex = Number(candidate.rowIndex);
      if (!Number.isInteger(rowIndex) || rowIndex < 1 || rowIndex > 40 || byRow[rowIndex]) {
        conflict("Los resultados OCR existentes no conservan su integridad", false);
      }
      byRow[rowIndex] = candidate;
    });
    return inputs.map(function (input) {
      var candidate = byRow[input.rowIndex];
      if (!candidate || String(candidate.rawDigits || "") !== String(input.rawDigits || "") ||
          !sameNumbers(parsedArray(candidate.digitConfidences), input.digitConfidences) ||
          Number(candidate.overallConfidence) !== Number(input.overallConfidence) ||
          JSON.stringify(comparableFlags(candidate.validationFlags)) !== JSON.stringify(input.technicalFlags.slice().sort())) {
        conflict("El reintento OCR no coincide con los resultados existentes", false);
      }
      return { candidateId: String(candidate.candidateId), rowIndex: Number(candidate.rowIndex) };
    });
  }

  function completedReplay(repo, document, requestId) {
    var batches = repo.list(KcmConfig.SHEETS.OCR_CROP_BATCHES, function (row) {
      return String(row.requestId) === requestId;
    });
    if (batches.length > 1) conflict("El requestId OCR no conserva un journal unico", false);
    var batch = batches[0] || null;
    if (!batch) return null;
    if (document.ocrRequestId && String(document.ocrRequestId) !== requestId) {
      conflict("El documento OCR ya pertenece a otro requestId", false);
    }
    if (String(batch.documentId) !== String(document.documentId) || String(batch.sessionId) !== String(document.sessionId)) {
      conflict("El requestId OCR ya pertenece a otro documento", false);
    }
    if (String(batch.status) !== "COMPLETADO") return null;
    var candidates = repo.list(KcmConfig.SHEETS.OCR_RESULTS, function (row) {
      return String(row.documentId) === String(document.documentId);
    });
    if (candidates.length !== 40) conflict("Los resultados OCR existentes estan incompletos", true);
    var metadata = KcmServiceSupport.ocrMetadata({
      workerVersion: batch.workerVersion,
      runtime: batch.runtime,
      processingMs: batch.processingMs
    }, false);
    return {
      requestId: requestId,
      documentId: String(document.documentId),
      status: "REVISION_OCR",
      candidateCount: candidates.length,
      cropPairCount: Number(batch.totalPairs),
      storedVariants: Number(batch.storedVariants || 0),
      workerVersion: metadata.workerVersion,
      runtime: metadata.runtime ? JSON.parse(metadata.runtime) : null,
      pipelineVersion: metadata.pipelineVersion,
      processingMs: metadata.processingMs === "" ? 0 : Number(metadata.processingMs),
      repeated: true
    };
  }

  function claimProcessing(repo, documentId, requestId, identity) {
    var lock = acquireLock();
    try {
      var document = findDocument(documentId, repo);
      assertSingleSessionDocument(repo, document);
      var replay = completedReplay(repo, document, requestId);
      if (replay) {
        if (!document.ocrRequestId) {
          document = repo.updateMany(KcmConfig.SHEETS.OCR_DOCUMENTS, "documentId", [{
            documentId: documentId, ocrRequestId: requestId
          }])[0];
        }
        auditOnce(identity, repo, {
          sessionId: String(document.sessionId), entityType: "OcrDocument", entityId: documentId,
          action: "OCR_PROCESSING_STARTED", previousState: "RECIBIDO", newState: "OCR_EN_PROCESO",
          requestId: requestId, evidenceId: String(document.evidenceId)
        });
        ensureReviewState(repo, document);
        if (document.ocrLeaseId || document.ocrLeaseUntil) {
          repo.updateMany(KcmConfig.SHEETS.OCR_DOCUMENTS, "documentId", [{
            documentId: documentId, ocrLeaseId: "", ocrLeaseUntil: ""
          }]);
        }
        return { document: document, replay: replay, leaseId: "" };
      }

      var documentStatus = String(document.status);
      var session = KcmServiceSupport.session(document.sessionId);
      var sessionStatus = String(session.status);
      if (["RECIBIDO", "OCR_EN_PROCESO"].indexOf(documentStatus) === -1 ||
          ["EVIDENCIA_RECIBIDA", "OCR_EN_PROCESO"].indexOf(sessionStatus) === -1) {
        KcmValidation.fail("INVALID_STATE", "Los estados no admiten procesamiento OCR remoto");
      }
      var storedRequestId = String(document.ocrRequestId || "");
      if (storedRequestId && storedRequestId !== requestId) {
        conflict("El documento OCR ya pertenece a otro requestId", false);
      }
      var storedLeaseId = String(document.ocrLeaseId || "");
      var storedLeaseUntil = String(document.ocrLeaseUntil || "");
      if (Boolean(storedLeaseId) !== Boolean(storedLeaseUntil) ||
          (storedLeaseId && !/^[A-Za-z0-9_-]{1,100}$/.test(storedLeaseId))) {
        conflict("La concesion del procesamiento OCR esta corrupta", false);
      }
      if (storedLeaseId) {
        var expiresAt = Date.parse(storedLeaseUntil);
        if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(storedLeaseUntil) || !isFinite(expiresAt)) {
          conflict("La concesion del procesamiento OCR esta corrupta", false);
        }
      }
      var previousState = storedRequestId === requestId ? "RECIBIDO" : documentStatus;
      if (documentStatus === "RECIBIDO" || !storedRequestId) {
        document = repo.updateMany(KcmConfig.SHEETS.OCR_DOCUMENTS, "documentId", [{
          documentId: documentId, status: "OCR_EN_PROCESO", ocrRequestId: requestId
        }])[0];
      }
      if (sessionStatus === "EVIDENCIA_RECIBIDA") {
        repo.updateMany(KcmConfig.SHEETS.SESSIONS, "sessionId", [{ sessionId: session.sessionId, status: "OCR_EN_PROCESO" }]);
      }
      auditOnce(identity, repo, {
        sessionId: String(document.sessionId), entityType: "OcrDocument", entityId: documentId,
        action: "OCR_PROCESSING_STARTED", previousState: previousState, newState: "OCR_EN_PROCESO",
        requestId: requestId, evidenceId: String(document.evidenceId)
      });
      if (storedLeaseId && expiresAt > new Date().getTime()) {
        conflict("El worker OCR ya esta procesando este documento; reintente", true);
      }
      var leaseId = KcmValidation.identifier(KcmServiceSupport.uuid(), "ocrLeaseId");
      var leaseUntil = new Date(new Date().getTime() + WORKER_LEASE_MS).toISOString();
      document = repo.updateMany(KcmConfig.SHEETS.OCR_DOCUMENTS, "documentId", [{
        documentId: documentId, status: "OCR_EN_PROCESO", ocrRequestId: requestId,
        ocrLeaseId: leaseId, ocrLeaseUntil: leaseUntil
      }])[0];
      return { document: document, replay: null, leaseId: leaseId };
    } finally {
      lock.releaseLock();
    }
  }

  function releaseProcessingClaim(repo, documentId, leaseId) {
    if (!leaseId) return;
    var lock;
    var acquired = false;
    try {
      lock = acquireLock();
      acquired = true;
      var document = findDocument(documentId, repo);
      if (String(document.ocrLeaseId || "") === leaseId) {
        repo.updateMany(KcmConfig.SHEETS.OCR_DOCUMENTS, "documentId", [{
          documentId: documentId, ocrLeaseId: "", ocrLeaseUntil: ""
        }]);
      }
    } catch (ignored) {
    } finally {
      if (acquired) lock.releaseLock();
    }
  }

  function assertProcessingState(repo, document) {
    var currentDocument = findDocument(String(document.documentId), repo);
    var currentSession = KcmServiceSupport.session(document.sessionId);
    if (String(currentDocument.status) !== "OCR_EN_PROCESO" || String(currentSession.status) !== "OCR_EN_PROCESO") {
      KcmValidation.fail("INVALID_STATE", "El procesamiento OCR remoto ya no esta en curso");
    }
  }

  function ensureReviewState(repo, document) {
    var currentDocument = findDocument(String(document.documentId), repo);
    var currentSession = KcmServiceSupport.session(document.sessionId);
    var documentStatus = String(currentDocument.status);
    var sessionStatus = String(currentSession.status);
    if (["OCR_EN_PROCESO", "REVISION_OCR"].indexOf(documentStatus) === -1 ||
        ["OCR_EN_PROCESO", "REVISION_OCR"].indexOf(sessionStatus) === -1) {
      KcmValidation.fail("INVALID_STATE", "El OCR completado no puede abrir revision desde el estado actual");
    }
    if (documentStatus === "OCR_EN_PROCESO") {
      repo.updateMany(KcmConfig.SHEETS.OCR_DOCUMENTS, "documentId", [{
        documentId: String(document.documentId), status: "REVISION_OCR"
      }]);
    }
    if (sessionStatus === "OCR_EN_PROCESO") {
      repo.updateMany(KcmConfig.SHEETS.SESSIONS, "sessionId", [{
        sessionId: String(document.sessionId), status: "REVISION_OCR"
      }]);
    }
  }

  function persistDocumentMetadata(repo, documentId, requestId, metadata) {
    var document = findDocument(documentId, repo);
    var storedRequestId = String(document.ocrRequestId || "");
    if (storedRequestId && storedRequestId !== requestId) {
      conflict("El documento OCR ya pertenece a otro requestId", false);
    }
    if (String(document.ocrRequestId || "") === requestId && document.ocrRuntime) {
      var stored = KcmServiceSupport.ocrMetadata({
        workerVersion: document.ocrWorkerVersion,
        runtime: document.ocrRuntime,
        processingMs: document.ocrProcessingMs
      }, true);
      if (stored.workerVersion !== metadata.workerVersion || stored.runtime !== metadata.runtime ||
          stored.pipelineVersion !== metadata.pipelineVersion) {
        conflict("El runtime OCR cambio durante el mismo requestId", false);
      }
      return stored;
    }
    repo.updateMany(KcmConfig.SHEETS.OCR_DOCUMENTS, "documentId", [{
      documentId: documentId,
      ocrRequestId: requestId,
      ocrWorkerVersion: metadata.workerVersion,
      ocrRuntime: metadata.runtime,
      ocrPipelineVersion: metadata.pipelineVersion,
      ocrProcessingMs: metadata.processingMs,
      ocrProcessedAt: KcmServiceSupport.nowIso()
    }]);
    return metadata;
  }

  function pendingSummary(repo, document, requestId, metadata, evidenceStatus) {
    var batch = repo.findOne(KcmConfig.SHEETS.OCR_CROP_BATCHES, function (row) {
      return String(row.requestId) === requestId && String(row.documentId) === String(document.documentId);
    });
    var completed = batch ? KcmServiceSupport.parseArray(batch.completedChunks).length : 0;
    var batchMetadata = batch ? KcmServiceSupport.ocrMetadata({
      workerVersion: batch.workerVersion, runtime: batch.runtime, processingMs: batch.processingMs
    }, false) : metadata;
    return {
      requestId: requestId,
      documentId: String(document.documentId),
      status: "OCR_EN_PROCESO",
      evidenceStatus: batch ? String(batch.status) : String(evidenceStatus || "PENDIENTE"),
      candidateCount: repo.list(KcmConfig.SHEETS.OCR_RESULTS, function (row) {
        return String(row.documentId) === String(document.documentId);
      }).length,
      cropPairCount: batch ? Number(batch.totalPairs || 0) : 0,
      storedVariants: batch ? Number(batch.storedVariants || 0) : 0,
      chunkCount: batch ? Number(batch.chunkCount || 0) : 0,
      completedChunks: completed,
      workerVersion: batchMetadata.workerVersion,
      runtime: batchMetadata.runtime ? JSON.parse(batchMetadata.runtime) : null,
      pipelineVersion: batchMetadata.pipelineVersion,
      processingMs: batchMetadata.processingMs === "" ? 0 : Number(batchMetadata.processingMs),
      retryRequired: true,
      repeated: false
    };
  }

  function process(input) {
    var identity = KcmAuth.requireRoles(["CAPACITACION", "ADMINISTRADOR"]);
    var requestId = KcmValidation.identifier(input && input.requestId, "requestId");
    var documentId = KcmValidation.identifier(input && input.documentId, "documentId");
    var repo = KcmServiceSupport.repository();
    var claim = claimProcessing(repo, documentId, requestId, identity);
    var document = claim.document;
    if (claim.replay) {
      var replayLock = acquireLock();
      try {
        KcmOcrWorkflowService.reconcileCandidatesForRemote({ documentId: documentId, requestId: requestId });
      } finally {
        replayLock.releaseLock();
      }
      var replayMetadata = claim.replay.runtime ? {
        workerVersion: claim.replay.workerVersion,
        runtime: claim.replay.runtime,
        processingMs: claim.replay.processingMs
      } : null;
      ensureCompletionAudit(identity, repo, document, requestId, replayMetadata);
      auditOnce(identity, repo, {
        sessionId: String(document.sessionId), entityType: "OcrDocument", entityId: documentId,
        action: "REMOTE_OCR_REPLAYED", previousState: "REVISION_OCR", newState: "REVISION_OCR",
        requestId: requestId, evidenceId: String(document.evidenceId),
        ocrMetadata: replayMetadata
      });
      return claim.replay;
    }
    try {
      var source = KcmDriveEvidenceRepository.readOriginalBytes(originalEvidence(document, repo));
      assertProcessingState(repo, document);
      var result = KcmOcrRemoteWorkerClient.process({
        requestId: requestId,
        documentId: documentId,
        sourceSha256: source.sha256,
        mimeType: source.mimeType,
        sourceBytes: source.bytes,
        templateVersion: KcmConfig.property("KCM_OCR_TEMPLATE_VERSION", "formato-ocr-v6-1")
      });
      source.bytes = [];
      var metadata = KcmServiceSupport.ocrMetadata({
        workerVersion: result.workerVersion,
        runtime: result.runtime,
        processingMs: result.processingMs
      }, true);
      var persistedMetadata = persistDocumentMetadata(repo, documentId, requestId, metadata);
      var candidateInputs = KcmOcrRemoteWorkerClient.candidateInputs(result);
      var lock = acquireLock();
      var candidates;
      var repeatedCandidates = false;
      try {
        candidates = reuseCandidates(repo, documentId, candidateInputs);
        if (candidates) {
          repeatedCandidates = true;
          candidates = KcmOcrWorkflowService.reconcileCandidatesForRemote({ documentId: documentId, requestId: requestId });
        } else {
          candidates = KcmOcrWorkflowService.ingestCandidatesForRemote({
            documentId: documentId, requestId: requestId, candidates: candidateInputs
          });
        }
        assertProcessingState(repo, document);
      } finally {
        lock.releaseLock();
      }
      var evidenceInput = KcmOcrRemoteWorkerClient.evidenceBatch(result, {
        requestId: requestId,
        sessionId: String(document.sessionId),
        documentId: documentId,
        candidates: candidates
      });
      evidenceInput.ocrMetadata = persistedMetadata;
      var evidence;
      try {
        evidence = KcmOcrCropEvidenceService.storeBatch(evidenceInput);
      } catch (error) {
        if (!error || error.retryable !== true) throw error;
        assertProcessingState(repo, document);
        var pending = pendingSummary(repo, document, requestId, persistedMetadata, "ERROR_RECUPERABLE");
        auditOnce(identity, repo, {
          sessionId: String(document.sessionId), entityType: "OcrDocument", entityId: documentId,
          action: "REMOTE_OCR_PENDING", previousState: "OCR_EN_PROCESO", newState: "OCR_EN_PROCESO",
          reason: pending.evidenceStatus, requestId: requestId, evidenceId: String(document.evidenceId),
          ocrMetadata: persistedMetadata
        });
        return pending;
      }
      if (String(evidence.status) !== "COMPLETADO") {
        assertProcessingState(repo, document);
        return pendingSummary(repo, document, requestId, persistedMetadata, evidence.status);
      }
      ensureReviewState(repo, document);
      var evidenceMetadata = evidence.runtime ? KcmServiceSupport.ocrMetadata({
        workerVersion: evidence.workerVersion, runtime: evidence.runtime, processingMs: evidence.processingMs
      }, true) : persistedMetadata;
      if (repeatedCandidates) {
        auditOnce(identity, repo, {
          sessionId: String(document.sessionId), entityType: "OcrDocument", entityId: documentId,
          action: "REMOTE_OCR_RESUMED", previousState: "OCR_EN_PROCESO", newState: "OCR_EN_PROCESO",
          requestId: requestId, evidenceId: String(document.evidenceId), ocrMetadata: evidenceMetadata
        });
      }
      ensureCompletionAudit(identity, repo, document, requestId, evidenceMetadata);
      return {
        requestId: requestId,
        documentId: documentId,
        status: "REVISION_OCR",
        candidateCount: candidates.length,
        cropPairCount: Number(evidence.totalPairs),
        storedVariants: Number(evidence.storedVariants),
        workerVersion: evidenceMetadata.workerVersion,
        runtime: JSON.parse(evidenceMetadata.runtime),
        pipelineVersion: evidenceMetadata.pipelineVersion,
        processingMs: evidenceMetadata.processingMs,
        retryRequired: false,
        repeated: evidence.repeated === true && repeatedCandidates
      };
    } finally {
      if (typeof source !== "undefined" && source.bytes) source.bytes = [];
      releaseProcessingClaim(repo, documentId, claim.leaseId);
    }
  }

  return Object.freeze({ process: process });
}());
