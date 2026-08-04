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
} from "@noobot/context-protocol/message-store";
import * as mainFlowControl from "../../src/runtime/main-flow-control.js";

function message(id, value = {}) {
  return {
    ...value,
    messageUid: id,
    additional_kwargs: {
      ...(value.additional_kwargs || {}),
      noobotMessageId: id,
    },
  };
}

test("plugin runtime exposes no direct summarized-message mutation port", () => {
  assert.equal(new ModelMessageRuntimeHelpers().createMarkMessagesSummarized, undefined);
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
      message("m1", { role: "assistant", content: "M1" }),
      message("m2", { role: "assistant", content: "M2" }),
    ]),
  };
  const persist = {
    async appendAgentMessages({ messages }) {
      persistedStages.push(...structuredClone(messages));
    },
  };
  const session = {
    async commitTurnSummaryCheckpoint() {
      return { committed: true, markedCount: 1, checkpointRevision: 1 };
    },
  };

  await commitSummaryCheckpoint({
    session,
    turnPersister: persist,
    runtime,
    userId: "u1",
    sessionId: "s1",
    dialogProcessId: "dp-1",
    turnScopeId: "turn-1",
    summaryCompletion: { summarizedMessageIds: ["m1"] },
  });
  runtime.currentTurnMessages.push(message("m3", { role: "assistant", content: "M3" }));
  runtime.currentTurnMessages.push(message("m4", { role: "assistant", content: "M4" }));
  await commitSummaryCheckpoint({
    session,
    turnPersister: persist,
    runtime,
    userId: "u1",
    sessionId: "s1",
    dialogProcessId: "dp-1",
    turnScopeId: "turn-1",
    summaryCompletion: { summarizedMessageIds: ["m3"] },
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
  assert.equal(typeof mainFlowControl.peekMainFlowSummaryCheckpoint, "function");
  assert.equal(typeof mainFlowControl.acknowledgeMainFlowSummaryCheckpoint, "function");
  const runtime = { systemRuntime: {} };

  mainFlowControl.requestMainFlowSummaryCheckpoint(runtime, {
    source: "task_summary",
    summarizedMessageIds: ["m1", "m2"],
  });

  assert.deepEqual(mainFlowControl.peekMainFlowSummaryCheckpoint(runtime), {
    action: "summary_checkpoint",
    source: "task_summary",
    summarizedMessageIds: ["m1", "m2"],
  });
  assert.equal(mainFlowControl.acknowledgeMainFlowSummaryCheckpoint(runtime), true);
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
  assert.deepEqual(mainFlowControl.peekMainFlowSummaryCheckpoint(runtime), {
    action: "summary_checkpoint",
    source: "plugin.summary",
    summarizedMessageIds: ["m1"],
  });
  assert.equal(mainFlowControl.acknowledgeMainFlowSummaryCheckpoint(runtime), true);
  assert.equal(
    mainFlowControl.peekMainFlowFinalNoToolsTurnInstruction(runtime)?.action,
    "final_no_tools_turn",
  );
});
