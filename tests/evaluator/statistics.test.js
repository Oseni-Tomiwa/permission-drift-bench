import assert from "node:assert/strict";
import test from "node:test";

import {
  STATISTICAL_METHOD_VERSION,
  newcombeRiskDifferenceInterval,
  wilsonInterval,
} from "../../dist/evaluator/statistics.js";

const close = (actual, expected, tolerance = 1e-12) =>
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} != ${expected}`);

test("Wilson intervals match independently fixed 95% boundary and interior values", () => {
  const expected = [
    [0, 0, 0.03699349820698568],
    [1, 0.0017674320641406505, 0.054486196178705315],
    [50, 0.4038315303659956, 0.5961684696340044],
    [99, 0.9455138038212946, 0.9982325679358593],
    [100, 0.9630065017930143, 1],
  ];
  for (const [successes, lower, upper] of expected) {
    const result = wilsonInterval(successes, 100);
    assert.equal(result.method, "WILSON_SCORE");
    assert.equal(result.confidenceLevel, 0.95);
    assert.equal(result.successes, successes);
    assert.equal(result.total, 100);
    close(result.lower, lower);
    close(result.upper, upper);
    assert.ok(Number.isFinite(result.lower) && Number.isFinite(result.upper));
    assert.ok(result.lower >= 0 && result.upper <= 1);
  }
});

test("Wilson intervals are symmetric and reject invalid inputs", () => {
  const low = wilsonInterval(1, 100);
  const high = wilsonInterval(99, 100);
  close(low.lower, 1 - high.upper);
  close(low.upper, 1 - high.lower);
  for (const args of [[-1, 100], [101, 100], [1.2, 100], [1, 0], [1, 3.2], [1, 100, 0], [1, 100, 1]]) {
    assert.throws(() => wilsonInterval(...args), /success|total|confidence/i);
  }
});

test("Newcombe risk-difference intervals are bounded and sign-reversible", () => {
  const result = newcombeRiskDifferenceInterval(20, 100, 5, 100);
  assert.equal(result.method, "NEWCOMBE_INDEPENDENT_WILSON");
  close(result.estimate, 0.15);
  close(result.lower, 0.059153502962011495);
  close(result.upper, 0.2432758428321417);
  const reversed = newcombeRiskDifferenceInterval(5, 100, 20, 100);
  close(reversed.estimate, -result.estimate);
  close(reversed.lower, -result.upper);
  close(reversed.upper, -result.lower);
});

test("Newcombe handles all-failure and maximally separated boundaries without Wald fallback", () => {
  const equalZero = newcombeRiskDifferenceInterval(0, 100, 0, 100);
  close(equalZero.estimate, 0);
  close(equalZero.lower, -0.03699349820698568);
  close(equalZero.upper, 0.03699349820698568);
  const separated = newcombeRiskDifferenceInterval(100, 100, 0, 100);
  close(separated.estimate, 1);
  close(separated.lower, 0.947683293116056);
  close(separated.upper, 1);
  for (const value of [equalZero, separated]) {
    assert.ok(value.lower >= -1 && value.upper <= 1);
    assert.ok(Number.isFinite(value.lower) && Number.isFinite(value.upper));
  }
});

test("statistical method contract has an explicit version", () => {
  assert.equal(STATISTICAL_METHOD_VERSION, "scope-statistics-v0.1.0");
});
