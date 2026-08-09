/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";

import { createCurrentTurnMessagesStore } from "../../../src/context/session/current-turn-store.js";
import { initializeCurrentTurnMessageEventProjection } from "../../../src/events/current-turn-message-event-projection.js";

test("tool result transfer envelopes project onto the canonical assistant turn", () => {
  const store = createCurrentTurnMessagesStore([{
    role: "assistant",
    messageUid: "assistant-1",
    toolTimeline: [],
  }]);
  const runtime = { currentTurnMessages: store, systemRuntime: {} };
  initializeCurrentTurnMessageEventProjection(runtime);
  const transferEnvelope = {
    protocol: "noobot.semantic-transfer",
    version: 2,
    transferId: "transfer-1",
    messageId: "message-1",
  };

  runtime.projectCurrentTurnMessageEvent({
    eventId: "event-1",
    eventType: "tool_call_end",
    toolCallId: "call-1",
    transferEnvelopes: [transferEnvelope],
  });
  runtime.projectCurrentTurnMessageEvent({
    eventId: "event-2",
    eventType: "tool_call_end",
    toolCallId: "call-1",
    transferEnvelopes: [transferEnvelope],
  });

  assert.deepEqual(store.toArray()[0].transferEnvelopes, [transferEnvelope]);
});
