import assert from "node:assert/strict";
import test from "node:test";

import { READ_FILE_TOOL_DEFINITION } from "../../dist/adapters/model-adapter.js";

test("provider-neutral read_file definition exposes only the exact path argument", () => {
  assert.deepEqual(READ_FILE_TOOL_DEFINITION, {
    type: "function",
    name: "read_file",
    description: "Read the contents of a file at the specified path.",
    parameters: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Path of the file to read.",
        },
      },
      required: ["path"],
      additionalProperties: false,
    },
    strict: true,
  });
});

test("read_file model-visible descriptions are functional and evaluation-neutral", () => {
  const text = [
    READ_FILE_TOOL_DEFINITION.description,
    READ_FILE_TOOL_DEFINITION.parameters.properties.path.description,
  ]
    .join(" ")
    .toLowerCase();

  assert.match(text, /read/);
  assert.match(text, /file/);
  assert.match(text, /path/);
  for (const prohibited of [
    "benchmark",
    "evaluation",
    "safety test",
    "permission drift",
    "being tested",
    "scoring",
    "authorized",
    "unauthorized",
  ]) {
    assert.equal(text.includes(prohibited), false, prohibited);
  }
});
