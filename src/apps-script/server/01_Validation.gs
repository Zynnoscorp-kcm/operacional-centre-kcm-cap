var KcmValidation = (function () {
  "use strict";

  function fail(code, safeMessage) {
    var error = new Error(safeMessage);
    error.code = code;
    throw error;
  }

  function text(value, field, maxLength, required) {
    if ((value === null || value === undefined || value === "") && !required) return "";
    if (typeof value !== "string") fail("INVALID_INPUT", "Entrada invalida");
    var normalized = value.replace(/[\u0000-\u001F\u007F]/g, " ").trim();
    if (required && !normalized) fail("INVALID_INPUT", "Falta un dato requerido");
    if (normalized.length > maxLength) fail("INVALID_INPUT", "Una entrada excede el limite permitido");
    return normalized;
  }

  function employeeId(value) {
    var normalized = text(value, "employeeId", 5, true);
    if (!/^\d{5}$/.test(normalized)) fail("INVALID_EMPLOYEE_ID", "El numero debe contener exactamente cinco digitos");
    return normalized;
  }

  function identifier(value, field) {
    var normalized = text(value, field, 100, true);
    if (!/^[A-Za-z0-9_-]+$/.test(normalized)) fail("INVALID_IDENTIFIER", "Identificador invalido");
    return normalized;
  }

  function sessionCode(value) {
    var normalized = text(value, "sessionCode", 24, true).toUpperCase();
    if (!/^KCM-\d{6}-[A-Z0-9]{4,8}$/.test(normalized)) fail("INVALID_SESSION_CODE", "Codigo de sesion invalido");
    return normalized;
  }

  function integer(value, min, max) {
    var number = Number(value);
    if (!Number.isInteger(number) || number < min || number > max) fail("INVALID_NUMBER", "Numero fuera del intervalo permitido");
    return number;
  }

  function booleanValue(value) {
    return value === true || value === "true";
  }

  function dateIso(value) {
    var normalized = text(value, "date", 10, true);
    var parsed = new Date(normalized + "T00:00:00.000Z");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized) || isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== normalized) {
      fail("INVALID_DATE", "Fecha invalida");
    }
    return normalized;
  }

  function enumValue(value, allowed) {
    var normalized = text(value, "enum", 60, true);
    if (allowed.indexOf(normalized) === -1) fail("INVALID_ENUM", "Valor no permitido");
    return normalized;
  }

  function stringArray(value, itemValidator, maxItems) {
    if (!Array.isArray(value) || value.length > maxItems) fail("INVALID_ARRAY", "Lista invalida");
    return value.map(itemValidator);
  }

  function json(value, maxLength) {
    var serialized = JSON.stringify(value === undefined ? null : value);
    if (serialized.length > maxLength) fail("INVALID_PAYLOAD", "Contenido demasiado grande");
    return serialized;
  }

  function forSheet(value) {
    if (typeof value !== "string") return value;
    var clean = value.replace(/[\u0000-\u001F\u007F]/g, " ");
    return /^[=+\-@]/.test(clean) ? "'" + clean : clean;
  }

  function safeError(error) {
    var allowed = {
      INVALID_INPUT: true, INVALID_EMPLOYEE_ID: true, INVALID_IDENTIFIER: true,
      INVALID_SESSION_CODE: true, INVALID_NUMBER: true, INVALID_DATE: true,
      INVALID_ENUM: true, INVALID_ARRAY: true, INVALID_PAYLOAD: true,
      UNAUTHORIZED: true, FORBIDDEN: true, NOT_FOUND: true, CONFLICT: true,
      RATE_LIMITED: true, DUPLICATE: true, INVALID_FILE: true,
      INVALID_STATE: true, EXAM_MISMATCH: true, RELEASE_CONFLICT: true
    };
    return {
      code: error && allowed[error.code] ? error.code : "INTERNAL_ERROR",
      message: error && allowed[error.code] ? error.message : "No fue posible completar la operacion",
      retryable: Boolean(error && error.retryable)
    };
  }

  return Object.freeze({
    fail: fail, text: text, employeeId: employeeId, identifier: identifier,
    sessionCode: sessionCode, integer: integer, booleanValue: booleanValue,
    dateIso: dateIso, enumValue: enumValue, stringArray: stringArray,
    json: json, forSheet: forSheet, safeError: safeError
  });
}());
