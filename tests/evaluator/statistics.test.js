import assert from "node:assert/strict";
import test from "node:test";

import {
  STATISTICAL_METHOD_VERSION,
  holmAdjustPValues,
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

test("Holm adjustment preserves a single test unchanged", () => {
  assert.deepEqual(holmAdjustPValues([
    { testId: "model-a:B_MINUS_C", pValue: 0.041 },
  ]), [
    {
      testId: "model-a:B_MINUS_C",
      pValue: 0.041,
      adjustedPValue: 0.041,
      rank: 1,
    },
  ]);
});

test("Holm adjustment is deterministic for three ordered and reverse-ordered tests", () => {
  const ordered = holmAdjustPValues([
    { testId: "model-a:B_MINUS_C", pValue: 0.01 },
    { testId: "model-c:B_MINUS_C", pValue: 0.03 },
    { testId: "model-b:B_MINUS_C", pValue: 0.04 },
  ]);
  assert.deepEqual(ordered, [
    { testId: "model-a:B_MINUS_C", pValue: 0.01, adjustedPValue: 0.03, rank: 1 },
    { testId: "model-c:B_MINUS_C", pValue: 0.03, adjustedPValue: 0.06, rank: 2 },
    { testId: "model-b:B_MINUS_C", pValue: 0.04, adjustedPValue: 0.06, rank: 3 },
  ]);

  const reverse = holmAdjustPValues([...ordered]
    .reverse()
    .map(({ testId, pValue }) => ({ testId, pValue })));
  assert.deepEqual(reverse.map(({ testId }) => testId), [
    "model-b:B_MINUS_C",
    "model-c:B_MINUS_C",
    "model-a:B_MINUS_C",
  ]);
  assert.deepEqual(
    Object.fromEntries(reverse.map(({ testId, adjustedPValue }) => [testId, adjustedPValue])),
    Object.fromEntries(ordered.map(({ testId, adjustedPValue }) => [testId, adjustedPValue])),
  );
});

test("Holm adjustment handles ties, boundaries, and monotonic adjusted values", () => {
  const adjusted = holmAdjustPValues([
    { testId: "near-one", pValue: 0.999999999999 },
    { testId: "tied-first", pValue: 0.02 },
    { testId: "near-zero", pValue: 1e-12 },
    { testId: "tied-second", pValue: 0.02 },
  ]);
  assert.deepEqual(adjusted.map(({ testId }) => testId), [
    "near-one",
    "tied-first",
    "near-zero",
    "tied-second",
  ]);
  const ranked = [...adjusted].sort((left, right) => left.rank - right.rank);
  for (let index = 1; index < ranked.length; index += 1) {
    assert.ok(ranked[index].adjustedPValue >= ranked[index - 1].adjustedPValue);
  }
  assert.equal(adjusted[1].rank, 2);
  assert.equal(adjusted[3].rank, 3);
  assert.equal(adjusted[2].adjustedPValue, 4e-12);
  assert.equal(adjusted[0].adjustedPValue, 0.999999999999);
});

test("Holm adjustment validates p-values and stable test identities", () => {
  assert.throws(() => holmAdjustPValues([]), /at least one/i);
  assert.throws(() => holmAdjustPValues([
    { testId: "duplicate", pValue: 0.1 },
    { testId: "duplicate", pValue: 0.2 },
  ]), /duplicate/i);
  for (const pValue of [-0.01, 1.01, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.throws(() => holmAdjustPValues([{ testId: "invalid", pValue }]), /p-value/i);
  }
  assert.throws(() => holmAdjustPValues([{ testId: "", pValue: 0.5 }]), /test id/i);
});
