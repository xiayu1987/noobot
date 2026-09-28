/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
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
import { buildLoopResult } from "../../../src/runtime/turn/turn-result-aggregator.js";
import { createCurrentTurnMessagesStore } from "../../../src/runtime/turn/current-turn-ledger.js";
import { createCanonicalMessageEventSessionManager } from "../../helpers/canonical-message-event-session-manager.js";

function createTurnMessageStore(messages = []) {
  return createCurrentTurnMessagesStore(messages);
}

function committedMessageEvents(events = []) {
  return events
    .filter((item) => item?.event === "authority_event_committed")
    .map((item) => item?.data?.envelope)
    .filter(Boolean);
}

function bindTestTurn(runtime = {}, suffix = "1") {
  runtime.sessionManager = createCanonicalMessageEventSessionManager({
    producerId: `final-stream-${suffix}`,
  });
  bindAssistantMessageEventStream(runtime, {
    messageId: `turn-message-${suffix}`,
    presentationMessageId: `presentation-${suffix}`,
  });
  return runtime;
}

test("authoritative final content is the sole terminal content event", async () => {
  const events = [];
  const result = buildLoopResult({
    output: "模型最终回答",
    traces: [],
    loopState: { turnMessages: [], turnTasks: [] },
    turnMessageStore: createTurnMessageStore(),
    modelMessages: [],
  });

  const runtime = {
    eventListener: {
      onEvent(payload = {}) {
        events.push(payload);
      },
    },
    systemRuntime: {
      sessionId: "s1",
      dialogProcessId: "dp1",
    },
  };
  bindTestTurn(runtime);
  const messageId = beginAssistantMessageEventStream(runtime);
  result.assistantMessageId = messageId;
  runtime.currentTurnMessages = createTurnMessageStore([
    { role: "assistant", messageId, content: result.output },
  ]);
  assert.equal(commitAuthoritativeFinalOutput({ result, runtime }), true);
  await emitAuthoritativeFinalMessageContent({ result, runtime });
  const messageEvents = committedMessageEvents(events);
  assert.deepEqual(
    messageEvents.map((item) => item.payload.eventType),
    ["authoritative_final_content"],
  );
  assert.equal(messageEvents[0].payload.text, "模型最终回答");
  assert.equal(result.turnMessages[0].messageId, messageId);
});

test("final content commit follows hook-appended streaming delta", async () => {
  const events = [];
  const runtime = {
    eventListener: { onEvent: (payload = {}) => events.push(payload) },
    systemRuntime: { sessionId: "s1", dialogProcessId: "dp1" },
  };
  bindTestTurn(runtime);
  const messageId = beginAssistantMessageEventStream(runtime);
  runtime.currentTurnMessages = createTurnMessageStore([
    {
      role: "assistant",
      content: "draft",
      id: messageId,
      messageId,
    },
  ]);
  const result = buildLoopResult({
    output: "draft",
    assistantMessageId: messageId,
    traces: [],
    loopState: {
      turnMessages: [
        {
          role: "assistant",
          content: "draft",
          id: messageId,
          messageId,
        },
      ],
      turnTasks: [],
    },
    turnMessageStore: createTurnMessageStore([
      {
        role: "assistant",
        content: "draft",
        id: messageId,
        messageId,
      },
    ]),
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
  assert.equal(messageEvents[0].identity.messageId, "turn-message-1");
  assert.equal(result.turnMessages[0].messageId, messageId);
  assert.equal(result.turnMessages[0].content, "draft plus hook");
});

test("final content uses the result message identity after active stream changes", async () => {
  const events = [];
  const runtime = {
    eventListener: { onEvent: (payload = {}) => events.push(payload) },
    systemRuntime: { sessionId: "s1", dialogProcessId: "dp1" },
  };
  bindTestTurn(runtime);
  const finalMessageId = beginAssistantMessageEventStream(runtime);
  runtime.currentTurnMessages = createTurnMessageStore([
    {
      role: "assistant",
      content: "draft",
      messageId: finalMessageId,
    },
  ]);
  const result = buildLoopResult({
    output: "authoritative final answer",
    assistantMessageId: finalMessageId,
    traces: [],
    loopState: {
      turnMessages: [
        {
          role: "assistant",
          content: "draft",
          messageId: finalMessageId,
        },
      ],
      turnTasks: [],
    },
    turnMessageStore: createTurnMessageStore([
      {
        role: "assistant",
        content: "draft",
        messageId: finalMessageId,
      },
    ]),
  });
  const laterActiveMessageId = beginAssistantMessageEventStream(runtime);

  assert.notEqual(laterActiveMessageId, finalMessageId);
  assert.equal(commitAuthoritativeFinalOutput({ result, runtime }), true);
  assert.equal(
    (await emitAuthoritativeFinalMessageContent({ result, runtime }))?.payload?.eventType,
    "authoritative_final_content",
  );
  const committed = committedMessageEvents(events).at(-1);
  assert.equal(committed?.identity?.messageId, "turn-message-1");
  assert.equal(committed?.payload?.text, "authoritative final answer");
  assert.equal(result.turnMessages[0].content, "authoritative final answer");
});

test("rewritten final content is committed only through the authoritative final event", async () => {
  const events = [];
  const result = buildLoopResult({
    output: "旧回答",
    traces: [],
    loopState: { turnMessages: [], turnTasks: [] },
    turnMessageStore: createTurnMessageStore(),
  });
  result.output = "新回答\n\n---\n验收";
  const runtime = {
    eventListener: { onEvent: (payload = {}) => events.push(payload) },
    systemRuntime: { sessionId: "s1", dialogProcessId: "dp1" },
  };
  bindTestTurn(runtime, "rewrite");
  const messageId = beginAssistantMessageEventStream(runtime);
  runtime.currentTurnMessages = createTurnMessageStore([
    { role: "assistant", messageId, content: "旧回答" },
  ]);
  result.assistantMessageId = messageId;
  assert.equal(commitAuthoritativeFinalOutput({ result, runtime }), true);
  assert.equal(
    (await emitAuthoritativeFinalMessageContent({ result, runtime }))?.payload?.eventType,
    "authoritative_final_content",
  );
  assert.equal(committedMessageEvents(events).length, 1);
});
