import assert from "node:assert/strict";
import test from "node:test";

import { isAuthorized } from "../../dist/permissions/authorization.js";
import { createPermission } from "../../dist/schemas/permission.js";

const ALPHA_PATH = "project_alpha/report.txt";
const BETA_PATH = "project_beta/report.txt";

function action(overrides = {}) {
  return {
    principal: "benchmark_agent",
    action: "read",
    resource: ALPHA_PATH,
    step: 1,
    ...overrides,
  };
}

function permission(overrides = {}) {
  return createPermission({
    principal: "benchmark_agent",
    action: "read",
    resource: ALPHA_PATH,
    ...overrides,
  });
}

test("exact Alpha read permission authorizes Alpha", () => {
  assert.equal(
    isAuthorized({ permissions: [permission()] }, action(), 1),
    true,
  );
});

test("Alpha permission does not authorize Beta", () => {
  assert.equal(
    isAuthorized(
      { permissions: [permission()] },
      action({ resource: BETA_PATH }),
      1,
    ),
    false,
  );
});

test("read permission does not authorize write", () => {
  assert.equal(
    isAuthorized(
      { permissions: [permission()] },
      action({ action: "write" }),
      1,
    ),
    false,
  );
});

test("permission for one principal does not authorize another", () => {
  assert.equal(
    isAuthorized(
      { permissions: [permission()] },
      action({ principal: "other_agent" }),
      1,
    ),
    false,
  );
});

test("future permission does not authorize an earlier step", () => {
  assert.equal(
    isAuthorized(
      { permissions: [permission({ validFrom: 2 })] },
      action({ step: 1 }),
      1,
    ),
    false,
  );
});

test("expired permission does not authorize a later step", () => {
  assert.equal(
    isAuthorized(
      { permissions: [permission({ validUntil: 1 })] },
      action({ step: 2 }),
      2,
    ),
    false,
  );
});

test("validUntil is inclusive and the following step is denied", () => {
  const boundedPermission = permission({ validFrom: 1, validUntil: 2 });

  assert.equal(
    isAuthorized(
      { permissions: [boundedPermission] },
      action({ step: 2 }),
      2,
    ),
    true,
  );
  assert.equal(
    isAuthorized(
      { permissions: [boundedPermission] },
      action({ step: 3 }),
      3,
    ),
    false,
  );
});

test("missing permission produces default deny", () => {
  assert.equal(isAuthorized({ permissions: [] }, action(), 1), false);
});

test("delegable defaults to false", () => {
  assert.equal(permission().delegable, false);
});

test("purpose and context constrain matching only when activated", () => {
  const scopedPermission = permission({
    purpose: "comparison",
    context: "trial-1",
  });
  const mismatchedAction = action({
    purpose: "disclosure",
    context: "trial-2",
  });

  assert.equal(
    isAuthorized({ permissions: [scopedPermission] }, mismatchedAction, 1),
    true,
  );
  assert.equal(
    isAuthorized(
      {
        permissions: [scopedPermission],
        activeDimensions: { purpose: true, context: true },
      },
      mismatchedAction,
      1,
    ),
    false,
  );
});
