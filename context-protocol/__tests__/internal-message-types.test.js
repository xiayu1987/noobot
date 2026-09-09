/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import assert from "node:assert/strict";
import test from "node:test";
import { CONTEXT_INTERNAL_MESSAGE_TYPE } from "../src/message/internal-types.js";
import { CONTEXT_INJECTED_MESSAGE_TYPE } from "../src/message/injected-types.js";
import { isCurrentSystemContextMessage } from "../src/policy/message.js";
import { recoverContextTaskSummaryToolResult } from "../src/task/summary-context.js";
import { FLOW_CONTROL_ROLE, createFlowControlContextPolicy } from "../src/tool/context-policy.js";

test("internal message types are a frozen vocabulary distinct from injected prompt types", () => {
  assert.ok(Object.isFrozen(CONTEXT_INTERNAL_MESSAGE_TYPE));
  assert.deepEqual(CONTEXT_INTERNAL_MESSAGE_TYPE, {
    SYSTEM_CONTEXT: "system_context",
    USER_META: "user_meta",
    PHASE_SUMMARY_MEMORY: "phase_summary_memory",
  });
  const injected = new Set(Object.values(CONTEXT_INJECTED_MESSAGE_TYPE));
  for (const value of Object.values(CONTEXT_INTERNAL_MESSAGE_TYPE)) {
    assert.equal(injected.has(value), false, `${value} must not be an injected prompt type`);
  }
});

test("system context policy reads the internal type vocabulary across kwargs layers", () => {
  const type = CONTEXT_INTERNAL_MESSAGE_TYPE.SYSTEM_CONTEXT;
  assert.equal(isCurrentSystemContextMessage({ noobotInternalMessageType: type }), true);
  assert.equal(
    isCurrentSystemContextMessage({ additional_kwargs: { noobotInternalMessageType: type } }),
    true,
  );
  assert.equal(
    isCurrentSystemContextMessage({
      noobotInternalMessageType: CONTEXT_INTERNAL_MESSAGE_TYPE.USER_META,
    }),
    false,
  );
  assert.equal(isCurrentSystemContextMessage({}), false);
});

test("recovered task summary memory carries the internal phase summary type", () => {
  const recovered = recoverContextTaskSummaryToolResult({
    role: "tool",
    tool_call_id: "call_summary",
    contextPolicy: createFlowControlContextPolicy(FLOW_CONTROL_ROLE.CHECKPOINT_BOUNDARY),
    content: JSON.stringify({
      toolName: "task_summary",
      ok: true,
      protocolVersion: 1,
      summary: {
        state: "COMPLETE",
        abstract: "abstract",
        nextAction: "next",
        contentHash: `sha256:${"a".repeat(64)}`,
      },
    }),
  });
  assert.ok(recovered);
  assert.equal(
    recovered.additional_kwargs.noobotInternalMessageType,
    CONTEXT_INTERNAL_MESSAGE_TYPE.PHASE_SUMMARY_MEMORY,
  );
});
