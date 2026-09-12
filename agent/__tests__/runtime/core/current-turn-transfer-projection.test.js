/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";

import { createCurrentTurnMessagesStore } from "../../../src/runtime/turn/current-turn-ledger.js";
import { initializeCurrentTurnMessageEventProjection } from "../../../src/events/current-turn-message-event-projection.js";
import { createEventEnvelope, EVENT_FAMILY } from "@noobot/event-protocol";
import { MESSAGE_EVENT_WIRE_EVENT } from "@noobot/event-protocol/message-event";

function messageEvent(eventId, eventType, sequence, payload = {}) {
  return createEventEnvelope({
    family: EVENT_FAMILY.MESSAGE_TIMELINE,
    identity: {
      eventId,
      eventType: MESSAGE_EVENT_WIRE_EVENT,
      sessionId: "session-1",
      turnScopeId: "turn-1",
      messageId: "message-1",
    },
    causality: {},
    ordering: { domain: "message-event", scopeId: "message-1", sequence },
    producer: { type: "agent", id: "agent-1" },
    occurredAt: `2026-09-05T03:39:0${sequence}.000Z`,
    payload: {
      eventType,
      presentationMessageId: "presentation-1",
      dialogProcessId: "dialog-1",
      ...payload,
    },
  });
}

test("tool result transfer envelopes project onto the canonical assistant turn", async () => {
  const store = createCurrentTurnMessagesStore([
    {
      role: "assistant",
      messageUid: "assistant-1",
      toolTimeline: [],
    },
  ]);
  const runtime = { currentTurnMessages: store, systemRuntime: {} };
  initializeCurrentTurnMessageEventProjection(runtime);
  const transferEnvelope = {
    protocol: "noobot.semantic-transfer",
    version: 2,
    transferId: "transfer-1",
    messageId: "message-1",
  };

  await runtime.projectCurrentTurnMessageEvent(
    messageEvent("event-1", "tool_call_end", 1, {
      toolCallId: "call-1",
      result: "done",
      success: true,
      transferEnvelopes: [transferEnvelope],
    }),
  );
  await runtime.projectCurrentTurnMessageEvent(
    messageEvent("event-2", "tool_call_end", 2, {
      toolCallId: "call-1",
      result: "done",
      success: true,
      transferEnvelopes: [transferEnvelope],
    }),
  );

  assert.deepEqual(store.toArray()[0].transferEnvelopes, [transferEnvelope]);
});

test("main model content projects once and awaits its durable checkpoint", async () => {
  const store = createCurrentTurnMessagesStore([
    { role: "assistant", messageUid: "assistant-1", activityTimeline: [] },
  ]);
  let persisted = 0;
  const runtime = {
    currentTurnMessages: store,
    systemRuntime: {},
    persistCurrentTurnMessages: async () => {
      persisted += 1;
    },
  };
  initializeCurrentTurnMessageEventProjection(runtime);
  const envelope = messageEvent("activity-1", "main_model_content", 1, {
    text: "先确认当前真实状态。",
  });

  await runtime.projectCurrentTurnMessageEvent(envelope);
  await runtime.projectCurrentTurnMessageEvent(envelope);

  assert.equal(persisted, 1);
  assert.equal(store.toArray()[0].activityTimeline.length, 1);
  assert.deepEqual(store.toArray()[0].activityTimeline[0], {
    eventId: "activity-1",
    eventType: "main_model_content",
    text: "先确认当前真实状态。",
    activityKind: "",
    purpose: "",
    pluginFlow: "",
    chain: "",
    relayCorrelationId: "",
    sequence: 1,
    sequenceScopeId: "message-1",
    sequenceDomain: "message-event",
    authority: "authoritative",
    timestamp: "2026-09-05T03:39:01.000Z",
    sessionId: "session-1",
    dialogProcessId: "dialog-1",
    turnScopeId: "turn-1",
    messageId: "message-1",
    presentationMessageId: "presentation-1",
  });
});
