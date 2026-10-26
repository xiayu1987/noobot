/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { initializeCurrentTurnMessageEventProjection } from "../../../src/events/current-turn-message-event-projection.js";
import test from "node:test";
import assert from "node:assert/strict";

import {
  commitAuthoritativeFinalOutput,
  emitAuthoritativeFinalMessageContent,
} from "../../../src/runtime/engine.js";
import {
  beginAssistantMessageEventStream,
  bindAssistantMessageEventStream,
} from "../../../src/events/message-event-stream.js";
import { createAgentTurnResult } from "@noobot/agent-transport-protocol/agent-turn-result";
import { createTestRuntimeContext } from "../../helpers/test-runtime-context.js";
import { createCanonicalMessageEventSessionManager } from "../../helpers/canonical-message-event-session-manager.js";

function createFinalStreamRuntime(eventListener) {
  return createTestRuntimeContext({
    eventListener,
    runConfig: { hookManager: null, executionId: "execution-1", commandId: "command-1" },
    identity: { userId: "user-1", sessionId: "s1", dialogProcessId: "dp1", turnScopeId: "turn-1" },
    systemRuntime: {},
  });
}

function committedMessageEvents(events = []) {
  return events
    .filter((item) => item?.event === "authority_event_committed")
    .map((item) => item?.data?.envelope)
    .filter(Boolean);
}

function bindTestTurn(runtime, suffix) {
  runtime.sessionManager = createCanonicalMessageEventSessionManager({
    producerId: `final-stream-${suffix}`,
  });
  bindAssistantMessageEventStream(runtime, {
    presentationMessageId: `presentation-${suffix}`,
    parentSessionId: "",
    workflowNodeOwnership: null,
  });
  initializeCurrentTurnMessageEventProjection(runtime);
  return runtime;
}

test("authoritative final content is the sole terminal content event", async () => {
  const events = [];
  const result = createAgentTurnResult({
    output: "模型最终回答",
    traces: [],
    turnMessages: [],
    modelMessages: [],
    turnTasks: [],
    modelLoopRound: 0,
  });

  const runtime = createFinalStreamRuntime({
    onEvent(payload = {}) {
      events.push(payload);
    },
  });
  bindTestTurn(runtime, "1");
  const messageId = beginAssistantMessageEventStream(runtime, { turn: 0 });
  result.modelMessageId = messageId;
  runtime.currentTurnMessages.replaceAll([
    {
      role: "assistant",
      messageUid: "sm_final",
      modelMessageId: messageId,
      content: result.output,
    },
  ]);
  assert.equal(commitAuthoritativeFinalOutput({ result, runtime }), true);
  await emitAuthoritativeFinalMessageContent({ result, runtime });
  const messageEvents = committedMessageEvents(events);
  assert.deepEqual(
    messageEvents.map((item) => item.payload.eventType),
    ["authoritative_final_content"],
  );
  assert.equal(messageEvents[0].payload.text, "模型最终回答");
  assert.equal(result.turnMessages[0].modelMessageId, messageId);
});

test("final content commit follows hook-appended streaming delta", async () => {
  const events = [];
  const runtime = createFinalStreamRuntime({ onEvent: (payload = {}) => events.push(payload) });
  bindTestTurn(runtime, "1");
  const messageId = beginAssistantMessageEventStream(runtime, { turn: 0 });
  runtime.currentTurnMessages.replaceAll([
    {
      role: "assistant",
      messageUid: "sm_final",
      content: "draft",
      modelMessageId: messageId,
    },
  ]);
  const result = createAgentTurnResult({
    output: "draft",
    modelMessageId: messageId,
    traces: [],
    turnMessages: [
      {
        role: "assistant",
        messageUid: "sm_final",
        content: "draft",
        modelMessageId: messageId,
      },
    ],
    turnTasks: [],
    modelLoopRound: 0,
    modelMessages: [],
  });
  result.output = "draft plus hook";

  assert.equal(commitAuthoritativeFinalOutput({ result, runtime }), true);
  assert.equal(
    (await emitAuthoritativeFinalMessageContent({ result, runtime }))?.payload?.eventType,
    "authoritative_final_content",
  );
  const messageEvents = committedMessageEvents(events);
  assert.deepEqual(
    messageEvents.map((item) => item.payload.eventType),
    ["authoritative_final_content"],
  );
  assert.deepEqual(
    messageEvents.map((item) => item.ordering.sequence),
    [1],
  );
  assert.equal(messageEvents[0].payload.text, "draft plus hook");
  assert.equal(messageEvents[0].payload.presentationMessageId, "presentation-1");
  assert.equal(messageEvents[0].ordering.scopeId, "presentation-1");
  assert.equal(result.turnMessages[0].modelMessageId, messageId);
  assert.equal(result.turnMessages[0].content, "draft plus hook");
});

test("final content uses the result message identity after active stream changes", async () => {
  const events = [];
  const runtime = createFinalStreamRuntime({ onEvent: (payload = {}) => events.push(payload) });
  bindTestTurn(runtime, "1");
  const finalMessageId = beginAssistantMessageEventStream(runtime, { turn: 0 });
  runtime.currentTurnMessages.replaceAll([
    {
      role: "assistant",
      messageUid: "sm_final",
      content: "draft",
      modelMessageId: finalMessageId,
    },
  ]);
  const result = createAgentTurnResult({
    output: "authoritative final answer",
    modelMessageId: finalMessageId,
    traces: [],
    turnMessages: [
      {
        role: "assistant",
        messageUid: "sm_final",
        content: "draft",
        modelMessageId: finalMessageId,
      },
    ],
    turnTasks: [],
    modelLoopRound: 0,
    modelMessages: [],
  });
  const laterActiveMessageId = beginAssistantMessageEventStream(runtime, { turn: 0 });

  assert.notEqual(laterActiveMessageId, finalMessageId);
  assert.equal(commitAuthoritativeFinalOutput({ result, runtime }), true);
  assert.equal(
    (await emitAuthoritativeFinalMessageContent({ result, runtime }))?.payload?.eventType,
    "authoritative_final_content",
  );
  const committed = committedMessageEvents(events).at(-1);
  assert.equal(committed?.payload?.presentationMessageId, "presentation-1");
  assert.equal(committed?.payload?.text, "authoritative final answer");
  assert.equal(result.turnMessages[0].content, "authoritative final answer");
});

test("rewritten final content is committed only through the authoritative final event", async () => {
  const events = [];
  const result = createAgentTurnResult({
    output: "旧回答",
    traces: [],
    turnMessages: [],
    turnTasks: [],
    modelLoopRound: 0,
    modelMessages: [],
  });
  result.output = "新回答\n\n---\n验收";
  const runtime = createFinalStreamRuntime({ onEvent: (payload = {}) => events.push(payload) });
  bindTestTurn(runtime, "rewrite");
  const messageId = beginAssistantMessageEventStream(runtime, { turn: 0 });
  runtime.currentTurnMessages.replaceAll([
    { role: "assistant", messageUid: "sm_final", modelMessageId: messageId, content: "旧回答" },
  ]);
  result.modelMessageId = messageId;
  assert.equal(commitAuthoritativeFinalOutput({ result, runtime }), true);
  assert.equal(
    (await emitAuthoritativeFinalMessageContent({ result, runtime }))?.payload?.eventType,
    "authoritative_final_content",
  );
  assert.equal(committedMessageEvents(events).length, 1);
});
