/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import assert from "node:assert/strict";
import test from "node:test";
import {
  buildAssistantModelMessageForToolCalls,
  formatToolCallsForStorage,
} from "../../../src/runtime/turn/tool-call-message.js";
import {
  FLOW_CONTROL_ROLE,
  createFlowControlContextPolicy,
} from "@noobot/context-protocol/tool/context-policy";

test("canonical tool-call projections retain declared context policy", () => {
  const contextPolicy = createFlowControlContextPolicy(FLOW_CONTROL_ROLE.CHECKPOINT_EVIDENCE);
  const calls = [{ id: "call-1", name: "control", args: { value: 1 }, contextPolicy }];

  const stored = formatToolCallsForStorage(calls);
  const modelMessage = buildAssistantModelMessageForToolCalls({ toolCalls: calls });

  assert.deepEqual(stored[0].contextPolicy, contextPolicy);
  assert.deepEqual(modelMessage.tool_calls[0].contextPolicy, contextPolicy);
});

test("ordinary tool-call projections do not synthesize context policy", () => {
  const calls = [{ id: "call-1", name: "read_file", args: {} }];

  const stored = formatToolCallsForStorage(calls);
  const modelMessage = buildAssistantModelMessageForToolCalls({ toolCalls: calls });

  assert.equal(Object.hasOwn(stored[0], "contextPolicy"), false);
  assert.equal(Object.hasOwn(modelMessage.tool_calls[0], "contextPolicy"), false);
});
