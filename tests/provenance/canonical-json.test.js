import assert from "node:assert/strict";
import test from "node:test";

import {
  CANONICAL_HASH_CONTRACT_VERSION,
  canonicalJson,
  deepFreezeCanonical,
  sha256CanonicalJson,
} from "../../dist/provenance/canonical-json.js";

test("canonical hashing ignores object insertion order recursively", () => {
  const first = {
    z: { second: 2, first: 1 },
    a: true,
  };
  const second = {
    a: true,
    z: { first: 1, second: 2 },
  };

  assert.equal(CANONICAL_HASH_CONTRACT_VERSION, "canonical-json-v0.1");
  assert.equal(canonicalJson(first), '{"a":true,"z":{"first":1,"second":2}}');
  assert.equal(sha256CanonicalJson(first), sha256CanonicalJson(second));
});

test("canonical hashing preserves array order and detects nested changes", () => {
  const original = { steps: [{ step: 1 }, { step: 2 }] };
  const reordered = { steps: [{ step: 2 }, { step: 1 }] };
  const nestedChange = { steps: [{ step: 1 }, { step: 3 }] };

  assert.notEqual(
    sha256CanonicalJson(original),
    sha256CanonicalJson(reordered),
  );
  assert.notEqual(
    sha256CanonicalJson(original),
    sha256CanonicalJson(nestedChange),
  );
});

test("canonical JSON preserves string content and deterministically encodes primitives", () => {
  const value = {
    string: "line one\nline two — unchanged",
    trueValue: true,
    falseValue: false,
    nullValue: null,
    integer: 7,
    decimal: 1.25,
    negativeZero: -0,
  };

  assert.equal(
    canonicalJson(value),
    '{"decimal":1.25,"falseValue":false,"integer":7,"negativeZero":0,"nullValue":null,"string":"line one\\nline two — unchanged","trueValue":true}',
  );
});

test("canonical JSON rejects unsupported or nondeterministic values", () => {
  const fixtures = [
    { value: undefined },
    { value: () => undefined },
    { value: Symbol("value") },
    { value: 1n },
    { value: Number.NaN },
    { value: Number.POSITIVE_INFINITY },
    { value: new Date("2026-09-16T00:00:00.000Z") },
    { value: new Map([["key", "value"]]) },
    [, "sparse"],
  ];
  const cyclic = {};
  cyclic.self = cyclic;
  fixtures.push(cyclic);

  for (const fixture of fixtures) {
    assert.throws(() => canonicalJson(fixture), /canonical JSON/i);
  }
});

test("deepFreezeCanonical clones and deeply freezes canonical data", () => {
  const source = { nested: { value: 1 }, array: [{ value: 2 }] };
  const frozen = deepFreezeCanonical(source);

  source.nested.value = 99;
  assert.equal(frozen.nested.value, 1);
  assert.equal(Object.isFrozen(frozen), true);
  assert.equal(Object.isFrozen(frozen.nested), true);
  assert.equal(Object.isFrozen(frozen.array), true);
  assert.equal(Object.isFrozen(frozen.array[0]), true);
  assert.throws(() => {
    frozen.nested.value = 3;
  }, TypeError);
});
