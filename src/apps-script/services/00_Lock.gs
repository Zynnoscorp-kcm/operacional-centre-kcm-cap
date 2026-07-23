/** Bloqueo global reentrante para mutaciones Apps Script dentro de una misma ejecucion. */
var KcmScriptLock = (function () {
  "use strict";

  var activeLock = null;
  var depth = 0;

  function busy(message) {
    var error = new Error(message || "Existe otra operacion en proceso; reintente");
    error.code = "CONFLICT";
    error.retryable = true;
    throw error;
  }

  function handle() {
    var released = false;
    function release() {
      if (released) return;
      released = true;
      if (!activeLock || depth < 1) return;
      depth -= 1;
      if (depth === 0) {
        var lock = activeLock;
        activeLock = null;
        lock.releaseLock();
      }
    }
    return Object.freeze({ release: release, releaseLock: release });
  }

  function acquire(timeoutMillis, message) {
    if (activeLock && depth > 0) {
      depth += 1;
      return handle();
    }
    var timeout = Number(timeoutMillis);
    if (!isFinite(timeout) || Math.floor(timeout) !== timeout || timeout < 0 || timeout > 300000) {
      throw new Error("El tiempo de espera del bloqueo no es valido");
    }
    var lock = LockService.getScriptLock();
    if (!lock.tryLock(timeout)) busy(message);
    activeLock = lock;
    depth = 1;
    return handle();
  }

  return Object.freeze({ acquire: acquire });
}());
