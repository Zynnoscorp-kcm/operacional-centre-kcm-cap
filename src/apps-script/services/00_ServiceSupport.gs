var KcmServiceSupport = (function () {
  "use strict";

  function nowIso() { return new Date().toISOString(); }
  function uuid() { return Utilities.getUuid(); }
  function repository() { return KcmRepository.current(); }
  function asBoolean(value) { return value === true || String(value).toLowerCase() === "true"; }
  function parseArray(value) {
    if (Array.isArray(value)) return value;
    if (!value) return [];
    try { return JSON.parse(String(value)); } catch (error) { return []; }
  }

  var OCR_RUNTIME_KEYS = [
    "nodeVersion", "ocrEngineName", "ocrEngineVersion", "pdfInfoVersion",
    "pdfToPpmVersion", "imagePipelineVersion", "containerBuildId", "pdfToolsUsed"
  ];

  function runtimeVersion(value) {
    var text = String(value || "");
    if (text.length > 64 || !/^\d+\.\d+(?:\.\d+)*(?:[-+._:][A-Za-z0-9][A-Za-z0-9._:-]{0,30})?$/.test(text)) {
      KcmValidation.fail("INVALID_INPUT", "Metadatos tecnicos OCR invalidos");
    }
    return text;
  }

  function ocrMetadata(input, required) {
    var source = input && typeof input === "object" ? input : {};
    var workerVersion = String(source.workerVersion || "");
    var runtimeValue = source.runtime;
    var processingValue = source.processingMs;
    if (!workerVersion && (runtimeValue === undefined || runtimeValue === null || runtimeValue === "") &&
        (processingValue === undefined || processingValue === null || processingValue === "")) {
      if (required) KcmValidation.fail("INVALID_INPUT", "Faltan metadatos tecnicos OCR");
      return { workerVersion: "", runtime: "", pipelineVersion: "", processingMs: "" };
    }
    if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,39}$/.test(workerVersion)) {
      KcmValidation.fail("INVALID_INPUT", "Metadatos tecnicos OCR invalidos");
    }
    var runtime = runtimeValue;
    if (typeof runtime === "string") {
      try { runtime = JSON.parse(runtime); }
      catch (ignored) { KcmValidation.fail("INVALID_INPUT", "Metadatos tecnicos OCR invalidos"); }
    }
    if (!runtime || typeof runtime !== "object" || Array.isArray(runtime)) {
      KcmValidation.fail("INVALID_INPUT", "Metadatos tecnicos OCR invalidos");
    }
    var keys = Object.keys(runtime).sort();
    if (keys.length !== OCR_RUNTIME_KEYS.length || OCR_RUNTIME_KEYS.some(function (key) { return keys.indexOf(key) === -1; })) {
      KcmValidation.fail("INVALID_INPUT", "Metadatos tecnicos OCR invalidos");
    }
    var normalized = {
      nodeVersion: runtimeVersion(runtime.nodeVersion),
      ocrEngineName: String(runtime.ocrEngineName || ""),
      ocrEngineVersion: runtimeVersion(runtime.ocrEngineVersion),
      pdfInfoVersion: runtimeVersion(runtime.pdfInfoVersion),
      pdfToPpmVersion: runtimeVersion(runtime.pdfToPpmVersion),
      imagePipelineVersion: String(runtime.imagePipelineVersion || ""),
      containerBuildId: String(runtime.containerBuildId || ""),
      pdfToolsUsed: runtime.pdfToolsUsed
    };
    if (normalized.ocrEngineName !== "tesseract" || normalized.imagePipelineVersion !== "raster-homography-1.0.0" ||
        !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$/.test(normalized.containerBuildId) ||
        typeof normalized.pdfToolsUsed !== "boolean") {
      KcmValidation.fail("INVALID_INPUT", "Metadatos tecnicos OCR invalidos");
    }
    var processingMs = Number(processingValue);
    if (!Number.isInteger(processingMs) || processingMs < 0 || processingMs > 120000) {
      KcmValidation.fail("INVALID_INPUT", "Metadatos tecnicos OCR invalidos");
    }
    return {
      workerVersion: workerVersion,
      runtime: JSON.stringify(normalized),
      pipelineVersion: normalized.imagePipelineVersion,
      processingMs: processingMs
    };
  }

  function session(sessionId) {
    var id = KcmValidation.identifier(sessionId, "sessionId");
    var found = repository().findOne(KcmConfig.SHEETS.SESSIONS, function (row) { return String(row.sessionId) === id; });
    if (!found) KcmValidation.fail("NOT_FOUND", "La sesion no existe");
    return found;
  }

  function transitionSession(current, next) {
    var allowed = KcmConfig.SESSION_TRANSITIONS[String(current.status)] || [];
    if (allowed.indexOf(next) === -1) KcmValidation.fail("INVALID_STATE", "La sesion no permite esta transicion");
    return next;
  }

  function audit(identity, input) {
    var metadata = ocrMetadata(input.ocrMetadata, false);
    var event = {
      eventId: uuid(), timestamp: nowIso(), actor: identity.actor, role: identity.role,
      sessionId: input.sessionId || "", entityType: input.entityType,
      entityId: input.entityId, action: input.action,
      previousState: input.previousState || "", newState: input.newState || "",
      reason: KcmValidation.text(input.reason || "", "reason", 300, false),
      requestId: input.requestId || KcmRequestContext.requestId || uuid(), version: KcmConfig.CONTRACT_VERSION,
      evidenceId: input.evidenceId || "",
      workerVersion: metadata.workerVersion, runtime: metadata.runtime,
      pipelineVersion: metadata.pipelineVersion, processingMs: metadata.processingMs
    };
    repository().insertMany(KcmConfig.SHEETS.AUDIT, [event]);
    return event;
  }

  function auditMany(identity, inputs) {
    if (!inputs.length) return [];
    var events = inputs.map(function (input) {
      var metadata = ocrMetadata(input.ocrMetadata, false);
      return {
        eventId: uuid(), timestamp: nowIso(), actor: identity.actor, role: identity.role,
        sessionId: input.sessionId || "", entityType: input.entityType,
        entityId: input.entityId, action: input.action,
        previousState: input.previousState || "", newState: input.newState || "",
        reason: KcmValidation.text(input.reason || "", "reason", 300, false),
        requestId: input.requestId || KcmRequestContext.requestId || uuid(), version: KcmConfig.CONTRACT_VERSION,
        evidenceId: input.evidenceId || "",
        workerVersion: metadata.workerVersion, runtime: metadata.runtime,
        pipelineVersion: metadata.pipelineVersion, processingMs: metadata.processingMs
      };
    });
    repository().insertMany(KcmConfig.SHEETS.AUDIT, events);
    return events;
  }

  function recordError(operation, requestId, error) {
    try {
      var safe = KcmValidation.safeError(error);
      repository().insertMany(KcmConfig.SHEETS.ERRORS, [{
        errorId: uuid(), timestamp: nowIso(), requestId: requestId || "",
        operation: KcmValidation.text(operation || "unknown", "operation", 80, false),
        category: safe.code, safeMessage: safe.message, retryable: safe.retryable,
        version: KcmConfig.CONTRACT_VERSION
      }]);
    } catch (ignored) {
      console.error("No fue posible registrar un error sanitizado");
    }
  }

  return Object.freeze({
    nowIso: nowIso, uuid: uuid, repository: repository, asBoolean: asBoolean,
    parseArray: parseArray, ocrMetadata: ocrMetadata, session: session, transitionSession: transitionSession,
    audit: audit, auditMany: auditMany, recordError: recordError
  });
}());
