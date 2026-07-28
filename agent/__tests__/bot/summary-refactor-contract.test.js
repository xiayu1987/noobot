/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";

import { ModelMessageRuntimeHelpers } from "../../src/bot/session/model-message-runtime-helpers.js";
import { commitSummaryCheckpoint } from "../../src/bot/session/summary-checkpoint-committer.js";
import { createCurrentTurnMessagesStore } from "../../src/context/session/current-turn-store.js";
import { filterForModelContext } from "../../src/context/session/message-context-policy.js";
import { resolveMainModelFinalMessages } from "../../src/session/utils/context-window-normalizer.js";
import {
  appendMessage,
  canonicalizeMessageStore,
  pruneSummarizedIncrementalMessages,
} from "../../src/context/runtime-state/message-store.js";
import {
  markCurrentTurnArraySummarized,
} from "../../src/context/session/summarized-message-policy.js";
import * as mainFlowControl from "../../src/runtime/main-flow-control.js";

function message(id, value = {}) {
  return {
    ...value,
    additional_kwargs: {
      ...(value.additional_kwargs || {}),
      noobotMessageId: id,
    },
  };
}

function projectSummaryState(messages = []) {
  return messages.map((item) => ({
    id: item.additional_kwargs?.noobotMessageId || "",
    summarized: item.summarized === true,
    lcSummarized: item.lc_kwargs?.summarized === true,
  }));
}

test("summary marking remains byte-for-byte aligned with the pre-refactor policy result", async () => {
  const source = [
    message("system", { role: "system", content: "policy" }),
    message("user", { role: "user", content: "request" }),
    message("old-injected", {
      role: "user",
      content: "old relay",
      injectedMessage: true,
      injectedBy: "harness",
      injectedMessageType: "summary",
    }),
    message("tool-call", {
      role: "assistant",
      content: "",
      tool_calls: [{ id: "call-1", function: { name: "read_file" } }],
    }),
    message("tool-result", {
      role: "tool",
      content: "result",
      tool_call_id: "call-1",
    }),
    message("latest-injected", {
      role: "user",
      content: "latest relay",
      injectedMessage: true,
      injectedBy: "harness",
      injectedMessageType: "summary",
    }),
    message("summary-call", {
      role: "assistant",
      content: "",
      tool_calls: [{ id: "summary-1", function: { name: "task_summary" } }],
    }),
    message("summary-result", {
      role: "tool",
      content: '{"toolName":"task_summary","ok":true}',
      tool_call_id: "summary-1",
    }),
  ];
  const expected = markCurrentTurnArraySummarized(structuredClone(source));
  const actual = structuredClone(source);

  await new ModelMessageRuntimeHelpers().createMarkMessagesSummarized()({ messages: actual });

  assert.deepEqual(projectSummaryState(actual), projectSummaryState(expected));
  assert.deepEqual(
    actual.map(({ summarized, lc_kwargs, ...rest }) => rest),
    source.map(({ summarized, lc_kwargs, ...rest }) => rest),
    "marking must not change message content, order, ids, or metadata",
  );
});

test("summary marking keeps the exact pre-refactor summarized-field semantics", async () => {
  const actual = [message("m1", {
    role: "system",
    content: "old",
    additional_kwargs: { summarized: true },
  })];

  const marked = await new ModelMessageRuntimeHelpers().createMarkMessagesSummarized()({
    messages: actual,
  });

  assert.equal(marked, 1);
  assert.equal(actual[0].summarized, true);
});

test("model input after memory release equals the pre-refactor full-memory model input", async () => {
  const fullMemory = [
    message("m1", { role: "assistant", content: "", summarized: true, tool_calls: [{ id: "c1", function: { name: "read_file" } }] }),
    message("m2", { role: "tool", content: "old", summarized: true, tool_call_id: "c1" }),
    message("m3", { role: "user", content: "keep" }),
    message("m4", { role: "assistant", content: "answer" }),
  ];
  const reducedMemory = fullMemory.filter((item) => item.summarized !== true);

  assert.deepEqual(
    filterForModelContext(reducedMemory),
    filterForModelContext(fullMemory),
  );
});

