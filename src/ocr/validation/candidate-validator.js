import {
  CONTRACT_VERSION,
  EMPLOYEE_ID_PATTERN,
  OCR_DECISIONS
} from "../../shared/contracts.js";

export const DEFAULT_OCR_THRESHOLDS = Object.freeze({
  autoAcceptOverall: 0.96,
  autoAcceptPerDigit: 0.94
});

function validatedThresholds(overrides) {
  if (overrides != null && (typeof overrides !== "object" || Array.isArray(overrides))) {
    throw new TypeError("Los umbrales OCR deben proporcionarse como objeto");
  }
  const thresholds = { ...DEFAULT_OCR_THRESHOLDS, ...(overrides ?? {}) };
  for (const name of ["autoAcceptOverall", "autoAcceptPerDigit"]) {
    if (!Number.isFinite(thresholds[name]) || thresholds[name] < 0 || thresholds[name] > 1) {
      throw new TypeError(`${name} debe ser un numero finito entre cero y uno`);
    }
  }
  return Object.freeze(thresholds);
}

function validatedContextFlags(flags) {
  if (!Array.isArray(flags)) throw new TypeError("contextValidationFlags debe ser un arreglo");
  return Object.freeze([...new Set(flags.map((flag) => {
    const value = String(flag);
    if (!/^[A-Z][A-Z0-9_]{2,80}$/.test(value)) throw new TypeError("Bandera de validacion OCR invalida");
    return value;
  }))]);
}

function validateRows(recognitions, maxRows) {
  if (!Number.isInteger(maxRows) || maxRows < 1 || maxRows > 1_000) throw new TypeError("maxRows es invalido");
  if (recognitions.length > maxRows) throw new RangeError("El proveedor OCR devolvio mas renglones de los permitidos");
  const seen = new Set();
  for (const recognition of recognitions) {
    const rowIndex = recognition?.rowIndex;
    if (!Number.isInteger(rowIndex) || rowIndex < 1 || rowIndex > maxRows) {
      throw new RangeError(`rowIndex debe ser un entero entre 1 y ${maxRows}`);
    }
    if (seen.has(rowIndex)) throw new TypeError(`rowIndex duplicado: ${rowIndex}`);
    seen.add(rowIndex);
  }
}

function clampConfidence(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return Math.max(0, Math.min(1, numeric));
}

function rosterStatus(employeeRoster, employeeId) {
  if (!employeeRoster) return { exists: false, active: false };
  if (employeeRoster instanceof Set) return { exists: employeeRoster.has(employeeId), active: employeeRoster.has(employeeId) };
  if (employeeRoster instanceof Map) {
    if (!employeeRoster.has(employeeId)) return { exists: false, active: false };
    const value = employeeRoster.get(employeeId);
    return { exists: true, active: typeof value === "object" ? value.active !== false : value !== false };
  }
  if (Array.isArray(employeeRoster)) {
    const employee = employeeRoster.find((entry) => (typeof entry === "string" ? entry : entry.employeeId) === employeeId);
    return { exists: Boolean(employee), active: typeof employee === "object" ? employee.active !== false : Boolean(employee) };
  }
  throw new TypeError("El padron debe ser Set, Map o arreglo");
}

export function createOcrCandidates(recognitions, {
  documentId,
  employeeRoster,
  thresholds,
  maxRows = 40,
  contextValidationFlags = [],
  candidateIdFactory = (rowIndex) => `${documentId}:row:${String(rowIndex).padStart(2, "0")}`
} = {}) {
  if (!documentId) throw new TypeError("documentId es obligatorio");
  if (!Array.isArray(recognitions)) throw new TypeError("recognitions debe ser un arreglo");
  validateRows(recognitions, maxRows);
  const effectiveThresholds = validatedThresholds(thresholds);
  const effectiveContextFlags = validatedContextFlags(contextValidationFlags);

  const duplicateCounts = new Map();
  for (const recognition of recognitions) {
    const rawDigits = String(recognition.rawDigits ?? "");
    if (EMPLOYEE_ID_PATTERN.test(rawDigits)) duplicateCounts.set(rawDigits, (duplicateCounts.get(rawDigits) ?? 0) + 1);
  }

  const candidateIds = new Set();
  return Object.freeze(recognitions.map((recognition) => {
    const rawDigits = String(recognition.rawDigits ?? "");
    const digitConfidences = (recognition.digitConfidences ?? []).map(clampConfidence);
    const suppliedOverall = clampConfidence(recognition.overallConfidence);
    const overallConfidence = digitConfidences.length
      ? Math.min(suppliedOverall, ...digitConfidences)
      : suppliedOverall;
    const validationFlags = [];
    const isBlank = rawDigits.length === 0;
    const hasValidFormat = EMPLOYEE_ID_PATTERN.test(rawDigits);

    if (recognition.detected === false) validationFlags.push("ROW_NOT_DETECTED");
    if (isBlank) validationFlags.push("BLANK_ROW");
    else if (!hasValidFormat) validationFlags.push("INVALID_FIVE_DIGIT_FORMAT");
    if (!isBlank && (digitConfidences.length !== 5 || digitConfidences.some((value) => value < effectiveThresholds.autoAcceptPerDigit))) {
      validationFlags.push("LOW_DIGIT_CONFIDENCE");
    }
    if (!isBlank && overallConfidence < effectiveThresholds.autoAcceptOverall) validationFlags.push("LOW_OVERALL_CONFIDENCE");
    if (!isBlank) validationFlags.push(...effectiveContextFlags);

    if (hasValidFormat) {
      const status = rosterStatus(employeeRoster, rawDigits);
      if (!status.exists) validationFlags.push("EMPLOYEE_NOT_FOUND");
      else if (!status.active) validationFlags.push("EMPLOYEE_INACTIVE");
      if ((duplicateCounts.get(rawDigits) ?? 0) > 1) validationFlags.push("DUPLICATE_IN_DOCUMENT");
    }

    let decision = OCR_DECISIONS.REVIEW_REQUIRED;
    if (validationFlags.length === 0) decision = OCR_DECISIONS.AUTO_ACCEPTED;

    const candidateId = String(candidateIdFactory(recognition.rowIndex));
    if (!candidateId.trim()) throw new TypeError("candidateId no puede estar vacio");
    if (candidateIds.has(candidateId)) throw new TypeError(`candidateId duplicado: ${candidateId}`);
    candidateIds.add(candidateId);

    return Object.freeze({
      candidateId,
      documentId: String(documentId),
      rowIndex: Number(recognition.rowIndex),
      rawDigits,
      digitConfidences: Object.freeze(digitConfidences),
      overallConfidence,
      normalizedEmployeeId: hasValidFormat ? rawDigits : null,
      decision,
      validationFlags: Object.freeze(validationFlags),
      originalValue: rawDigits,
      correctedValue: null,
      correctionActor: null,
      correctionAt: null,
      correctionReason: null,
      version: CONTRACT_VERSION
    });
  }));
}

export function employeeIsActive(employeeRoster, employeeId) {
  const status = rosterStatus(employeeRoster, employeeId);
  return status.exists && status.active;
}
