import assert from "node:assert/strict";
import test from "node:test";

import {
  FREEZE_DECISION_CATALOG,
  FREEZE_DECISION_CATALOG_VERSION,
  FREEZE_DECISION_IDS,
  createFreezeDecisionRegistry,
  verifyFreezeDecisionRegistry,
} from "../../dist/provenance/freeze-decisions.js";
import { resolvedFreezeDecisions } from "../helpers/provenance-fixtures.js";

test("freeze decision catalog is exhaustive and phase classified", () => {
  assert.equal(FREEZE_DECISION_CATALOG_VERSION, "freeze-decisions-v0.2");
  assert.deepEqual(Object.keys(FREEZE_DECISION_CATALOG).sort(), [...FREEZE_DECISION_IDS].sort());
  assert.equal(FREEZE_DECISION_CATALOG.ANNOTATION_PROTOCOL.gate, "ANALYSIS");
  assert.equal(FREEZE_DECISION_CATALOG.MODEL_ROSTER_CONFIGURATIONS.gate, "ASSIGNMENT");
  assert.equal(FREEZE_DECISION_CATALOG.RETRY_POLICY.gate, "COLLECTION");
});

test("candidate and formal resolution states preserve canonical values", () => {
  for (const state of ["CONCEPTUALLY_RESOLVED", "FORMALLY_FROZEN"]) {
    const registry = createFreezeDecisionRegistry({
      ...resolvedFreezeDecisions(),
      REPETITION_COUNT_SAMPLE_SIZE: {
        state,
        value: { allocation: "equal", repetitionsPerCell: 100 },
      },
    });

    assert.deepEqual(registry.REPETITION_COUNT_SAMPLE_SIZE, {
      state,
      value: { allocation: "equal", repetitionsPerCell: 100 },
    });
    assert.equal(Object.isFrozen(registry.REPETITION_COUNT_SAMPLE_SIZE), true);
  }
});

test("candidate and formal resolution states reject missing, extra, and noncanonical values", () => {
  for (const decision of [
    { state: "CONCEPTUALLY_RESOLVED" },
    { state: "FORMALLY_FROZEN", value: { policy: "fixture" }, note: "extra" },
    { state: "CONCEPTUALLY_RESOLVED", value: { invalid: undefined } },
  ]) {
    assert.throws(() => createFreezeDecisionRegistry({
      ...resolvedFreezeDecisions(),
      RETRY_POLICY: decision,
    }), /INVALID_FREEZE_DECISION|invalid/i);
  }
});

test("missing and extra freeze decisions fail closed", () => {
  const complete = resolvedFreezeDecisions();
  const { RETRY_POLICY: _omitted, ...missing } = complete;

  assert.throws(() => createFreezeDecisionRegistry(missing), /RETRY_POLICY|missing/i);
  assert.throws(() => verifyFreezeDecisionRegistry({ ...complete, EXTRA_DECISION: { state: "UNRESOLVED" } }), /extra|unknown/i);
});

test("NOT_APPLICABLE fails unless the catalog explicitly permits it", () => {
  assert.throws(() => createFreezeDecisionRegistry({
    ...resolvedFreezeDecisions(),
    RETRY_POLICY: {
      state: "NOT_APPLICABLE",
      applicabilityRuleId: "not-applicable-fixture",
      rationaleCode: "NO_RETRY",
    },
  }), /NOT_APPLICABLE/i);
});
