/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";

import { materializeStoppedAssistantDraft } from "../../../src/runtime/tool-execution/stopped-assistant-draft.js";
import { createStateCommitter } from "../../../src/runtime/tool-execution/state-committer.js";
import {
  appendAssistantDraftContent,
  beginAssistantMessageEventStream,
  bindAssistantMessageEventStream,
} from "../../../src/events/message-event-stream.js";
import { createCurrentTurnMessagesStore } from "../../../src/runtime/turn/current-turn-ledger.js";
import { createTestRuntimeContext } from "../../helpers/test-runtime-context.js";

function createStopRuntime({ aborted = false } = {}) {
  const controller = new AbortController();
  if (aborted) controller.abort(new Error("user stop"));
  const runtime = createTestRuntimeContext({
    abortSignal: controller.signal,
    identity: { sessionId: "session-1", dialogProcessId: "dialog-1", turnScopeId: "turn-1" },
    systemRuntime: {},
  });
  bindAssistantMessageEventStream(runtime, {
    presentationMessageId: "pm_presentation",
    parentSessionId: "",
    workflowNodeOwnership: null,
  });
  runtime.currentTurnMessages = createCurrentTurnMessagesStore();
  runtime.persisted = 0;
  runtime.persistCurrentTurnMessages = async () => {
    runtime.persisted += 1;
  };
  runtime.materializePendingCurrentTurnMessageEvents = () => ({
    activityTimeline: [],
    toolTimeline: [],
  });
  return runtime;
}

test("a stop during streaming materializes the visible draft under the real model message", async () => {
  const runtime = createStopRuntime({ aborted: true });
  const modelMessageId = beginAssistantMessageEventStream(runtime, {
    turn: 0,
    modelAlias: "alias",
    modelName: "model",
  });
  appendAssistantDraftContent(runtime, "partial ");
  appendAssistantDraftContent(runtime, "answer");

  const messageUid = await materializeStoppedAssistantDraft(runtime);

  const [message] = runtime.currentTurnMessages.toArray();
  assert.equal(message.messageUid, messageUid);
  assert.equal(message.modelMessageId, modelMessageId);
  assert.equal(message.presentationMessageId, "pm_presentation");
  assert.equal(message.role, "assistant");
  assert.equal(message.content, "partial answer");
  assert.equal(Object.hasOwn(message, "tool_calls"), false);
  assert.equal(message.chatPresentation, true);
  assert.equal(message.modelAlias, "alias");
  assert.equal(runtime.persisted, 1);
  assert.equal(await materializeStoppedAssistantDraft(runtime), null);
  assert.equal(runtime.currentTurnMessages.toArray().length, 1);
});

test("a stop after the model message committed does not materialize it again", async () => {
  const runtime = createStopRuntime();
  const modelMessageId = beginAssistantMessageEventStream(runtime, { turn: 0 });
  appendAssistantDraftContent(runtime, "complete answer");
  await createStateCommitter({
    turnMessageStore: runtime.currentTurnMessages,
    runtime,
  }).pushAssistantMessage({
    content: "complete answer",
    type: "message",
    modelMessageId,
    messageUid: "sm_committed",
    presentationMessageId: "pm_presentation",
  });

  assert.equal(await materializeStoppedAssistantDraft(runtime), null);
  assert.equal(runtime.currentTurnMessages.toArray().length, 1);
});

test("a stop without visible streamed text materializes nothing", async () => {
  const runtime = createStopRuntime();
  beginAssistantMessageEventStream(runtime, { turn: 0 });

  assert.equal(await materializeStoppedAssistantDraft(runtime), null);
  assert.equal(runtime.currentTurnMessages.toArray().length, 0);
  assert.equal(runtime.persisted, 0);
});

test("a stop before any model invocation materializes nothing", async () => {
  const runtime = createStopRuntime();

  assert.equal(await materializeStoppedAssistantDraft(runtime), null);
  assert.equal(runtime.currentTurnMessages.toArray().length, 0);
});
