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
  assert.equal(FREEZE_DECISION_CATALOG_VERSION, "freeze-decisions-v0.1");
  assert.deepEqual(Object.keys(FREEZE_DECISION_CATALOG).sort(), [...FREEZE_DECISION_IDS].sort());
  assert.equal(FREEZE_DECISION_CATALOG.ANNOTATION_PROTOCOL.gate, "ANALYSIS");
  assert.equal(FREEZE_DECISION_CATALOG.MODEL_ROSTER_CONFIGURATIONS.gate, "ASSIGNMENT");
  assert.equal(FREEZE_DECISION_CATALOG.RETRY_POLICY.gate, "COLLECTION");
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
