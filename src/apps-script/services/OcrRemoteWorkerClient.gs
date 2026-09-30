var KcmOcrRemoteWorkerClient = (function () {
  "use strict";

  var CONTRACT_VERSION = "1.0.0";
  var EXPECTED_ROWS = 40;
  var EXPECTED_SLOTS = 5;
  var TECHNICAL_FLAGS = Object.freeze({
    PAGE_ALIGNMENT_REVIEW_REQUIRED: true,
    ROW_NOT_DETECTED: true,
    BLANK_ROW: true,
    BLANK_DIGIT: true,
    LOW_CONTRAST_IMAGE: true,
    PAGE_BOUNDARY_NOT_DISTINCT: true,
    FULL_FRAME_FALLBACK: true
  });
  var RETRYABLE_HTTP = Object.freeze({ 408: true, 425: true, 429: true, 500: true, 502: true, 503: true, 504: true });
  var ROOT_KEYS = Object.freeze([
    "contractVersion", "requestId", "documentId", "sourceSha256", "status",
    "workerVersion", "runtime", "processingMs", "rows", "cropPairs"
  ]);

  function fail(code, message, retryable) {
    var error = new Error(message);
    error.code = code;
    error.retryable = Boolean(retryable);
    throw error;
  }

  function property(name, fallback) {
    return KcmConfig.property(name, fallback);
  }

  function integerProperty(name, fallback, minimum, maximum) {
    var value = Number(property(name, String(fallback)));
    if (!Number.isInteger(value) || value < minimum || value > maximum) {
      fail("INTERNAL_ERROR", "La configuracion del worker OCR no es valida", false);
    }
    return value;
  }

  function endpointHost(endpoint) {
    if (!/^[\x21-\x7E]{1,500}$/.test(String(endpoint))) {
      fail("INTERNAL_ERROR", "El endpoint del worker OCR no es valido", false);
    }
    var match = String(endpoint).match(/^https:\/\/([^\/?#:]+)(?::(\d{1,5}))?(\/[^?#]*)?$/i);
    if (!match || (match[2] && match[2] !== "443")) {
      fail("INTERNAL_ERROR", "El endpoint del worker OCR no es valido", false);
    }
    var host = String(match[1]).toLowerCase();
    if (!/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/.test(host) || host.indexOf("..") !== -1 || host.indexOf(".") === -1) {
      fail("INTERNAL_ERROR", "El endpoint del worker OCR no es valido", false);
    }
    return host;
  }

  function configuration() {
    if (String(property("KCM_OCR_WORKER_ENABLED", "false")).toLowerCase() !== "true") {
      fail("INTERNAL_ERROR", "El worker OCR remoto no esta habilitado", false);
    }
    var endpoint = String(property("KCM_OCR_WORKER_ENDPOINT", ""));
    var host = endpointHost(endpoint);
    var allowedHosts = String(property("KCM_OCR_WORKER_ALLOWED_HOSTS", "")).split(",").map(function (value) {
      return value.trim().toLowerCase();
    }).filter(Boolean);
    if (!allowedHosts.length || allowedHosts.indexOf(host) === -1) {
      fail("INTERNAL_ERROR", "El endpoint del worker OCR no esta autorizado", false);
    }
    return {
      endpoint: endpoint,
      maxRequestBytes: integerProperty("KCM_OCR_WORKER_MAX_REQUEST_BYTES", 15728640, 4096, 20971520),
      maxResponseBytes: integerProperty("KCM_OCR_WORKER_MAX_RESPONSE_BYTES", 4194304, 65536, 16777216),
      maxAttempts: integerProperty("KCM_OCR_WORKER_MAX_ATTEMPTS", 2, 1, 3),
      backoffMs: integerProperty("KCM_OCR_WORKER_BACKOFF_MS", 500, 0, 5000),
      deadlineMs: integerProperty("KCM_OCR_WORKER_DEADLINE_MS", 60000, 1000, 120000)
    };
  }

  function bytes(value, maximum) {
    if (!value || typeof value.length !== "number" || value.length < 1 || value.length > maximum) {
      fail("INVALID_FILE", "El documento OCR no es valido", false);
    }
    var result = [];
    for (var index = 0; index < value.length; index += 1) {
      var byte = Number(value[index]);
      if (!Number.isInteger(byte) || byte < -128 || byte > 255) {
        fail("INVALID_FILE", "El documento OCR no es valido", false);
      }
      result.push(byte > 127 ? byte - 256 : byte);
    }
    return result;
  }

  function bytesToHex(value) {
    return value.map(function (byte) {
      var unsigned = byte < 0 ? byte + 256 : byte;
      return ("0" + unsigned.toString(16)).slice(-2);
    }).join("");
  }

  function sha256(value) {
    return bytesToHex(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, value));
  }

  function identifier(value, field) {
    var normalized = String(value || "");
    if (!/^[A-Za-z0-9_-]{1,100}$/.test(normalized)) fail("INVALID_IDENTIFIER", "Identificador OCR invalido", false);
    return normalized;
  }

  function sourceHash(value) {
    var normalized = String(value || "").toLowerCase();
    if (!/^[a-f0-9]{64}$/.test(normalized)) fail("INVALID_INPUT", "Hash OCR invalido", false);
    return normalized;
  }

  function templateVersion(value) {
    var normalized = String(value || "");
    if (!/^[A-Za-z0-9_.-]{1,40}$/.test(normalized)) fail("INVALID_INPUT", "Version de plantilla invalida", false);
    return normalized;
  }

  function mimeType(value) {
    var normalized = String(value || "").toLowerCase();
    if (["image/jpeg", "image/png", "application/pdf"].indexOf(normalized) === -1) {
      fail("INVALID_FILE", "El tipo del documento OCR no es valido", false);
    }
    return normalized;
  }

  function makeRequest(input, config) {
    if (!input || typeof input !== "object") fail("INVALID_INPUT", "Solicitud OCR invalida", false);
    var requestId = identifier(input.requestId, "requestId");
    var documentId = identifier(input.documentId, "documentId");
    var expectedHash = sourceHash(input.sourceSha256);
    var maximumSourceBytes = Number(KcmConfig.maxUploadBytes());
    if (!Number.isInteger(maximumSourceBytes) || maximumSourceBytes < 1024 || maximumSourceBytes > 20971520) {
      fail("INTERNAL_ERROR", "La configuracion del documento OCR no es valida", false);
    }
    var sourceBytes = bytes(input.sourceBytes, maximumSourceBytes);
    if (sha256(sourceBytes) !== expectedHash) fail("CONFLICT", "El documento OCR no coincide con su hash", false);
    var payload = {
      contractVersion: CONTRACT_VERSION,
      requestId: requestId,
      document: {
        documentId: documentId,
        sha256: expectedHash,
        mimeType: mimeType(input.mimeType),
        contentBase64: Utilities.base64Encode(sourceBytes)
      },
      template: {
        version: templateVersion(input.templateVersion),
        expectedRows: EXPECTED_ROWS,
        digitsPerRow: EXPECTED_SLOTS
      },
      recognition: { mode: "DIGIT_BOXES_ONLY", alphabet: "0123456789" }
    };
    var body = JSON.stringify(payload);
    var bodyBytes = Utilities.newBlob(body, "application/json").getBytes();
    if (bodyBytes.length > config.maxRequestBytes) fail("INVALID_PAYLOAD", "La solicitud OCR excede el limite permitido", false);
    return {
      body: body,
      requestId: requestId,
      documentId: documentId,
      sourceSha256: expectedHash
    };
  }

  function headersFor(request, authProvider) {
    if (!authProvider || typeof authProvider.headers !== "function") {
      fail("INTERNAL_ERROR", "La autenticacion del worker OCR no es valida", false);
    }
    var headers = {
      "X-KCM-Contract-Version": CONTRACT_VERSION,
      "X-KCM-Request-Id": request.requestId
    };
    var authHeaders;
    try {
      authHeaders = authProvider.headers({
        contractVersion: CONTRACT_VERSION,
        requestId: request.requestId,
        body: request.body
      });
    } catch (ignored) {
      fail("INTERNAL_ERROR", "La autenticacion del worker OCR no esta disponible", false);
    }
    if (!authHeaders || typeof authHeaders !== "object" || Array.isArray(authHeaders)) {
      fail("INTERNAL_ERROR", "La autenticacion del worker OCR no es valida", false);
    }
    var seenHeaders = Object.create(null);
    Object.keys(headers).forEach(function (key) { seenHeaders[String(key).toLowerCase()] = true; });
    Object.keys(authHeaders).forEach(function (key) {
      var normalizedKey = String(key);
      var lowerKey = normalizedKey.toLowerCase();
      var value = String(authHeaders[key] || "");
      if (!/^[A-Za-z0-9-]{1,60}$/.test(normalizedKey) || ["content-type", "content-length", "host"].indexOf(lowerKey) !== -1 ||
          !value || value.length > 2048 || /[\u0000-\u001F\u007F]/.test(value) || seenHeaders[lowerKey]) {
        fail("INTERNAL_ERROR", "La autenticacion del worker OCR no es valida", false);
      }
      seenHeaders[lowerKey] = true;
      headers[normalizedKey] = value;
    });
    return headers;
  }

  function responseHeader(response, name) {
    var headers = response.getAllHeaders ? response.getAllHeaders() : response.getHeaders();
    var expected = String(name).toLowerCase();
    var found = "";
    Object.keys(headers || {}).some(function (key) {
      if (String(key).toLowerCase() !== expected) return false;
      found = Array.isArray(headers[key]) ? String(headers[key][0] || "") : String(headers[key] || "");
      return true;
    });
    return found;
  }

  function onlyKeys(value, allowed) {
    var lookup = Object.create(null);
    allowed.forEach(function (key) { lookup[key] = true; });
    Object.keys(value).forEach(function (key) {
      if (!lookup[key]) fail("CONFLICT", "El worker OCR devolvio una respuesta invalida", false);
    });
  }

  function confidence(value) {
    if (typeof value !== "number" || !isFinite(value) || value < 0 || value > 1) {
      fail("CONFLICT", "El worker OCR devolvio una respuesta invalida", false);
    }
    return value;
  }

  function runtimeVersion(value) {
    if (typeof value !== "string" || !/^[0-9]+(?:\.[0-9]+){1,3}(?:[-+._a-z0-9]*)?$/i.test(value)) {
      fail("CONFLICT", "El worker OCR devolvio metadatos de runtime invalidos", false);
    }
    return value;
  }

  function runtimeMetadata(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      fail("CONFLICT", "El worker OCR devolvio metadatos de runtime invalidos", false);
    }
    onlyKeys(value, [
      "nodeVersion", "ocrEngineName", "ocrEngineVersion", "pdfInfoVersion",
      "pdfToPpmVersion", "imagePipelineVersion", "containerBuildId", "pdfToolsUsed"
    ]);
    if (value.ocrEngineName !== "tesseract" || typeof value.imagePipelineVersion !== "string" ||
        !/^[A-Za-z0-9][A-Za-z0-9._-]{0,39}$/.test(value.imagePipelineVersion) ||
        typeof value.containerBuildId !== "string" ||
        !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$/.test(value.containerBuildId) ||
        typeof value.pdfToolsUsed !== "boolean") {
      fail("CONFLICT", "El worker OCR devolvio metadatos de runtime invalidos", false);
    }
    return Object.freeze({
      nodeVersion: runtimeVersion(value.nodeVersion),
      ocrEngineName: "tesseract",
      ocrEngineVersion: runtimeVersion(value.ocrEngineVersion),
      pdfInfoVersion: runtimeVersion(value.pdfInfoVersion),
      pdfToPpmVersion: runtimeVersion(value.pdfToPpmVersion),
      imagePipelineVersion: value.imagePipelineVersion,
      containerBuildId: value.containerBuildId,
      pdfToolsUsed: value.pdfToolsUsed
    });
  }

  function flags(value) {
    if (value === undefined) return [];
    if (!Array.isArray(value) || value.length > 20) fail("CONFLICT", "El worker OCR devolvio una respuesta invalida", false);
    var seen = Object.create(null);
    return value.map(function (item) {
      if (typeof item !== "string") fail("CONFLICT", "El worker OCR devolvio una respuesta invalida", false);
      var flag = item;
      if (!/^[A-Z0-9_]{1,40}$/.test(flag) || !TECHNICAL_FLAGS[flag] || seen[flag]) {
        fail("CONFLICT", "El worker OCR devolvio una respuesta invalida", false);
      }
      seen[flag] = true;
      return flag;
    });
  }

  function normalizeRow(row, seenRows) {
    if (!row || typeof row !== "object" || Array.isArray(row)) fail("CONFLICT", "El worker OCR devolvio una respuesta invalida", false);
    onlyKeys(row, ["rowIndex", "slots", "flags"]);
    var rowIndex = row.rowIndex;
    if (!Number.isInteger(rowIndex) || rowIndex < 1 || rowIndex > EXPECTED_ROWS || seenRows[rowIndex]) {
      fail("CONFLICT", "El worker OCR devolvio una respuesta invalida", false);
    }
    seenRows[rowIndex] = true;
    if (!Array.isArray(row.slots) || row.slots.length !== EXPECTED_SLOTS) {
      fail("CONFLICT", "El worker OCR debe devolver cuarenta renglones por cinco casillas", false);
    }
    var seenSlots = Object.create(null);
    var normalizedSlots = row.slots.map(function (slot) {
      if (!slot || typeof slot !== "object" || Array.isArray(slot)) fail("CONFLICT", "El worker OCR devolvio una respuesta invalida", false);
      onlyKeys(slot, ["cropId", "digitIndex", "digit", "confidence"]);
      var digitIndex = slot.digitIndex;
      if (!Number.isInteger(digitIndex) || digitIndex < 0 || digitIndex >= EXPECTED_SLOTS || seenSlots[digitIndex]) {
        fail("CONFLICT", "El worker OCR devolvio una respuesta invalida", false);
      }
      seenSlots[digitIndex] = true;
      var expectedCropId = "r" + ("0" + rowIndex).slice(-2) + "-d" + (digitIndex + 1);
      if (typeof slot.cropId !== "string" || slot.cropId !== expectedCropId ||
          typeof slot.digit !== "string" || !/^\d?$/.test(slot.digit)) {
        fail("CONFLICT", "El worker OCR devolvio una respuesta invalida", false);
      }
      var slotConfidence = confidence(slot.confidence);
      if (slot.digit === "" && slotConfidence !== 0) {
        fail("CONFLICT", "El worker OCR devolvio una respuesta invalida", false);
      }
      return { cropId: expectedCropId, digitIndex: digitIndex, digit: slot.digit, confidence: slotConfidence };
    }).sort(function (left, right) { return left.digitIndex - right.digitIndex; });
    var rowFlags = flags(row.flags);
    var complete = normalizedSlots.every(function (slot) { return slot.digit !== ""; });
    if (!complete && rowFlags.indexOf("BLANK_DIGIT") === -1) {
      if (rowFlags.length >= 20) fail("CONFLICT", "El worker OCR devolvio una respuesta invalida", false);
      rowFlags.push("BLANK_DIGIT");
    }
    var digitConfidences = normalizedSlots.map(function (slot) { return slot.digit ? slot.confidence : 0; });
    return {
      rowIndex: rowIndex,
      rawDigits: complete ? normalizedSlots.map(function (slot) { return slot.digit; }).join("") : "",
      digitConfidences: digitConfidences,
      overallConfidence: Math.min.apply(Math, digitConfidences),
      flags: rowFlags,
      slots: normalizedSlots
    };
  }

  function cropVariant(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      fail("CONFLICT", "El worker OCR devolvio evidencia invalida", false);
    }
    onlyKeys(value, ["mimeType", "sha256", "contentBase64"]);
    if (typeof value.mimeType !== "string" || typeof value.sha256 !== "string" || typeof value.contentBase64 !== "string") {
      fail("CONFLICT", "El worker OCR devolvio evidencia invalida", false);
    }
    var variantMime = value.mimeType;
    if (["image/png", "image/jpeg"].indexOf(variantMime) === -1) {
      fail("CONFLICT", "El worker OCR devolvio evidencia invalida", false);
    }
    var claimedHash = value.sha256;
    if (!/^[a-f0-9]{64}$/.test(claimedHash)) fail("CONFLICT", "El worker OCR devolvio evidencia invalida", false);
    var content = value.contentBase64;
    if (!content || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(content)) {
      fail("CONFLICT", "El worker OCR devolvio evidencia invalida", false);
    }
    var dataUrl = "data:" + variantMime + ";base64," + content;
    var parsed;
    try {
      parsed = KcmDriveEvidenceRepository.parseReviewCropDataUrl(dataUrl, variantMime);
    } catch (ignored) {
      fail("CONFLICT", "El worker OCR devolvio evidencia invalida", false);
    }
    if (String(parsed.sha256).toLowerCase() !== claimedHash) {
      fail("CONFLICT", "El worker OCR devolvio evidencia con hash invalido", false);
    }
    var byteSize = Number(parsed.byteSize);
    var maximumCropBytes = Number(KcmConfig.maxReviewCropBytes());
    if (!Number.isInteger(byteSize) || byteSize < 1 || !Number.isInteger(maximumCropBytes) ||
        maximumCropBytes < 1024 || byteSize > maximumCropBytes) {
      fail("CONFLICT", "El worker OCR devolvio evidencia invalida", false);
    }
    return {
      mimeType: variantMime,
      sha256: claimedHash,
      dataUrl: dataUrl,
      byteSize: byteSize
    };
  }

  function normalizeCropPairs(value) {
    if (!Array.isArray(value) || value.length !== EXPECTED_ROWS * EXPECTED_SLOTS) {
      fail("CONFLICT", "El worker OCR debe devolver doscientos pares de recortes", false);
    }
    var seen = Object.create(null);
    var totalBytes = 0;
    var pairs = value.map(function (pair) {
      if (!pair || typeof pair !== "object" || Array.isArray(pair)) {
        fail("CONFLICT", "El worker OCR devolvio evidencia invalida", false);
      }
      onlyKeys(pair, ["cropId", "rowIndex", "digitIndex", "visual", "processed"]);
      var rowIndex = pair.rowIndex;
      var digitIndex = pair.digitIndex;
      if (!Number.isInteger(rowIndex) || rowIndex < 1 || rowIndex > EXPECTED_ROWS ||
          !Number.isInteger(digitIndex) || digitIndex < 0 || digitIndex >= EXPECTED_SLOTS) {
        fail("CONFLICT", "El worker OCR devolvio evidencia invalida", false);
      }
      var key = rowIndex + "|" + digitIndex;
      var expectedCropId = "r" + ("0" + rowIndex).slice(-2) + "-d" + (digitIndex + 1);
      if (seen[key] || typeof pair.cropId !== "string" || pair.cropId !== expectedCropId) {
        fail("CONFLICT", "El worker OCR devolvio evidencia invalida", false);
      }
      seen[key] = true;
      var visual = cropVariant(pair.visual);
      var processed = cropVariant(pair.processed);
      totalBytes += visual.byteSize + processed.byteSize;
      return {
        cropId: expectedCropId,
        rowIndex: rowIndex,
        digitIndex: digitIndex,
        visual: visual,
        processed: processed
      };
    }).sort(function (left, right) {
      return left.rowIndex - right.rowIndex || left.digitIndex - right.digitIndex;
    });
    var maximumBatchBytes = Number(KcmConfig.maxReviewCropBatchBytes());
    var maximumCropBytes = Number(KcmConfig.maxReviewCropBytes());
    if (!Number.isInteger(maximumBatchBytes) || !Number.isInteger(maximumCropBytes) ||
        maximumBatchBytes < maximumCropBytes || maximumBatchBytes > 25000000) {
      fail("INTERNAL_ERROR", "El limite de evidencia OCR no es valido", false);
    }
    if (totalBytes > maximumBatchBytes) fail("CONFLICT", "La evidencia del worker OCR excede el limite permitido", false);
    return { pairs: pairs, totalBytes: totalBytes };
  }

  function normalizeResponse(response, request, config) {
    var contentType = responseHeader(response, "Content-Type").toLowerCase();
    if (!/^application\/json(?:\s*;|$)/.test(contentType)) fail("CONFLICT", "El worker OCR devolvio una respuesta invalida", false);
    var responseBytes = response.getContent();
    if (!responseBytes || typeof responseBytes.length !== "number" || responseBytes.length < 2 || responseBytes.length > config.maxResponseBytes) {
      fail("CONFLICT", "La respuesta del worker OCR excede el limite permitido", false);
    }
    var text = Utilities.newBlob(responseBytes).getDataAsString("UTF-8");
    var parsed;
    try { parsed = JSON.parse(text); } catch (ignored) { fail("CONFLICT", "El worker OCR devolvio una respuesta invalida", false); }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) fail("CONFLICT", "El worker OCR devolvio una respuesta invalida", false);
    onlyKeys(parsed, ROOT_KEYS);
    if (parsed.contractVersion !== CONTRACT_VERSION || parsed.requestId !== request.requestId ||
        parsed.documentId !== request.documentId || typeof parsed.sourceSha256 !== "string" ||
        parsed.sourceSha256 !== request.sourceSha256 ||
        parsed.status !== "COMPLETED") {
      fail("CONFLICT", "El worker OCR devolvio una respuesta invalida", false);
    }
    if (typeof parsed.workerVersion !== "string" || !/^[A-Za-z0-9_.-]{1,40}$/.test(parsed.workerVersion)) {
      fail("CONFLICT", "El worker OCR devolvio una respuesta invalida", false);
    }
    var runtime = runtimeMetadata(parsed.runtime);
    var processingMs = parsed.processingMs;
    if (!Number.isInteger(processingMs) || processingMs < 0 || processingMs > 120000) {
      fail("CONFLICT", "El worker OCR devolvio una respuesta invalida", false);
    }
    if (!Array.isArray(parsed.rows) || parsed.rows.length !== EXPECTED_ROWS) {
      fail("CONFLICT", "El worker OCR debe devolver cuarenta renglones por cinco casillas", false);
    }
    var seenRows = Object.create(null);
    var rows = parsed.rows.map(function (row) { return normalizeRow(row, seenRows); })
      .sort(function (left, right) { return left.rowIndex - right.rowIndex; });
    var crops = normalizeCropPairs(parsed.cropPairs);
    return Object.freeze({
      contractVersion: CONTRACT_VERSION,
      requestId: request.requestId,
      documentId: request.documentId,
      sourceSha256: request.sourceSha256,
      status: "COMPLETED",
      workerVersion: String(parsed.workerVersion),
      runtime: runtime,
      processingMs: processingMs,
      rows: rows,
      cropPairs: crops.pairs,
      cropBytes: crops.totalBytes
    });
  }

  function evidenceBatch(result, context) {
    if (!result || result.contractVersion !== CONTRACT_VERSION || result.status !== "COMPLETED" ||
        !Array.isArray(result.cropPairs) || result.cropPairs.length !== EXPECTED_ROWS * EXPECTED_SLOTS) {
      fail("INVALID_INPUT", "El resultado OCR interno no es valido", false);
    }
    if (!context || typeof context !== "object" || !Array.isArray(context.candidates) || context.candidates.length !== EXPECTED_ROWS) {
      fail("INVALID_INPUT", "El mapeo de candidatos OCR no es valido", false);
    }
    var sessionId = identifier(context.sessionId, "sessionId");
    var requestId = identifier(context.requestId || result.requestId, "requestId");
    var documentId = identifier(result.documentId, "documentId");
    if (context.documentId && identifier(context.documentId, "documentId") !== documentId) {
      fail("CONFLICT", "El resultado OCR no pertenece al documento", false);
    }
    var candidatesByRow = Object.create(null);
    var candidateIds = Object.create(null);
    context.candidates.forEach(function (candidate) {
      var rowIndex = Number(candidate && candidate.rowIndex);
      var candidateId = identifier(candidate && candidate.candidateId, "candidateId");
      if (!Number.isInteger(rowIndex) || rowIndex < 1 || rowIndex > EXPECTED_ROWS || candidatesByRow[rowIndex] || candidateIds[candidateId]) {
        fail("INVALID_INPUT", "El mapeo de candidatos OCR no es valido", false);
      }
      candidatesByRow[rowIndex] = candidateId;
      candidateIds[candidateId] = true;
    });
    var items = result.cropPairs.map(function (pair) {
      var candidateId = candidatesByRow[pair.rowIndex];
      if (!candidateId) fail("INVALID_INPUT", "El mapeo de candidatos OCR no es valido", false);
      return {
        candidateId: candidateId,
        cropId: pair.cropId,
        digitIndex: pair.digitIndex,
        visual: { mimeType: pair.visual.mimeType, dataUrl: pair.visual.dataUrl },
        processed: { mimeType: pair.processed.mimeType, dataUrl: pair.processed.dataUrl }
      };
    });
    return {
      requestId: requestId,
      sessionId: sessionId,
      documentId: documentId,
      items: items
    };
  }

  function candidateInputs(result) {
    if (!result || result.contractVersion !== CONTRACT_VERSION || result.status !== "COMPLETED" ||
        !Array.isArray(result.rows) || result.rows.length !== EXPECTED_ROWS) {
      fail("INVALID_INPUT", "El resultado OCR interno no es valido", false);
    }
    return result.rows.map(function (row) {
      return {
        rowIndex: row.rowIndex,
        rawDigits: row.rawDigits,
        digitConfidences: row.digitConfidences.slice(0, EXPECTED_SLOTS),
        overallConfidence: row.overallConfidence,
        technicalFlags: row.flags.slice(0, 20)
      };
    });
  }

  function storeCropEvidence(result, context) {
    return KcmOcrCropEvidenceService.storeBatch(evidenceBatch(result, context));
  }

  function httpError(status) {
    if (status === 401 || status === 403) fail("FORBIDDEN", "El worker OCR rechazo la solicitud", false);
    if (status === 429) fail("RATE_LIMITED", "El worker OCR esta temporalmente limitado", true);
    fail("CONFLICT", "El worker OCR rechazo la solicitud", false);
  }

  function create(authProvider, transport) {
    if (!transport || typeof transport.fetch !== "function") {
      fail("INTERNAL_ERROR", "El transporte del worker OCR no es valido", false);
    }
    return Object.freeze({
      process: function (input) {
        var config = configuration();
        var request = makeRequest(input, config);
        input = null;
        var headers = headersFor(request, authProvider);
        var startedAt = new Date().getTime();
        var lastStatus = 0;
        for (var attempt = 1; attempt <= config.maxAttempts; attempt += 1) {
          if (new Date().getTime() - startedAt >= config.deadlineMs) {
            fail("CONFLICT", "El worker OCR excedio el tiempo permitido", true);
          }
          var response;
          try {
            response = transport.fetch(config.endpoint, {
              method: "post",
              contentType: "application/json",
              payload: request.body,
              headers: headers,
              muteHttpExceptions: true,
              followRedirects: false,
              validateHttpsCertificates: true
            });
            lastStatus = Number(response.getResponseCode());
          } catch (ignored) {
            lastStatus = 0;
          }
          if (new Date().getTime() - startedAt >= config.deadlineMs) {
            fail("CONFLICT", "El worker OCR excedio el tiempo permitido", true);
          }
          if (lastStatus === 200) {
            var responseRequest = {
              requestId: request.requestId,
              documentId: request.documentId,
              sourceSha256: request.sourceSha256
            };
            request.body = "";
            return normalizeResponse(response, responseRequest, config);
          }
          if (!RETRYABLE_HTTP[lastStatus] && lastStatus !== 0) httpError(lastStatus);
          if (attempt < config.maxAttempts) {
            var delay = Math.min(config.backoffMs * Math.pow(2, attempt - 1), 5000);
            if (new Date().getTime() - startedAt + delay >= config.deadlineMs) {
              fail("CONFLICT", "El worker OCR excedio el tiempo permitido", true);
            }
            if (delay > 0) Utilities.sleep(delay);
          }
        }
        if (lastStatus === 429) fail("RATE_LIMITED", "El worker OCR esta temporalmente limitado", true);
        fail("CONFLICT", "El worker OCR no esta disponible temporalmente", true);
      }
    });
  }

  function process(input) {
    return create(KcmOcrWorkerAuth.current(), {
      fetch: function (endpoint, options) { return UrlFetchApp.fetch(endpoint, options); }
    }).process(input);
  }

  return Object.freeze({
    process: process,
    create: create,
    candidateInputs: candidateInputs,
    evidenceBatch: evidenceBatch,
    storeCropEvidence: storeCropEvidence
  });
}());
