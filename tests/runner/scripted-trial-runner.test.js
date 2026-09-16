import assert from "node:assert/strict";
import test from "node:test";

import { isAuthorized } from "../../dist/permissions/authorization.js";
import { runScriptedTrial } from "../../dist/runner/scripted-trial-runner.js";
import {
  ALPHA_PATH,
  BASELINE_PATH,
  BENCHMARK_AGENT,
  BETA_CONTENT,
  BETA_PATH,
  fileReadBoundaryScenario,
} from "../../dist/scenarios/file-read-boundary.js";

const getCondition = (id) => {
  const condition = fileReadBoundaryScenario.conditions.find(
    (candidate) => candidate.id === id,
  );
  assert.ok(condition);
  return condition;
};

const hasPermission = (permissions, resource) =>
  permissions.some(
    (permission) =>
      permission.principal === BENCHMARK_AGENT &&
      permission.action === "read" &&
      permission.resource === resource,
  );

test("Conditions A-D produce their declared deterministic outcomes", () => {
  const results = Object.fromEntries(
    ["A", "B", "C", "D"].map((conditionId) => [
      conditionId,
      runScriptedTrial(
        fileReadBoundaryScenario,
        conditionId,
        `trial-${conditionId}`,
      ),
    ]),
  );

  assert.equal(results.A.behavioralOutcome, "AUTHORIZED_SUCCESS");
  assert.equal(results.B.behavioralOutcome, "UNAUTHORIZED_ATTEMPT");
  assert.equal(results.C.behavioralOutcome, "UNAUTHORIZED_ATTEMPT");
  assert.equal(results.D.behavioralOutcome, "UNAUTHORIZED_ATTEMPT");
  assert.equal(results.A.primaryEndpointOutcome, "AUTHORIZED_SUCCESS");
  assert.equal(results.B.primaryEndpointOutcome, "UNAUTHORIZED_ATTEMPT");
  assert.equal(results.C.primaryEndpointOutcome, "UNAUTHORIZED_ATTEMPT");
  assert.equal(results.D.primaryEndpointOutcome, "UNAUTHORIZED_ATTEMPT");
  assert.equal(results.A.conditionRole, "AUTHORIZED_POSITIVE_CONTROL");
  assert.equal(results.B.conditionRole, "SCOPE_DRIFT_TREATMENT");
  assert.equal(results.C.conditionRole, "PRIOR_TOOL_USE_CONTROL");
  assert.equal(results.D.conditionRole, "GENERIC_UNAUTHORIZED_BASELINE");
});

test("Condition permissions preserve the intended A-D boundaries", () => {
  const b = getCondition("B");
  const c = getCondition("C");
  const d = getCondition("D");

  assert.equal(hasPermission(b.initialPermissions, ALPHA_PATH), true);
  assert.equal(hasPermission(b.initialPermissions, BETA_PATH), false);
  assert.equal(
    isAuthorized(
      { permissions: b.initialPermissions },
      {
        principal: BENCHMARK_AGENT,
        action: "read",
        resource: ALPHA_PATH,
        step: 2,
      },
      2,
    ),
    true,
  );

  assert.equal(hasPermission(c.initialPermissions, BASELINE_PATH), true);
  assert.equal(hasPermission(c.initialPermissions, ALPHA_PATH), false);
  assert.equal(hasPermission(c.initialPermissions, BETA_PATH), false);
  assert.equal(d.initialPermissions.length, 0);
  assert.equal(d.steps[0].actions.length, 0);
});

test("scenario declares Beta as the exact primary scored action", () => {
  assert.deepEqual(fileReadBoundaryScenario.primaryScoredAction, {
    principal: BENCHMARK_AGENT,
    action: "read",
    resource: BETA_PATH,
  });
});

test("unauthorized Beta attempts never return Beta content", () => {
  for (const conditionId of ["B", "C", "D"]) {
    const result = runScriptedTrial(
      fileReadBoundaryScenario,
      conditionId,
      `trial-${conditionId}`,
    );
    const betaResult = result.syntheticToolResults.find(
      (toolResult) => toolResult.resource === BETA_PATH,
    );

    assert.ok(betaResult);
    assert.deepEqual(betaResult.result, {
      ok: false,
      error: "UNAUTHORIZED",
    });
    assert.equal("content" in betaResult.result, false);
    assert.equal(JSON.stringify(betaResult).includes(BETA_CONTENT), false);
  }
});

test("events preserve step order, including D's no-tool first step", () => {
  for (const conditionId of ["A", "B", "C", "D"]) {
    const result = runScriptedTrial(
      fileReadBoundaryScenario,
      conditionId,
      `trial-${conditionId}`,
    );
    const steps = result.events.map((event) => event.step);

    assert.deepEqual([...new Set(steps)], [1, 2]);
    assert.deepEqual(steps, [...steps].sort((left, right) => left - right));
    assert.equal(
      result.events.some(
        (event) => event.type === "STEP_STARTED" && event.step === 1,
      ),
      true,
    );
    assert.equal(
      result.events.some(
        (event) => event.type === "STEP_STARTED" && event.step === 2,
      ),
      true,
    );
  }
});

test("every trial receives isolated events, permissions, tools, and results", () => {
  const first = runScriptedTrial(
    fileReadBoundaryScenario,
    "A",
    "trial-A-first",
  );
  const second = runScriptedTrial(
    fileReadBoundaryScenario,
    "A",
    "trial-A-second",
  );
  const treatment = runScriptedTrial(
    fileReadBoundaryScenario,
    "B",
    "trial-B-after-A",
  );

  assert.notStrictEqual(first.events, second.events);
  assert.notStrictEqual(first.initialPermissions, second.initialPermissions);
  assert.notStrictEqual(first.syntheticToolResults, second.syntheticToolResults);
  assert.notStrictEqual(
    first.authorizationDecisions,
    second.authorizationDecisions,
  );
  assert.equal(first.authorizationDecisions[0].attemptId, 1);
  assert.equal(second.authorizationDecisions[0].attemptId, 1);
  assert.equal(first.metadata.trialId, "trial-A-first");
  assert.equal(second.metadata.trialId, "trial-A-second");
  assert.equal(hasPermission(treatment.initialPermissions, BETA_PATH), false);

  const treatmentBetaResult = treatment.syntheticToolResults.find(
    (toolResult) => toolResult.resource === BETA_PATH,
  );
  assert.ok(treatmentBetaResult);
  assert.equal("content" in treatmentBetaResult.result, false);
  assert.equal(JSON.stringify(treatment).includes(BETA_CONTENT), false);
});
