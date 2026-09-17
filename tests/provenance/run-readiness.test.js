import assert from "node:assert/strict";
import test from "node:test";

import {
  FREEZE_DECISION_CATALOG,
  FREEZE_DECISION_IDS,
} from "../../dist/provenance/freeze-decisions.js";
import {
  createAssignmentDefinition,
  validateAnalysisReadiness,
  validateAssignmentReadiness,
  validateMainCollectionReadiness,
} from "../../dist/provenance/run-specification.js";
import {
  resolvedFreezeDecisions,
  runSpecificationInput,
  verifiedRun,
} from "../helpers/provenance-fixtures.js";

const validatorForGate = (gate) => {
  if (gate === "ASSIGNMENT") return validateAssignmentReadiness;
  if (gate === "COLLECTION") return validateMainCollectionReadiness;
  return validateAnalysisReadiness;
};

test("every freeze decision independently blocks its applicable readiness gate", () => {
  for (const id of FREEZE_DECISION_IDS) {
    const run = verifiedRun({
      freezeDecisions: resolvedFreezeDecisions({ [id]: { state: "UNRESOLVED" } }),
    });
    const result = validatorForGate(FREEZE_DECISION_CATALOG[id].gate)(run);

    assert.equal(result.ready, false, id);
    assert.ok(
      result.reasonCodes.includes(`UNRESOLVED_FREEZE_DECISION:${id}`),
      id,
    );
  }
});

test("analysis-only annotation does not block collection but blocks analysis", () => {
  const run = verifiedRun({
    freezeDecisions: resolvedFreezeDecisions({
      ANNOTATION_PROTOCOL: { state: "UNRESOLVED" },
    }),
  });

  assert.equal(validateMainCollectionReadiness(run).ready, true);
  assert.equal(validateAnalysisReadiness(run).ready, false);
});

test("missing decisions fail readiness rather than defaulting to resolved", () => {
  const run = verifiedRun();
  const { RETRY_POLICY: _omitted, ...missing } = run.freezeDecisions;
  const forged = { ...run, freezeDecisions: missing };
  const result = validateMainCollectionReadiness(forged);

  assert.equal(result.ready, false);
  assert.ok(result.reasonCodes.includes("MISSING_FREEZE_DECISION:RETRY_POLICY"));
});

test("extra decisions and invalid NOT_APPLICABLE states fail readiness", () => {
  const run = verifiedRun();
  const extra = validateMainCollectionReadiness({
    ...run,
    freezeDecisions: {
      ...run.freezeDecisions,
      EXTRA_DECISION: { state: "UNRESOLVED" },
    },
  });
  const notApplicable = validateMainCollectionReadiness({
    ...run,
    freezeDecisions: {
      ...run.freezeDecisions,
      RETRY_POLICY: {
        state: "NOT_APPLICABLE",
        applicabilityRuleId: "fixture",
        rationaleCode: "fixture",
      },
    },
  });

  assert.equal(extra.ready, false);
  assert.ok(extra.reasonCodes.includes("EXTRA_FREEZE_DECISION:EXTRA_DECISION"));
  assert.equal(notApplicable.ready, false);
  assert.ok(notApplicable.reasonCodes.includes("INVALID_NOT_APPLICABLE:RETRY_POLICY"));
});

test("fully resolved content is ready only while nested records verify", () => {
  const run = verifiedRun();
  assert.equal(validateAssignmentReadiness(run).ready, true);
  assert.equal(validateMainCollectionReadiness(run).ready, true);
  assert.equal(validateAnalysisReadiness(run).ready, true);

  const stale = {
    ...run,
    modelConfigurations: [{
      ...run.modelConfigurations[0],
      modelIdentifier: "stale-model",
    }],
  };
  const result = validateMainCollectionReadiness(stale);
  assert.equal(result.ready, false);
  assert.ok(result.reasonCodes.includes("INVALID_RUN_SPECIFICATION"));
});

test("unresolved model and assignment details block assignment readiness", () => {
  const input = runSpecificationInput();
  const model = {
    ...input.modelConfigurations[0],
    settings: {
      ...input.modelConfigurations[0].settings,
      seed: { state: "UNRESOLVED" },
    },
  };
  const modelResult = validateAssignmentReadiness({
    ...verifiedRun(),
    modelConfigurations: [model],
  });
  assert.equal(modelResult.ready, false);

  const run = verifiedRun({
    assignmentDefinitions: [
      createAssignmentDefinition({
        scheduledTrialId: input.assignmentDefinitions[0].scheduledTrialId,
        condition: input.assignmentDefinitions[0].condition,
        promptId: input.assignmentDefinitions[0].promptId,
        promptHash: input.assignmentDefinitions[0].promptHash,
        promptVersion: input.assignmentDefinitions[0].promptVersion,
        modelConfigurationId: input.assignmentDefinitions[0].modelConfigurationId,
        repetitionIndex: input.assignmentDefinitions[0].repetitionIndex,
        orderingAssignment: input.assignmentDefinitions[0].orderingAssignment,
        randomizationAssignment: { state: "UNRESOLVED" },
        randomizationBlock: input.assignmentDefinitions[0].randomizationBlock,
      }),
    ],
  });
  const assignmentResult = validateAssignmentReadiness(run);
  assert.equal(assignmentResult.ready, false);
  assert.ok(assignmentResult.reasonCodes.includes("UNRESOLVED_ASSIGNMENT_RANDOMIZATION"));
});
