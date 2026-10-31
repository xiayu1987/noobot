/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  FLOW_CONTROL_ROLE,
  createFlowControlContextPolicy,
  validateRuntimeToolCall,
} from "../src/tool/context-policy.js";

const modelCall = { id: "call-1", name: "read_file", args: {} };

test("runtime tool call accepts a model tool call", () => {
  assert.equal(validateRuntimeToolCall(modelCall), modelCall);
});

test("runtime tool call accepts a declared tool context policy", () => {
  const call = {
    ...modelCall,
    contextPolicy: createFlowControlContextPolicy(FLOW_CONTROL_ROLE.CHECKPOINT_EVIDENCE),
  };
  assert.equal(validateRuntimeToolCall(call), call);
});

test("runtime tool call rejects an invalid context policy", () => {
  assert.throws(
    () => validateRuntimeToolCall({ ...modelCall, contextPolicy: { semanticClass: "other" } }),
    /runtime tool call\.contextPolicy is invalid/,
  );
});

test("runtime tool call rejects fields outside the model and context contracts", () => {
  assert.throws(
    () => validateRuntimeToolCall({ ...modelCall, type: "tool_call" }),
    /unsupported fields: type/,
  );
});

test("runtime tool call rejects missing args, missing name and non-object values", () => {
  assert.throws(
    () => validateRuntimeToolCall({ id: "call-1", name: "read_file" }),
    /args must be an object/,
  );
  assert.throws(() => validateRuntimeToolCall({ id: "call-1", args: {} }), /name is required/);
  assert.throws(() => validateRuntimeToolCall(null), /must be an object/);
});
