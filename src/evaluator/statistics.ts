export const STATISTICAL_METHOD_VERSION = "scope-statistics-v0.1.0";
export const DEFAULT_CONFIDENCE_LEVEL = 0.95;

export interface ProportionEstimate {
  readonly method: "WILSON_SCORE";
  readonly successes: number;
  readonly total: number;
  readonly estimate: number;
  readonly confidenceLevel: number;
  readonly lower: number;
  readonly upper: number;
}

export interface RiskDifferenceEstimate {
  readonly method: "NEWCOMBE_INDEPENDENT_WILSON";
  readonly firstSuccesses: number;
  readonly firstTotal: number;
  readonly secondSuccesses: number;
  readonly secondTotal: number;
  readonly estimate: number;
  readonly confidenceLevel: number;
  readonly lower: number;
  readonly upper: number;
}

function validateCounts(successes: number, total: number): void {
  if (!Number.isInteger(successes) || successes < 0) {
    throw new TypeError("successes must be a nonnegative integer");
  }
  if (!Number.isInteger(total) || total <= 0) {
    throw new TypeError("total must be a positive integer");
  }
  if (successes > total) throw new TypeError("successes cannot exceed total");
}

/** Peter J. Acklam's deterministic inverse-normal approximation. */
function inverseStandardNormal(probability: number): number {
  if (!(probability > 0 && probability < 1)) {
    throw new TypeError("normal probability must be strictly between zero and one");
  }
  if (probability === 0.975) return 1.959963984540054;
  const a = [-39.69683028665376, 220.9460984245205, -275.9285104469687, 138.357751867269, -30.66479806614716, 2.506628277459239];
  const b = [-54.47609879822406, 161.5858368580409, -155.6989798598866, 66.80131188771972, -13.28068155288572];
  const c = [-0.007784894002430293, -0.3223964580411365, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [0.007784695709041462, 0.3224671290700398, 2.445134137142996, 3.754408661907416];
  const low = 0.02425;
  const high = 1 - low;
  if (probability < low) {
    const q = Math.sqrt(-2 * Math.log(probability));
    return (((((c[0]! * q + c[1]!) * q + c[2]!) * q + c[3]!) * q + c[4]!) * q + c[5]!) /
      ((((d[0]! * q + d[1]!) * q + d[2]!) * q + d[3]!) * q + 1);
  }
  if (probability <= high) {
    const q = probability - 0.5;
    const r = q * q;
    return (((((a[0]! * r + a[1]!) * r + a[2]!) * r + a[3]!) * r + a[4]!) * r + a[5]!) * q /
      (((((b[0]! * r + b[1]!) * r + b[2]!) * r + b[3]!) * r + b[4]!) * r + 1);
  }
  const q = Math.sqrt(-2 * Math.log(1 - probability));
  return -(((((c[0]! * q + c[1]!) * q + c[2]!) * q + c[3]!) * q + c[4]!) * q + c[5]!) /
    ((((d[0]! * q + d[1]!) * q + d[2]!) * q + d[3]!) * q + 1);
}

function criticalValue(confidenceLevel: number): number {
  if (!(confidenceLevel > 0 && confidenceLevel < 1)) {
    throw new TypeError("confidence level must be strictly between zero and one");
  }
  return inverseStandardNormal(0.5 + confidenceLevel / 2);
}

export function wilsonInterval(
  successes: number,
  total: number,
  confidenceLevel = DEFAULT_CONFIDENCE_LEVEL,
): ProportionEstimate {
  validateCounts(successes, total);
  const z = criticalValue(confidenceLevel);
  const zSquared = z * z;
  const estimate = successes / total;
  const denominator = 1 + zSquared / total;
  const center = (estimate + zSquared / (2 * total)) / denominator;
  const halfWidth = z * Math.sqrt(
    estimate * (1 - estimate) / total + zSquared / (4 * total * total),
  ) / denominator;
  return Object.freeze({
    method: "WILSON_SCORE",
    successes,
    total,
    estimate,
    confidenceLevel,
    lower: Math.max(0, center - halfWidth),
    upper: Math.min(1, center + halfWidth),
  });
}

export function newcombeRiskDifferenceInterval(
  firstSuccesses: number,
  firstTotal: number,
  secondSuccesses: number,
  secondTotal: number,
  confidenceLevel = DEFAULT_CONFIDENCE_LEVEL,
): RiskDifferenceEstimate {
  const first = wilsonInterval(firstSuccesses, firstTotal, confidenceLevel);
  const second = wilsonInterval(secondSuccesses, secondTotal, confidenceLevel);
  const estimate = first.estimate - second.estimate;
  const lower = estimate - Math.sqrt(
    (first.estimate - first.lower) ** 2 +
    (second.upper - second.estimate) ** 2,
  );
  const upper = estimate + Math.sqrt(
    (first.upper - first.estimate) ** 2 +
    (second.estimate - second.lower) ** 2,
  );
  return Object.freeze({
    method: "NEWCOMBE_INDEPENDENT_WILSON",
    firstSuccesses,
    firstTotal,
    secondSuccesses,
    secondTotal,
    estimate,
    confidenceLevel,
    lower: Math.max(-1, lower),
    upper: Math.min(1, upper),
  });
}
