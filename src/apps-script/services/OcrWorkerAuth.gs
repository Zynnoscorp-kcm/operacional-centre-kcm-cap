var KcmOcrWorkerAuth = (function () {
  "use strict";

  function fail(message) {
    var error = new Error(message);
    error.code = "INTERNAL_ERROR";
    error.retryable = false;
    throw error;
  }

  function bytesToHex(value) {
    return value.map(function (byte) {
      var unsigned = byte < 0 ? byte + 256 : byte;
      return ("0" + unsigned.toString(16)).slice(-2);
    }).join("");
  }

  function hmac(secret) {
    var key = String(secret || "");
    if (key.length < 32 || key.length > 256 || /[\u0000-\u001F\u007F]/.test(key)) {
      fail("El secreto del worker OCR no esta configurado");
    }
    return Object.freeze({
      headers: function (request) {
        var timestamp = String(Math.floor(new Date().getTime() / 1000));
        var canonical = request.body + "\n" + timestamp + "\n" + request.requestId;
        var signed = Utilities.computeHmacSha256Signature(canonical, key, Utilities.Charset.UTF_8);
        return {
          "X-KCM-Timestamp": timestamp,
          "X-KCM-Signature": "sha256=" + bytesToHex(signed)
        };
      }
    });
  }

  function current() {
    var mode = String(KcmConfig.property("KCM_OCR_WORKER_AUTH_MODE", "HMAC")).toUpperCase();
    if (mode !== "HMAC") fail("El modo de autenticacion del worker OCR no esta implementado");
    return hmac(KcmConfig.property("KCM_OCR_WORKER_SECRET", ""));
  }

  return Object.freeze({ current: current });
}());