test("model input remains deeply equal to pre-refactor block filtering across two checkpoints", () => {
  const holder = {
    messages: [],
    messageBlocks: {
      system: [{
        role: "system",
        content: "current-system",
        summarized: true,
        additional_kwargs: { noobotInternalMessageType: "system_context" },
      }],
      history: [
        { role: "user", content: "history-keep", dialogProcessId: "old-dialog" },
        { role: "assistant", content: "history-drop", summarized: true, dialogProcessId: "old-dialog" },
      ],
      incremental: [
        { role: "user", content: "current-user", dialogProcessId: "current-dialog" },
        {
          role: "assistant",
          content: "",
          summarized: true,
          tool_calls: [{ id: "call-1", function: { name: "read_file" } }],
        },
        { role: "tool", content: "old-result", tool_call_id: "call-1", summarized: true },
        { role: "assistant", content: "first-tail" },
      ],
    },
  };
  holder.messages = [
    ...holder.messageBlocks.system,
    ...holder.messageBlocks.history,
    ...holder.messageBlocks.incremental,
  ];
  canonicalizeMessageStore(holder);
  const resolve = () => resolveMainModelFinalMessages({
    systemMessages: holder.messageBlocks.system,
    historyMessages: holder.messageBlocks.history,
    incrementalMessages: holder.messageBlocks.incremental,
  }).messages;

  const preRefactorFirst = structuredClone(resolve());
  pruneSummarizedIncrementalMessages(holder);
  assert.deepEqual(resolve(), preRefactorFirst);

  appendMessage(holder, {
    role: "assistant",
    content: "",
    summarized: true,
    tool_calls: [{ id: "call-2", function: { name: "search" } }],
  }, { block: "incremental" });
  appendMessage(holder, {
    role: "tool",
    content: "second-old-result",
    tool_call_id: "call-2",
    summarized: true,
  }, { block: "incremental" });
  appendMessage(holder, {
    role: "user",
    content: "latest-summary-relay",
    injectedMessage: true,
    injectedBy: "harness-plugin",
    injectedMessageType: "summary",
  }, { block: "incremental" });

  const preRefactorSecond = structuredClone(resolve());
  pruneSummarizedIncrementalMessages(holder);
  assert.deepEqual(resolve(), preRefactorSecond);
  assert.deepEqual(
    resolve().map((item) => item.content),
    ["current-system", "history-keep", "current-user", "first-tail", "latest-summary-relay"],
  );
});

test("staged checkpoints plus final tail equal the pre-refactor one-shot turn sequence", async () => {
  const persistedStages = [];
  const runtime = {
    currentTurnMessages: createCurrentTurnMessagesStore([
      message("m1", { role: "assistant", content: "M1", summarized: true }),
      message("m2", { role: "assistant", content: "M2" }),
    ]),
  };
  const persist = {
    async appendAgentMessages({ messages }) {
      persistedStages.push(...structuredClone(messages));
    },
  };
  const session = { async markSessionMessagesSummarized() { return 1; } };

  await commitSummaryCheckpoint({
    session,
    turnPersister: persist,
    runtime,
    userId: "u1",
    sessionId: "s1",
  });
  runtime.currentTurnMessages.push(message("m3", { role: "assistant", content: "M3", summarized: true }));
  runtime.currentTurnMessages.push(message("m4", { role: "assistant", content: "M4" }));
  await commitSummaryCheckpoint({
    session,
    turnPersister: persist,
    runtime,
    userId: "u1",
    sessionId: "s1",
  });
  runtime.currentTurnMessages.push(message("m5", { role: "assistant", content: "M5" }));
  const persistedPrefix = Number(runtime.summaryCheckpointPersistedCount) || 0;
  persistedStages.push(...runtime.currentTurnMessages.toArray().slice(persistedPrefix));

  assert.deepEqual(
    persistedStages.map((item) => item.content),
    ["M1", "M2", "M3", "M4", "M5"],
  );
});

test("summary notifications use the existing main-flow command channel", () => {
  assert.equal(typeof mainFlowControl.requestMainFlowSummaryCheckpoint, "function");
  assert.equal(typeof mainFlowControl.consumeMainFlowSummaryCheckpoint, "function");
  const runtime = { systemRuntime: {} };

  mainFlowControl.requestMainFlowSummaryCheckpoint(runtime, {
    source: "task_summary",
    summarizedMessageIds: ["m1", "m2"],
  });

  assert.deepEqual(mainFlowControl.consumeMainFlowSummaryCheckpoint(runtime), {
    action: "summary_checkpoint",
    source: "task_summary",
    summarizedMessageIds: ["m1", "m2"],
  });
  assert.equal(runtime.systemRuntime.mainFlowControlInstructions, undefined);
});

test("summary checkpoint command is not lost when the existing channel also carries final-no-tools", () => {
  const runtime = { systemRuntime: {} };
  mainFlowControl.requestMainFlowSummaryCheckpoint(runtime, {
    source: "plugin.summary",
    summarizedMessageIds: ["m1"],
  });
  mainFlowControl.requestMainFlowFinalNoToolsTurn(runtime, {
    source: "harness",
    reason: "context_overflow_after_summary",
  });

  assert.equal(
    mainFlowControl.peekMainFlowFinalNoToolsTurnInstruction(runtime)?.action,
    "final_no_tools_turn",
  );
  assert.deepEqual(mainFlowControl.consumeMainFlowSummaryCheckpoint(runtime), {
    action: "summary_checkpoint",
    source: "plugin.summary",
    summarizedMessageIds: ["m1"],
  });
  assert.equal(
    mainFlowControl.peekMainFlowFinalNoToolsTurnInstruction(runtime)?.action,
    "final_no_tools_turn",
  );
});
