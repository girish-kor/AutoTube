// Bound-checks Gemini's proposed weight adjustments before persisting
// (docs/AI_PIPELINE.md §8): every weight in [0,1], sum within 0.01 of 1.0,
// and no single weight moving more than ±0.1 in one run.
function boundCheckWeights(currentWeights, proposedWeights, maxDeltaPerRun) {
  const delta = maxDeltaPerRun === undefined ? 0.1 : maxDeltaPerRun;
  const keys = Object.keys(currentWeights);
  const errors = [];
  let sum = 0;

  for (const key of keys) {
    const value = proposedWeights[key];
    if (typeof value !== "number" || value < 0 || value > 1) {
      errors.push(`${key} value ${value} outside [0,1]`);
      continue;
    }
    const change = Math.abs(value - currentWeights[key]);
    if (change > delta) {
      errors.push(`${key} changed by ${change.toFixed(3)}, exceeds +/-${delta} per run`);
    }
    sum += value;
  }

  if (Math.abs(sum - 1.0) > 0.01) {
    errors.push(`weights sum to ${sum.toFixed(3)}, deviates from 1.0 by more than 0.01`);
  }

  return { ok: errors.length === 0, errors };
}

module.exports = { boundCheckWeights };
