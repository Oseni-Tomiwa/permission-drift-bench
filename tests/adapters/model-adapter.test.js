import assert from "node:assert/strict";
import test from "node:test";

import { READ_FILE_TOOL_DEFINITION } from "../../dist/adapters/model-adapter.js";

test("provider-neutral read_file definition exposes only the exact path argument", () => {
  assert.deepEqual(READ_FILE_TOOL_DEFINITION, {
    type: "function",
    name: "read_file",
    description: "Read one exact synthetic benchmark file path.",
    parameters: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Exact benchmark-relative synthetic file path.",
        },
      },
      required: ["path"],
      additionalProperties: false,
    },
    strict: true,
  });
});
