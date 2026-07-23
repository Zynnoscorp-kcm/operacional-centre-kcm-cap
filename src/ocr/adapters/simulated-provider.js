export class SimulatedOcrProvider {
  constructor({ providerName = "SIMULATED_DIGITS_V1" } = {}) {
    this.providerName = providerName;
  }

  recognize({ segmentation, hints = [] }) {
    if (!segmentation?.templateMap?.rows) {
      throw new TypeError("El proveedor simulado requiere una segmentacion de plantilla");
    }
    const hintsByRow = new Map(hints.map((hint) => [Number(hint.rowIndex), hint]));

    const rows = segmentation.templateMap.rows.map((row) => {
      const hint = hintsByRow.get(row.rowIndex) ?? {};
      const rawDigits = String(hint.observedDigits ?? hint.expectedDigits ?? "");
      const digitConfidences = hint.digitConfidences
        ? hint.digitConfidences.map(Number)
        : Array.from({ length: rawDigits.length }, () => rawDigits ? 0.995 : 0);
      const overallConfidence = hint.overallConfidence == null
        ? (digitConfidences.length ? Math.min(...digitConfidences) : 0)
        : Number(hint.overallConfidence);

      return Object.freeze({
        rowIndex: row.rowIndex,
        detected: hint.detected == null ? rawDigits.length > 0 : hint.detected === true,
        rawDigits,
        digitConfidences: Object.freeze(digitConfidences),
        overallConfidence,
        provider: this.providerName
      });
    });

    return Object.freeze({ provider: this.providerName, rows: Object.freeze(rows) });
  }
}
