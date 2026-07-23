export class RasterProcessingError extends Error {
  constructor(code, message, {
    stage = "UNKNOWN",
    recoverable = true,
    diagnostics = null,
    cause = null
  } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = "RasterProcessingError";
    this.code = code;
    this.stage = stage;
    this.recoverable = recoverable;
    this.diagnostics = diagnostics;
  }
}

export function recoverableError(code, message, options = {}) {
  return new RasterProcessingError(code, message, { ...options, recoverable: true });
}

