/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import test from "node:test";
import { validateModelResponse } from "@noobot/model-protocol";
import { createTestModelResponse } from "./public-runtime-fixtures.js";

test("model response fixture preserves invalid output for protocol rejection", () => {
  for (const options of [
    { reasoning: null },
    { toolCalls: {} },
    { finishReason: 3 },
    { content: false },
    { responseOutput: {} },
    { responseReasoning: [] },
    { attempts: [] },
    { identity: { sessionId: "" } },
    { identity: { dialogProcessId: null } },
  ]) {
    const before = structuredClone(options);
    const response = createTestModelResponse("done", options);
    assert.throws(() => validateModelResponse(response), TypeError);
    assert.deepEqual(options, before);
  }
  const response = createTestModelResponse(42);
  assert.equal(response.output.text, 42);
  assert.throws(() => validateModelResponse(response), TypeError);
  const declaredIdentity = createTestModelResponse("done", { identity: { dialogProcessId: 12 } });
  assert.equal(declaredIdentity.invocation.dialogProcessId, 12);
  assert.throws(() => validateModelResponse(declaredIdentity), TypeError);
});

test("model response fixture constructs protocol-valid output when optional fields are omitted", () => {
  const response = createTestModelResponse("done");
  assert.equal(validateModelResponse(response), response);
  assert.equal(Object.hasOwn(response.output, "usage"), false);
  assert.equal(Object.hasOwn(response.execution.attempts[0].output, "usage"), false);
});

test("model response rejects the removed SDK usage fact source", () => {
  const response = createTestModelResponse("done");
  response.output.usage = {};
  assert.throws(() => validateModelResponse(response), /unsupported fields: usage/);
});
