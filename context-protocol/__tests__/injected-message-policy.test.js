/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import assert from "node:assert/strict";
import test from "node:test";
import {
  CONTEXT_INJECTED_MESSAGE_TRIGGER,
  CONTEXT_INJECTED_MESSAGE_TYPE,
  consumeInjectedContextMessages,
  resolveContextInternalMessageType,
} from "../src/injected-message-policy.js";
import { appendContextMessage } from "../src/context-mutation.js";
import { createModelContext } from "../src/hook-context.js";
import { getModelContextRevision } from "../src/model-context-runtime.js";

function markedMessage(internalType, content, id) {
  return {
    role: "user",
    content,
    additional_kwargs: {
      noobotMessageId: id,
      noobotInternalMessageType: internalType,
    },
  };
}

function consumeModelInvocation(modelContext) {
  return consumeInjectedContextMessages(modelContext, {
    trigger: { type: CONTEXT_INJECTED_MESSAGE_TRIGGER.MODEL_INVOCATION_COMPLETED },
  });
}

function consumeToolCalls(modelContext, toolNames) {
  return consumeInjectedContextMessages(modelContext, {
    trigger: {
      type: CONTEXT_INJECTED_MESSAGE_TRIGGER.TOOL_CALLS_COMPLETED,
      toolNames,
    },
  });
}

test("internal message type uses the context protocol field codec", () => {
  assert.equal(resolveContextInternalMessageType({
    additional_kwargs: { noobotInternalMessageType: "internal.marker" },
  }), "internal.marker");
});

test("phase summary prompt remains until task_summary tool calls complete", () => {
  const phasePrompt = markedMessage(
    CONTEXT_INJECTED_MESSAGE_TYPE.PHASE_SUMMARY_PROMPT,
    "phase summary",
    "phase_1",
  );
  const modelContext = createModelContext({
    messageBlocks: { system: [], history: [], incremental: [phasePrompt] },
  });
  const initialRevision = getModelContextRevision(modelContext);

  assert.equal(consumeModelInvocation(modelContext).removedCount, 0);
  assert.equal(consumeToolCalls(modelContext, ["read_file"]).removedCount, 0);
  assert.equal(getModelContextRevision(modelContext), initialRevision);
  assert.deepEqual(modelContext.messageBlocks.incremental, [phasePrompt]);

  const receipt = consumeToolCalls(modelContext, ["task_summary"]);
  assert.deepEqual(receipt, {
    removedCount: 1,
    removedMessageIds: ["phase_1"],
    removedInternalTypes: [CONTEXT_INJECTED_MESSAGE_TYPE.PHASE_SUMMARY_PROMPT],
  });
  assert.equal(getModelContextRevision(modelContext), initialRevision + 1);
  assert.deepEqual(modelContext.messageBlocks.incremental, []);
  assert.deepEqual(modelContext.messages, []);
});

test("model invocation consumes task-check prompts from every authoritative block", () => {
  const marker = CONTEXT_INJECTED_MESSAGE_TYPE.TASK_CHECK_PROMPT;
  const prompts = ["system", "history", "incremental"].map((blockName, index) =>
    markedMessage(marker, `task check ${blockName}`, `check_${index + 1}`));
  const regularSystem = { role: "system", content: "system" };
  const regularHistory = { role: "user", content: "history" };
  const regularIncremental = { role: "user", content: "task check incremental" };
  const modelContext = createModelContext({
    messageBlocks: {
      system: [regularSystem, prompts[0]],
      history: [prompts[1], regularHistory],
      incremental: [regularIncremental, prompts[2]],
    },
  });
  const initialRevision = getModelContextRevision(modelContext);

  const receipt = consumeModelInvocation(modelContext);

  assert.deepEqual(receipt, {
    removedCount: 3,
    removedMessageIds: ["check_1", "check_2", "check_3"],
    removedInternalTypes: [marker],
  });
  assert.equal(getModelContextRevision(modelContext), initialRevision + 1);
  assert.deepEqual(modelContext.messageBlocks.system, [regularSystem]);
  assert.deepEqual(modelContext.messageBlocks.history, [regularHistory]);
  assert.deepEqual(modelContext.messageBlocks.incremental, [regularIncremental]);
  assert.deepEqual(modelContext.messages, [regularSystem, regularHistory, regularIncremental]);
});

test("visible text without a protocol marker is never consumed", () => {
  const unmarked = { role: "user", content: "请执行任务检查。" };
  const modelContext = createModelContext({
    messageBlocks: { system: [], history: [], incremental: [unmarked] },
  });
  const revision = getModelContextRevision(modelContext);

  assert.deepEqual(consumeModelInvocation(modelContext), {
    removedCount: 0,
    removedMessageIds: [],
    removedInternalTypes: [],
  });
  assert.equal(getModelContextRevision(modelContext), revision);
  assert.deepEqual(modelContext.messages, [unmarked]);
});

test("single-tool retry prompt is consumed by the next model invocation", () => {
  const retryPrompt = markedMessage(
    CONTEXT_INJECTED_MESSAGE_TYPE.TASK_SUMMARY_SINGLE_TOOL_RETRY_PROMPT,
    "call task_summary alone",
    "summary_retry_1",
  );
  const modelContext = createModelContext({
    messageBlocks: { system: [], history: [], incremental: [retryPrompt] },
  });

  assert.deepEqual(consumeModelInvocation(modelContext), {
    removedCount: 1,
    removedMessageIds: ["summary_retry_1"],
    removedInternalTypes: [
      CONTEXT_INJECTED_MESSAGE_TYPE.TASK_SUMMARY_SINGLE_TOOL_RETRY_PROMPT,
    ],
  });
  assert.deepEqual(modelContext.messages, []);
});

test("repeated lifecycle cycles do not resurrect or accumulate consumed prompts", () => {
  const modelContext = createModelContext({
    messageBlocks: { system: [], history: [], incremental: [] },
  });

  for (let cycle = 1; cycle <= 3; cycle += 1) {
    appendContextMessage(modelContext, markedMessage(
      CONTEXT_INJECTED_MESSAGE_TYPE.PHASE_SUMMARY_PROMPT,
      `phase ${cycle}`,
      `phase_cycle_${cycle}`,
    ), { block: "incremental" });
    assert.equal(modelContext.messageBlocks.incremental.length, 1);
    assert.equal(consumeToolCalls(modelContext, ["task_summary"]).removedCount, 1);
    assert.deepEqual(modelContext.messageBlocks.incremental, []);
    assert.deepEqual(modelContext.messages, []);
  }
});

test("unknown and malformed lifecycle triggers are rejected", () => {
  const modelContext = createModelContext({
    messageBlocks: { system: [], history: [], incremental: [] },
  });
  assert.throws(
    () => consumeInjectedContextMessages(modelContext, { trigger: { type: "unknown" } }),
    /unsupported injected message lifecycle trigger/,
  );
  assert.throws(
    () => consumeInjectedContextMessages(modelContext, {
      trigger: { type: CONTEXT_INJECTED_MESSAGE_TRIGGER.TOOL_CALLS_COMPLETED },
    }),
    /requires toolNames/,
  );
  assert.throws(
    () => consumeInjectedContextMessages(modelContext, {
      trigger: {
        type: CONTEXT_INJECTED_MESSAGE_TRIGGER.MODEL_INVOCATION_COMPLETED,
        toolNames: [],
      },
    }),
    /must not contain toolNames/,
  );
});
