var KcmOcrCropEvidenceService = (function () {
  "use strict";
  var MAX_PAIRS = 200;
  var COMPLETE = "COMPLETADO";
  var PENDING = "PENDIENTE";
  var RECOVERABLE_ERROR = "ERROR_RECUPERABLE";

  function batchLimit() {
    var limit = KcmConfig.maxReviewCropBatchBytes();
    if (!isFinite(limit) || limit < KcmConfig.maxReviewCropBytes() || limit > 25000000) KcmValidation.fail("INTERNAL_ERROR", "El limite del lote de recortes no es valido");
    return limit;
  }

  function variantInput(item, field) {
    var input = item && item[field];
    if (!input || typeof input !== "object") KcmValidation.fail("INVALID_INPUT", "Cada casilla requiere variante visual y procesada");
    var mimeType = KcmValidation.enumValue(input.mimeType, ["image/png", "image/jpeg"]);
    return KcmDriveEvidenceRepository.parseReviewCropDataUrl(input.dataUrl, mimeType);
  }

  function expectedCropId(candidate, digitIndex) {
    return "r" + String(candidate.rowIndex).padStart(2, "0") + "-d" + String(digitIndex + 1);
  }

  function normalizeItems(inputItems, candidatesById) {
    if (!Array.isArray(inputItems) || inputItems.length < 1 || inputItems.length > MAX_PAIRS) KcmValidation.fail("INVALID_ARRAY", "El lote debe contener entre uno y doscientos pares de recortes");
    var seen = Object.create(null);
    var totalBytes = 0;
    var normalized = inputItems.map(function (item) {
      if (!item || typeof item !== "object") KcmValidation.fail("INVALID_INPUT", "Par de recortes invalido");
      var candidateId = KcmValidation.identifier(item.candidateId, "candidateId");
      var candidate = candidatesById[candidateId];
      if (!candidate) KcmValidation.fail("NOT_FOUND", "Un candidato no pertenece al documento OCR");
      var digitIndex = KcmValidation.integer(item.digitIndex, 0, 4);
      var cropId = KcmValidation.identifier(item.cropId, "cropId");
      if (cropId !== expectedCropId(candidate, digitIndex)) KcmValidation.fail("INVALID_INPUT", "El identificador de recorte no coincide con su renglon y casilla");
      var pairKey = candidateId + "|" + digitIndex;
      if (seen[pairKey]) KcmValidation.fail("DUPLICATE", "El lote repite una casilla OCR");
      seen[pairKey] = true;
      var visual = variantInput(item, "visual");
      var processed = variantInput(item, "processed");
      totalBytes += visual.byteSize + processed.byteSize;
      return { candidate: candidate, candidateId: candidateId, cropId: cropId, digitIndex: digitIndex, visual: visual, processed: processed };
    }).sort(function (left, right) {
      return Number(left.candidate.rowIndex) - Number(right.candidate.rowIndex) || left.digitIndex - right.digitIndex;
    });
    if (totalBytes > batchLimit()) KcmValidation.fail("INVALID_FILE", "El lote de recortes excede el limite permitido");
    return { items: normalized, totalBytes: totalBytes };
  }

  function canonicalPayloadHash(sessionId, documentId, normalized, metadata) {
    var manifest = normalized.items.map(function (item) {
      return [item.candidateId, item.cropId, item.digitIndex, item.visual.mimeType, item.visual.sha256, item.processed.mimeType, item.processed.sha256].join("|");
    });
    return KcmDriveEvidenceRepository.stableId("payload", [
      sessionId, documentId, metadata.workerVersion, metadata.runtime,
      metadata.pipelineVersion
    ].concat(manifest).join("\n"));
  }

  function evidenceIdFor(sessionId, documentId, item, variant, parsed) {
    return KcmDriveEvidenceRepository.stableId("crop-evidence", [sessionId, documentId, item.candidateId, item.cropId, variant, parsed.sha256].join("|"));
  }

  function evidenceKind(variant) {
    return variant === "CROP_VISUAL" ? "OCR_CROP_VISUAL" : "OCR_CROP_PROCESSED";
  }

  function assertExistingEvidence(evidence, expected, batchesByRequest) {
    var evidenceRequestId = String(evidence.requestId || "");
    var sourceBatch = batchesByRequest[evidenceRequestId];
    if (String(evidence.evidenceId) !== expected.evidenceId ||
        String(evidence.sessionId) !== expected.sessionId || String(evidence.documentId) !== expected.documentId ||
        String(evidence.candidateId) !== expected.candidateId || String(evidence.cropId) !== expected.cropId ||
        String(evidence.variant) !== expected.variant || String(evidence.sha256) !== expected.parsed.sha256 ||
        String(evidence.kind) !== evidenceKind(expected.variant) || String(evidence.status) !== "LISTA" ||
        String(evidence.mimeType) !== expected.parsed.mimeType || Number(evidence.byteSize) !== expected.parsed.byteSize ||
        String(evidence.version) !== KcmConfig.CONTRACT_VERSION || !KcmServiceSupport.asBoolean(evidence.immutable) ||
        !/^[A-Za-z0-9_-]{1,200}$/.test(String(evidence.driveFileId || "")) ||
        !/^[A-Za-z0-9_-]{1,100}$/.test(evidenceRequestId) || !sourceBatch ||
        String(sourceBatch.sessionId) !== expected.sessionId || String(sourceBatch.documentId) !== expected.documentId ||
        (evidenceRequestId !== expected.requestId && String(sourceBatch.status) !== COMPLETE)) {
      KcmValidation.fail("CONFLICT", "Una evidencia existente no coincide con el manifiesto del recorte");
    }
    return evidence;
  }

  function indexedRows(repo, sheetName, keyField, message) {
    var result = Object.create(null);
    repo.list(sheetName).forEach(function (row) {
      var key = String(row[keyField] || "");
      if (!key || result[key]) KcmValidation.fail("CONFLICT", message);
      result[key] = row;
    });
    return result;
  }

  function assertReferenceMatches(item, references, evidenceIds, required) {
    var reference = references.find(function (row) { return row.digitIndex === item.digitIndex; });
    if (!reference) {
      if (required) KcmValidation.fail("CONFLICT", "El replay OCR perdio una referencia de evidencia");
      return;
    }
    if (reference.cropId !== item.cropId ||
        reference.visualEvidenceId !== evidenceIds[item.candidateId + "|" + item.digitIndex + "|CROP_VISUAL"] ||
        reference.processedEvidenceId !== evidenceIds[item.candidateId + "|" + item.digitIndex + "|CROP_PROCESSED"]) {
      KcmValidation.fail("CONFLICT", "Una referencia existente no coincide con la evidencia canonica del recorte");
    }
  }

  function validateCompletedReplay(repo, normalized, sessionId, documentId, requestId, batch) {
    if (Number(batch.totalPairs) !== normalized.items.length || Number(batch.storedVariants) !== normalized.items.length * 2) {
      KcmValidation.fail("CONFLICT", "El lote completado no coincide con su manifiesto durable");
    }
    var evidenceById = indexedRows(repo, KcmConfig.SHEETS.EVIDENCE, "evidenceId", "Las evidencias OCR no conservan IDs unicos");
    var batchesByRequest = indexedRows(repo, KcmConfig.SHEETS.OCR_CROP_BATCHES, "requestId", "Los lotes OCR no conservan requestId unicos");
    var currentCandidates = Object.create(null);
    repo.list(KcmConfig.SHEETS.OCR_RESULTS, function (row) { return String(row.documentId) === documentId; }).forEach(function (candidate) {
      var candidateId = String(candidate.candidateId || "");
      if (!candidateId || currentCandidates[candidateId]) KcmValidation.fail("CONFLICT", "Los candidatos OCR no conservan IDs unicos");
      currentCandidates[candidateId] = candidate;
    });
    normalized.items.forEach(function (item) {
      var candidate = currentCandidates[item.candidateId];
      if (!candidate || Number(candidate.rowIndex) !== Number(item.candidate.rowIndex)) {
        KcmValidation.fail("CONFLICT", "El candidato del replay OCR ya no conserva su identidad");
      }
      var references = existingReferences(candidate);
      var evidenceIds = Object.create(null);
      [{ name: "CROP_VISUAL", parsed: item.visual }, { name: "CROP_PROCESSED", parsed: item.processed }].forEach(function (variant) {
        var evidenceId = evidenceIdFor(sessionId, documentId, item, variant.name, variant.parsed);
        evidenceIds[item.candidateId + "|" + item.digitIndex + "|" + variant.name] = evidenceId;
        var expected = {
          evidenceId: evidenceId, sessionId: sessionId, documentId: documentId,
          candidateId: item.candidateId, cropId: item.cropId, variant: variant.name,
          parsed: variant.parsed, requestId: requestId
        };
        if (!evidenceById[evidenceId]) KcmValidation.fail("CONFLICT", "El replay OCR no conserva toda su evidencia");
        assertExistingEvidence(evidenceById[evidenceId], expected, batchesByRequest);
      });
      assertReferenceMatches(item, references, evidenceIds, true);
    });
  }

  function existingReferences(candidate) {
    var value = candidate.cropEvidenceRefs;
    if (value === undefined || value === null || value === "") return [];
    var parsed;
    if (Array.isArray(value)) parsed = value;
    else {
      try { parsed = JSON.parse(String(value)); }
      catch (error) { KcmValidation.fail("CONFLICT", "Las referencias existentes de recorte estan corruptas"); }
    }
    if (!Array.isArray(parsed) || parsed.length > 5) KcmValidation.fail("CONFLICT", "Las referencias existentes de recorte son invalidas");
    var seen = Object.create(null);
    return parsed.map(function (reference) {
      if (!reference || typeof reference !== "object") KcmValidation.fail("CONFLICT", "Una referencia existente de recorte es invalida");
      var digitIndex = Number(reference.digitIndex);
      var cropId = String(reference.cropId || "");
      var visualEvidenceId = String(reference.visualEvidenceId || "");
      var processedEvidenceId = String(reference.processedEvidenceId || "");
      if (!Number.isInteger(digitIndex) || digitIndex < 0 || digitIndex > 4 || seen[digitIndex] ||
          cropId !== expectedCropId(candidate, digitIndex) ||
          !/^[A-Za-z0-9_-]{1,100}$/.test(visualEvidenceId) ||
          !/^[A-Za-z0-9_-]{1,100}$/.test(processedEvidenceId) || visualEvidenceId === processedEvidenceId) {
        KcmValidation.fail("CONFLICT", "Una referencia existente de recorte no conserva su integridad");
      }
      seen[digitIndex] = true;
      return {
        cropId: cropId, digitIndex: digitIndex,
        visualEvidenceId: visualEvidenceId,
        processedEvidenceId: processedEvidenceId
      };
    });
  }

  function candidateUpdates(items, evidenceIds, referencesByCandidateId) {
    var byCandidate = Object.create(null);
    items.forEach(function (item) {
      if (!byCandidate[item.candidateId]) {
        var byDigit = Object.create(null);
        referencesByCandidateId[item.candidateId].forEach(function (reference) { byDigit[reference.digitIndex] = reference; });
        byCandidate[item.candidateId] = { candidate: item.candidate, byDigit: byDigit };
      }
      byCandidate[item.candidateId].byDigit[item.digitIndex] = {
        cropId: item.cropId, digitIndex: item.digitIndex,
        visualEvidenceId: evidenceIds[item.candidateId + "|" + item.digitIndex + "|CROP_VISUAL"],
        processedEvidenceId: evidenceIds[item.candidateId + "|" + item.digitIndex + "|CROP_PROCESSED"]
      };
    });
    return Object.keys(byCandidate).map(function (candidateId) {
      var references = Object.keys(byCandidate[candidateId].byDigit).map(function (digit) { return byCandidate[candidateId].byDigit[digit]; })
        .sort(function (left, right) { return left.digitIndex - right.digitIndex; });
      if (references.length > 5) KcmValidation.fail("CONFLICT", "El candidato contiene demasiadas referencias de recorte");
      return { candidateId: candidateId, cropEvidenceRefs: KcmValidation.json(references, 2500) };
    });
  }

  function summary(batch, repeated) {
    var metadata = KcmServiceSupport.ocrMetadata({
      workerVersion: batch.workerVersion,
      runtime: batch.runtime,
      processingMs: batch.processingMs
    }, false);
    var completedChunks = KcmServiceSupport.parseArray(batch.completedChunks);
    return {
      batchId: String(batch.batchId), requestId: String(batch.requestId),
      sessionId: String(batch.sessionId), documentId: String(batch.documentId),
      payloadHash: String(batch.payloadHash), status: String(batch.status),
      totalPairs: Number(batch.totalPairs), storedVariants: Number(batch.storedVariants),
      linkedCandidates: Number(batch.linkedCandidates), repeated: repeated === true,
      chunkSize: Number(batch.chunkSize || 0), chunkCount: Number(batch.chunkCount || 0),
      completedChunks: completedChunks.length,
      workerVersion: metadata.workerVersion,
      runtime: metadata.runtime ? JSON.parse(metadata.runtime) : null,
      pipelineVersion: metadata.pipelineVersion,
      processingMs: metadata.processingMs === "" ? 0 : Number(metadata.processingMs),
      version: String(batch.version)
    };
  }

  function chunkConfiguration(totalPairs) {
    var chunkSize = Number(KcmConfig.reviewCropChunkPairs());
    var budgetMs = Number(KcmConfig.reviewCropExecutionBudgetMs());
    if (!Number.isInteger(chunkSize) || chunkSize < 5 || chunkSize > 40 || chunkSize % 5 !== 0) {
      KcmValidation.fail("INTERNAL_ERROR", "El tamano de fragmento OCR no es valido");
    }
    if (!Number.isInteger(budgetMs) || budgetMs < 30000 || budgetMs > 300000) {
      KcmValidation.fail("INTERNAL_ERROR", "El presupuesto de ejecucion OCR no es valido");
    }
    return { chunkSize: chunkSize, chunkCount: Math.ceil(totalPairs / chunkSize), budgetMs: budgetMs };
  }

  function chunksOf(items, chunkSize) {
    var chunks = [];
    for (var offset = 0; offset < items.length; offset += chunkSize) chunks.push(items.slice(offset, offset + chunkSize));
    return chunks;
  }

  function completedChunkIndexes(value, chunkCount) {
    var parsed = KcmServiceSupport.parseArray(value);
    if (!Array.isArray(parsed)) KcmValidation.fail("CONFLICT", "El progreso del lote OCR esta corrupto");
    var seen = Object.create(null);
    return parsed.map(function (value) {
      var index = Number(value);
      if (!Number.isInteger(index) || index < 0 || index >= chunkCount || seen[index]) {
        KcmValidation.fail("CONFLICT", "El progreso del lote OCR esta corrupto");
      }
      seen[index] = true;
      return index;
    }).sort(function (left, right) { return left - right; });
  }

  function progressStats(chunks, completed) {
    var candidates = Object.create(null);
    var pairCount = 0;
    completed.forEach(function (chunkIndex) {
      chunks[chunkIndex].forEach(function (item) {
        pairCount += 1;
        candidates[item.candidateId] = true;
      });
    });
    return { storedVariants: pairCount * 2, linkedCandidates: Object.keys(candidates).length };
  }

  function acquireLock() {
    if (typeof KcmScriptLock !== "undefined") {
      return KcmScriptLock.acquire(30000, "Existe otro fragmento de recortes en proceso; reintente");
    }
    var lock = LockService.getScriptLock();
    if (!lock.tryLock(30000)) {
      var busy = new Error("Existe otro fragmento de recortes en proceso; reintente");
      busy.code = "CONFLICT"; busy.retryable = true; throw busy;
    }
    return lock;
  }

  function updateBatchSafe(repo, batchId, patch) {
    try {
      var current = repo.findOne(KcmConfig.SHEETS.OCR_CROP_BATCHES, function (row) { return String(row.batchId) === String(batchId); });
      if (!current) return null;
      var intended = Object.assign({}, current, patch);
      delete intended.__rowNumber;
      return repo.replaceOne(KcmConfig.SHEETS.OCR_CROP_BATCHES, "batchId", intended);
    }
    catch (ignored) { return null; }
  }

  function replaceBatch(repo, batch, patch) {
    var intended = Object.assign({}, batch, patch);
    delete intended.__rowNumber;
    return repo.replaceOne(KcmConfig.SHEETS.OCR_CROP_BATCHES, "batchId", intended);
  }

  function auditSafe(identity, input) {
    try { KcmServiceSupport.audit(identity, input); } catch (ignored) {  }
  }

  function auditOnce(identity, repo, input) {
    var lock = acquireLock();
    try {
      var matches = repo.list(KcmConfig.SHEETS.AUDIT, function (row) {
        return String(row.sessionId || "") === String(input.sessionId || "") &&
          String(row.entityType || "") === String(input.entityType || "") &&
          String(row.entityId || "") === String(input.entityId || "") &&
          String(row.action || "") === String(input.action || "") &&
          String(row.requestId || "") === String(input.requestId || "") &&
          String(row.reason || "") === String(input.reason || "");
      });
      if (matches.length > 1) KcmValidation.fail("CONFLICT", "La auditoria de recortes contiene eventos duplicados");
      return matches.length ? matches[0] : KcmServiceSupport.audit(identity, input);
    } finally {
      lock.releaseLock();
    }
  }

  function ensureCompletedAudit(identity, repo, batch, document, metadata) {
    return auditOnce(identity, repo, {
      sessionId: String(batch.sessionId), entityType: "OcrCropBatch", entityId: String(batch.batchId),
      action: "OCR_CROP_BATCH_COMPLETED", previousState: PENDING, newState: COMPLETE,
      reason: "ALL_CHUNKS", requestId: String(batch.requestId), evidenceId: String(document.evidenceId),
      ocrMetadata: metadata
    });
  }

  function storeBatch(input) {
    var identity = KcmAuth.requireRoles(["CAPACITACION", "ADMINISTRADOR"]);
    var requestId = KcmValidation.identifier(input.requestId, "requestId");
    var sessionId = KcmValidation.identifier(input.sessionId, "sessionId");
    var documentId = KcmValidation.identifier(input.documentId, "documentId");
    var repo = KcmServiceSupport.repository();
    var session = KcmServiceSupport.session(sessionId);
    var document = repo.findOne(KcmConfig.SHEETS.OCR_DOCUMENTS, function (row) { return String(row.documentId) === documentId; });
    if (!document || String(document.sessionId) !== sessionId) KcmValidation.fail("NOT_FOUND", "El documento OCR no pertenece a la sesion");
    if (["OCR_EN_PROCESO", "REVISION_OCR"].indexOf(String(document.status)) === -1 || ["OCR_EN_PROCESO", "REVISION_OCR"].indexOf(String(session.status)) === -1) KcmValidation.fail("INVALID_STATE", "El documento OCR no admite recortes de revision");
    var candidates = repo.list(KcmConfig.SHEETS.OCR_RESULTS, function (row) { return String(row.documentId) === documentId; });
    var candidatesById = Object.create(null);
    candidates.forEach(function (candidate) { candidatesById[String(candidate.candidateId)] = candidate; });
    var normalized = normalizeItems(input.items, candidatesById);
    var validatedCandidates = Object.create(null);
    normalized.items.forEach(function (item) {
      if (!validatedCandidates[item.candidateId]) {
        existingReferences(item.candidate);
        validatedCandidates[item.candidateId] = true;
      }
    });
    var metadata = KcmServiceSupport.ocrMetadata(input.ocrMetadata, false);
    var chunkConfig = chunkConfiguration(normalized.items.length);
    var chunks = chunksOf(normalized.items, chunkConfig.chunkSize);
    var payloadHash = canonicalPayloadHash(sessionId, documentId, normalized, metadata);
    var batchId = KcmDriveEvidenceRepository.stableId("crop-batch", sessionId + "|" + documentId + "|" + requestId);
    var startedAt = new Date().getTime();
    var initialLock = acquireLock();
    var initialBatch;
    try {
      var existingBatch = repo.findOne(KcmConfig.SHEETS.OCR_CROP_BATCHES, function (row) { return String(row.requestId) === requestId; });
      if (existingBatch && (String(existingBatch.sessionId) !== sessionId || String(existingBatch.documentId) !== documentId || String(existingBatch.payloadHash) !== payloadHash)) KcmValidation.fail("CONFLICT", "El requestId ya fue usado con otro manifiesto");
      if (existingBatch && String(existingBatch.status) === COMPLETE) {
        validateCompletedReplay(repo, normalized, sessionId, documentId, requestId, existingBatch);
        ensureCompletedAudit(identity, repo, existingBatch, document, metadata);
        auditOnce(identity, repo, { sessionId: sessionId, entityType: "OcrCropBatch", entityId: existingBatch.batchId, action: "OCR_CROP_BATCH_REPLAYED", previousState: COMPLETE, newState: COMPLETE, requestId: requestId, evidenceId: document.evidenceId, ocrMetadata: metadata });
        return summary(existingBatch, true);
      }
      var timestamp = KcmServiceSupport.nowIso();
      var batch = existingBatch || {
        batchId: batchId, requestId: requestId, sessionId: sessionId, documentId: documentId,
        payloadHash: payloadHash, status: PENDING, totalPairs: normalized.items.length,
        storedVariants: 0, linkedCandidates: 0, errorCode: "", createdBy: identity.actor,
        createdAt: timestamp, updatedAt: timestamp, version: KcmConfig.CONTRACT_VERSION,
        chunkSize: chunkConfig.chunkSize, chunkCount: chunkConfig.chunkCount,
        completedChunks: "[]", workerVersion: metadata.workerVersion, runtime: metadata.runtime,
        pipelineVersion: metadata.pipelineVersion, processingMs: metadata.processingMs
      };
      if (!existingBatch) repo.insertMany(KcmConfig.SHEETS.OCR_CROP_BATCHES, [batch]);
      else {
        var storedChunks = completedChunkIndexes(existingBatch.completedChunks, chunkConfig.chunkCount);
        if (Number(existingBatch.chunkSize) !== chunkConfig.chunkSize || Number(existingBatch.chunkCount) !== chunkConfig.chunkCount) {
          KcmValidation.fail("CONFLICT", "La configuracion de fragmentos cambio durante el lote");
        }
        batch = replaceBatch(repo, batch, {
          status: PENDING, errorCode: "", completedChunks: JSON.stringify(storedChunks), updatedAt: timestamp
        });
      }
      initialBatch = batch;
      auditSafe(identity, { sessionId: sessionId, entityType: "OcrCropBatch", entityId: batch.batchId, action: existingBatch ? "OCR_CROP_BATCH_RESUMED" : "OCR_CROP_BATCH_STARTED", previousState: existingBatch ? existingBatch.status : "", newState: PENDING, requestId: requestId, evidenceId: document.evidenceId, ocrMetadata: metadata });
    } finally {
      initialLock.releaseLock();
    }

    for (var chunkIndex = 0; chunkIndex < chunks.length; chunkIndex += 1) {
      if (new Date().getTime() - startedAt >= chunkConfig.budgetMs) {
        auditSafe(identity, { sessionId: sessionId, entityType: "OcrCropBatch", entityId: batchId, action: "OCR_CROP_BATCH_PAUSED", previousState: PENDING, newState: PENDING, reason: "EXECUTION_BUDGET", requestId: requestId, evidenceId: document.evidenceId, ocrMetadata: metadata });
        var paused = new Error("El lote de recortes quedo pendiente; reintente con el mismo requestId");
        paused.code = "CONFLICT"; paused.retryable = true; throw paused;
      }
      var chunkLock = acquireLock();
      try {
        var currentBatch = repo.findOne(KcmConfig.SHEETS.OCR_CROP_BATCHES, function (row) { return String(row.batchId) === batchId; });
        if (!currentBatch || String(currentBatch.payloadHash) !== payloadHash) KcmValidation.fail("CONFLICT", "El journal del lote OCR no coincide");
        if (String(currentBatch.status) === COMPLETE) continue;
        var completedChunks = completedChunkIndexes(currentBatch.completedChunks, chunkConfig.chunkCount);
        if (completedChunks.indexOf(chunkIndex) !== -1) continue;
        var currentCandidates = Object.create(null);
        repo.list(KcmConfig.SHEETS.OCR_RESULTS, function (row) { return String(row.documentId) === documentId; }).forEach(function (candidate) {
          currentCandidates[String(candidate.candidateId)] = candidate;
        });
        var chunkItems = chunks[chunkIndex].map(function (item) {
          var candidate = currentCandidates[item.candidateId];
          if (!candidate) KcmValidation.fail("NOT_FOUND", "Un candidato OCR ya no existe");
          return Object.assign({}, item, { candidate: candidate });
        });
        var referencesByCandidateId = Object.create(null);
        chunkItems.forEach(function (item) {
          if (!Object.prototype.hasOwnProperty.call(referencesByCandidateId, item.candidateId)) {
            referencesByCandidateId[item.candidateId] = existingReferences(item.candidate);
          }
        });
        var evidenceById = indexedRows(repo, KcmConfig.SHEETS.EVIDENCE, "evidenceId", "Las evidencias OCR no conservan IDs unicos");
        var batchesByRequest = indexedRows(repo, KcmConfig.SHEETS.OCR_CROP_BATCHES, "requestId", "Los lotes OCR no conservan requestId unicos");
        var evidenceIds = Object.create(null);
        var newEvidence = [];
        var chunkTimestamp = KcmServiceSupport.nowIso();
        chunkItems.forEach(function (item) {
          [{ name: "CROP_VISUAL", parsed: item.visual }, { name: "CROP_PROCESSED", parsed: item.processed }].forEach(function (variant) {
            var evidenceId = evidenceIdFor(sessionId, documentId, item, variant.name, variant.parsed);
            var key = item.candidateId + "|" + item.digitIndex + "|" + variant.name;
            evidenceIds[key] = evidenceId;
            var expected = {
              evidenceId: evidenceId, sessionId: sessionId, documentId: documentId,
              candidateId: item.candidateId, cropId: item.cropId, variant: variant.name,
              parsed: variant.parsed, requestId: requestId
            };
            if (evidenceById[evidenceId]) { assertExistingEvidence(evidenceById[evidenceId], expected, batchesByRequest); return; }
            var stored = KcmDriveEvidenceRepository.saveReviewCrop(variant.parsed, {
              sessionId: sessionId, documentId: documentId, candidateId: item.candidateId,
              cropId: item.cropId, digitIndex: item.digitIndex, variant: variant.name, requestId: requestId
            });
            newEvidence.push({
              evidenceId: evidenceId, sessionId: sessionId, kind: evidenceKind(variant.name),
              driveFileId: stored.driveFileId, sha256: variant.parsed.sha256,
              mimeType: variant.parsed.mimeType, immutable: true, createdBy: identity.actor,
              createdAt: chunkTimestamp, version: KcmConfig.CONTRACT_VERSION,
              documentId: documentId, candidateId: item.candidateId, cropId: item.cropId,
              variant: variant.name, byteSize: variant.parsed.byteSize,
              requestId: requestId, status: "LISTA"
            });
          });
        });
        chunkItems.forEach(function (item) {
          assertReferenceMatches(item, referencesByCandidateId[item.candidateId], evidenceIds, false);
        });
        repo.insertMany(KcmConfig.SHEETS.EVIDENCE, newEvidence);
        var updates = candidateUpdates(chunkItems, evidenceIds, referencesByCandidateId);
        repo.updateMany(KcmConfig.SHEETS.OCR_RESULTS, "candidateId", updates);
        completedChunks.push(chunkIndex);
        completedChunks.sort(function (left, right) { return left - right; });
        var stats = progressStats(chunks, completedChunks);
        var nextStatus = completedChunks.length === chunkConfig.chunkCount ? COMPLETE : PENDING;
        currentBatch = replaceBatch(repo, currentBatch, {
          status: nextStatus, storedVariants: stats.storedVariants,
          linkedCandidates: stats.linkedCandidates, completedChunks: JSON.stringify(completedChunks),
          errorCode: "", updatedAt: KcmServiceSupport.nowIso()
        });
        if (nextStatus !== COMPLETE) {
          auditSafe(identity, { sessionId: sessionId, entityType: "OcrCropBatch", entityId: batchId, action: "OCR_CROP_CHUNK_COMPLETED", previousState: PENDING, newState: nextStatus, reason: "CHUNK_" + chunkIndex, requestId: requestId, evidenceId: document.evidenceId, ocrMetadata: metadata });
        }
      } catch (error) {
        var safe = KcmValidation.safeError(error);
        updateBatchSafe(repo, batchId, { status: RECOVERABLE_ERROR, errorCode: safe.code, updatedAt: KcmServiceSupport.nowIso() });
        auditSafe(identity, { sessionId: sessionId, entityType: "OcrCropBatch", entityId: batchId, action: "OCR_CROP_CHUNK_FAILED", previousState: PENDING, newState: RECOVERABLE_ERROR, reason: safe.code + "_CHUNK_" + chunkIndex, requestId: requestId, evidenceId: document.evidenceId, ocrMetadata: metadata });
        var recoverable = new Error("El fragmento de recortes quedo recuperable; reintente con el mismo requestId");
        recoverable.code = "CONFLICT"; recoverable.retryable = true; throw recoverable;
      } finally {
        chunkLock.releaseLock();
      }
    }
    var completedBatch = repo.findOne(KcmConfig.SHEETS.OCR_CROP_BATCHES, function (row) { return String(row.batchId) === batchId; });
    if (!completedBatch || String(completedBatch.status) !== COMPLETE) {
      var pending = new Error("El lote de recortes permanece pendiente; reintente con el mismo requestId");
      pending.code = "CONFLICT"; pending.retryable = true; throw pending;
    }
    ensureCompletedAudit(identity, repo, completedBatch, document, metadata);
    return summary(completedBatch, false);
  }

  return Object.freeze({ storeBatch: storeBatch });
}());
