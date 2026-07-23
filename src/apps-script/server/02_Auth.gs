/** Autorizacion obligatoria del lado servidor y tokens de quiosco de corta duracion. */
var KcmAuth = (function () {
  "use strict";
  var ROLES = ["ADMINISTRADOR", "CAPACITACION", "AUDITOR", "CAPACITADOR"];

  function roleEmails(role) {
    var raw = KcmConfig.property("KCM_ROLE_" + role + "_EMAILS", "");
    return raw.split(",").map(function (item) { return item.trim().toLowerCase(); }).filter(String);
  }

  function currentIdentity() {
    if (KcmConfig.isMockMode()) return { actor: "demo@example.invalid", role: "ADMINISTRADOR" };
    var email = String(Session.getActiveUser().getEmail() || "").trim().toLowerCase();
    if (!email) KcmValidation.fail("UNAUTHORIZED", "Se requiere una cuenta autorizada");
    for (var i = 0; i < ROLES.length; i += 1) {
      if (roleEmails(ROLES[i]).indexOf(email) !== -1) return { actor: email, role: ROLES[i] };
    }
    KcmValidation.fail("FORBIDDEN", "La cuenta no tiene permiso para esta operacion");
  }

  function requireRoles(allowed) {
    var identity = currentIdentity();
    if (allowed.indexOf(identity.role) === -1) KcmValidation.fail("FORBIDDEN", "El rol no permite esta operacion");
    return identity;
  }

  function secret() {
    var configured = KcmConfig.property("KCM_KIOSK_TOKEN_SECRET", "");
    if (!configured && KcmConfig.isMockMode()) {
      configured = "UqU7cJ-_HnsNA3fRtMy-1oPO" + "fkYQn1KwIWi_5BLGAl4";
    }
    if (typeof configured !== "string" || !/^[A-Za-z0-9_-]{43,128}$/.test(configured)) {
      KcmValidation.fail("INTERNAL_ERROR", "Configuracion incompleta");
    }
    var decoded;
    var canonical;
    try {
      decoded = Utilities.base64DecodeWebSafe(configured);
      canonical = Utilities.base64EncodeWebSafe(decoded).replace(/=+$/g, "");
    } catch (ignored) {
      KcmValidation.fail("INTERNAL_ERROR", "Configuracion incompleta");
    }
    var distinct = Object.create(null);
    for (var index = 0; decoded && index < decoded.length; index += 1) distinct[String(decoded[index])] = true;
    var decodedText = decoded ? Utilities.newBlob(decoded).getDataAsString("UTF-8") : "";
    if (!decoded || decoded.length < 32 || canonical !== configured || Object.keys(distinct).length < 16 ||
        /change\s*me|password|example|replace|secret|sample|default|placeholder/i.test(decodedText)) {
      KcmValidation.fail("INTERNAL_ERROR", "Configuracion incompleta");
    }
    return configured;
  }

  function base64Web(value) {
    return Utilities.base64EncodeWebSafe(value, Utilities.Charset.UTF_8).replace(/=+$/g, "");
  }

  function sign(value) {
    return Utilities.base64EncodeWebSafe(Utilities.computeHmacSha256Signature(value, secret())).replace(/=+$/g, "");
  }

  function configuredKioskTokenMinutes() {
    var minutes = Number(KcmConfig.kioskTokenMinutes());
    if (!Number.isInteger(minutes) || minutes < 1 || minutes > 1440) {
      KcmValidation.fail("INTERNAL_ERROR", "Configuracion incompleta");
    }
    return minutes;
  }

  function validIdentifier(value) {
    return typeof value === "string" && /^[A-Za-z0-9_-]{1,100}$/.test(value);
  }

  function validActor(value) {
    return typeof value === "string" && value.length >= 1 && value.length <= 320 &&
      value === value.trim() && !/[\u0000-\u001f\u007f]/.test(value);
  }

  function validStationLabel(value) {
    return typeof value === "string" && value.length >= 1 && value.length <= 80 &&
      value === value.trim() && !/[\u0000-\u001f\u007f]/.test(value);
  }

  /** Primitiva de firma; la autorizacion y la sesion se validan en KcmKioskService. */
  function createKioskToken(input) {
    if (!input || typeof input !== "object" || Array.isArray(input)) {
      KcmValidation.fail("INVALID_INPUT", "No fue posible emitir el token de sesion");
    }
    var sessionId = input.sessionId;
    var issuedBy = input.issuedBy;
    var stationLabel = input.stationLabel;
    var expiresInMinutes = input.expiresInMinutes;
    var maximumMinutes = configuredKioskTokenMinutes();
    if (!validIdentifier(sessionId) || !validActor(issuedBy) ||
        !Number.isInteger(expiresInMinutes) || expiresInMinutes < 1 || expiresInMinutes > maximumMinutes ||
        (stationLabel !== undefined && !validStationLabel(stationLabel))) {
      KcmValidation.fail("INVALID_INPUT", "No fue posible emitir el token de sesion");
    }
    var payload = {
      sessionId: sessionId,
      exp: Date.now() + expiresInMinutes * 60000,
      nonce: Utilities.getUuid(),
      issuedBy: issuedBy
    };
    if (stationLabel !== undefined) payload.stationLabel = stationLabel;
    var encoded = base64Web(JSON.stringify(payload));
    return {
      token: encoded + "." + sign(encoded),
      expiresAt: new Date(payload.exp).toISOString()
    };
  }

  function constantTimeEqual(left, right) {
    if (left.length !== right.length) return false;
    var mismatch = 0;
    for (var i = 0; i < left.length; i += 1) mismatch |= left.charCodeAt(i) ^ right.charCodeAt(i);
    return mismatch === 0;
  }

  function invalidKioskToken() {
    KcmValidation.fail("UNAUTHORIZED", "Token de sesion invalido");
  }

  function verifyKioskToken(token, expectedSessionId) {
    if (typeof token !== "string" || token.length < 20 || token.length > 3000 || token !== token.trim()) invalidKioskToken();
    var normalized = token;
    var pieces = normalized.split(".");
    if (pieces.length !== 2 || !/^[A-Za-z0-9_-]+$/.test(pieces[0]) || !/^[A-Za-z0-9_-]{43}$/.test(pieces[1]) ||
        !constantTimeEqual(sign(pieces[0]), pieces[1])) invalidKioskToken();
    var decoded;
    try {
      var decodedText = Utilities.newBlob(Utilities.base64DecodeWebSafe(pieces[0])).getDataAsString("UTF-8");
      if (base64Web(decodedText) !== pieces[0]) invalidKioskToken();
      decoded = JSON.parse(decodedText);
    } catch (error) {
      invalidKioskToken();
    }
    if (!decoded || typeof decoded !== "object" || Array.isArray(decoded)) invalidKioskToken();
    var allowedKeys = { sessionId: true, exp: true, nonce: true, issuedBy: true, stationLabel: true };
    var keys = Object.keys(decoded);
    if (keys.length < 4 || keys.length > 5 || keys.some(function (key) { return !allowedKeys[key]; }) ||
        !Object.prototype.hasOwnProperty.call(decoded, "sessionId") ||
        !Object.prototype.hasOwnProperty.call(decoded, "exp") ||
        !Object.prototype.hasOwnProperty.call(decoded, "nonce") ||
        !Object.prototype.hasOwnProperty.call(decoded, "issuedBy")) invalidKioskToken();
    if (!validIdentifier(decoded.sessionId) || !validIdentifier(decoded.nonce) || !validActor(decoded.issuedBy) ||
        (Object.prototype.hasOwnProperty.call(decoded, "stationLabel") && !validStationLabel(decoded.stationLabel))) invalidKioskToken();
    var now = Date.now();
    var maximumExpiration = now + configuredKioskTokenMinutes() * 60000;
    if (!Number.isSafeInteger(decoded.exp) || decoded.exp <= now || decoded.exp > maximumExpiration ||
        (expectedSessionId !== undefined && (!validIdentifier(expectedSessionId) || decoded.sessionId !== expectedSessionId))) {
      invalidKioskToken();
    }
    return {
      actor: "KIOSK",
      role: "KIOSK",
      sessionId: decoded.sessionId,
      expiresAt: new Date(decoded.exp).toISOString(),
      stationLabel: decoded.stationLabel || ""
    };
  }

  function enforceKioskRateLimit(token, limit) {
    if (typeof token !== "string" || !Number.isInteger(limit) || limit < 1 || limit > 1000) {
      KcmValidation.fail("INVALID_INPUT", "No fue posible validar el limite de intentos");
    }
    var digest = Utilities.base64EncodeWebSafe(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, token)).slice(0, 32);
    var key = "kiosk-rate:" + digest;
    var lock = LockService.getScriptLock();
    if (!lock.tryLock(5000)) {
      var busy = new Error("No fue posible validar el limite de intentos; reintente");
      busy.code = "CONFLICT"; busy.retryable = true; throw busy;
    }
    try {
      var cache = CacheService.getScriptCache();
      var current = Number(cache.get(key) || "0");
      if (!Number.isInteger(current) || current < 0) current = 0;
      var attempts = current + 1;
      cache.put(key, String(attempts), 60);
      if (attempts > limit) KcmValidation.fail("RATE_LIMITED", "Demasiados intentos; espere un minuto");
    } finally {
      lock.releaseLock();
    }
  }

  return Object.freeze({
    currentIdentity: currentIdentity,
    requireRoles: requireRoles,
    createKioskToken: createKioskToken,
    verifyKioskToken: verifyKioskToken,
    enforceKioskRateLimit: enforceKioskRateLimit
  });
}());
