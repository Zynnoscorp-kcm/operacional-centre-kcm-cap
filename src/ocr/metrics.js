import { OCR_DECISIONS } from "../shared/contracts.js";

function percent(numerator, denominator) {
  return denominator === 0 ? 0 : (numerator / denominator) * 100;
}

function observedDigitAt(recognition, observedValue, index) {
  if (Array.isArray(recognition?.digits) && index < recognition.digits.length) {
    const slot = recognition.digits[index];
    return String(slot && typeof slot === "object" ? (slot.digit ?? "") : (slot ?? ""));
  }
  return observedValue[index] ?? "";
}

export function measureOcrRun({ expectedRows, recognitions, candidates, elapsedMs = 0 }) {
  const recognitionByRow = new Map(recognitions.map((row) => [row.rowIndex, row]));
  const candidateByRow = new Map(candidates.map((candidate) => [candidate.rowIndex, candidate]));
  let expectedNumbers = 0;
  let correctNumbers = 0;
  let expectedDigits = 0;
  let correctDigits = 0;
  let autoAccepted = 0;
  let falseAccepted = 0;
  let manualReview = 0;
  let detectedRowsCorrect = 0;

  for (const expected of expectedRows) {
    const recognition = recognitionByRow.get(expected.rowIndex);
    const candidate = candidateByRow.get(expected.rowIndex);
    const expectedDetected = expected.expectedDetected !== false;
    if (Boolean(recognition?.detected) === expectedDetected) detectedRowsCorrect += 1;

    const expectedValue = String(expected.expectedDigits ?? "");
    if (!expectedValue) continue;
    expectedNumbers += 1;
    expectedDigits += expectedValue.length;
    const observedValue = String(recognition?.rawDigits ?? "");
    if (observedValue === expectedValue) correctNumbers += 1;
    for (let index = 0; index < expectedValue.length; index += 1) {
      if (observedDigitAt(recognition, observedValue, index) === expectedValue[index]) correctDigits += 1;
    }
    if (candidate?.decision === OCR_DECISIONS.REVIEW_REQUIRED) manualReview += 1;
    if (candidate?.decision === OCR_DECISIONS.AUTO_ACCEPTED) {
      autoAccepted += 1;
      if (observedValue !== expectedValue) falseAccepted += 1;
    }
  }

  const counts = Object.freeze({
    expectedNumbers,
    correctNumbers,
    expectedDigits,
    correctDigits,
    autoAccepted,
    falseAccepted,
    manualReview,
    expectedRows: expectedRows.length,
    detectedRowsCorrect
  });

  return Object.freeze({
    counts,
    fullNumberAccuracyPercent: percent(correctNumbers, expectedNumbers),
    digitAccuracyPercent: percent(correctDigits, expectedDigits),
    falseAcceptanceRatePercent: percent(falseAccepted, autoAccepted),
    falseAcceptanceRateEstimable: autoAccepted > 0,
    manualReviewRatePercent: percent(manualReview, expectedNumbers),
    correctlyDetectedRowsPercent: percent(detectedRowsCorrect, expectedRows.length),
    digitMetricMeaning: "DIGIT_COMPARED_IN_ORIGINAL_BOX_SLOT_WITH_RAW_FALLBACK",
    rowDetectionMetricMeaning: "OCCUPIED_VS_BLANK_CLASSIFICATION",
    processingTimeMs: Number(elapsedMs)
  });
}

export function aggregateOcrMetrics(metrics) {
  const totals = metrics.reduce((aggregate, metric) => {
    for (const [name, value] of Object.entries(metric.counts)) aggregate[name] += value;
    aggregate.processingTimeMs += metric.processingTimeMs;
    return aggregate;
  }, {
    expectedNumbers: 0,
    correctNumbers: 0,
    expectedDigits: 0,
    correctDigits: 0,
    autoAccepted: 0,
    falseAccepted: 0,
    manualReview: 0,
    expectedRows: 0,
    detectedRowsCorrect: 0,
    processingTimeMs: 0
  });

  return Object.freeze({
    sheets: metrics.length,
    fullNumberAccuracyPercent: percent(totals.correctNumbers, totals.expectedNumbers),
    digitAccuracyPercent: percent(totals.correctDigits, totals.expectedDigits),
    falseAcceptanceRatePercent: percent(totals.falseAccepted, totals.autoAccepted),
    falseAcceptanceRateEstimable: totals.autoAccepted > 0,
    manualReviewRatePercent: percent(totals.manualReview, totals.expectedNumbers),
    correctlyDetectedRowsPercent: percent(totals.detectedRowsCorrect, totals.expectedRows),
    digitMetricMeaning: "DIGIT_COMPARED_IN_ORIGINAL_BOX_SLOT_WITH_RAW_FALLBACK",
    rowDetectionMetricMeaning: "OCCUPIED_VS_BLANK_CLASSIFICATION",
    totalProcessingTimeMs: totals.processingTimeMs,
    averageProcessingTimeMs: metrics.length ? totals.processingTimeMs / metrics.length : 0,
    counts: Object.freeze({ ...totals })
  });
}
