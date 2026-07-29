/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";

import { createUserInteractionBridge } from "../../ws/chat-websocket/user-interaction-bridge.js";

test("same canonical interaction identity reuses one request before and after resolution", async () => {
  const sentEvents = [];
  const pendingInteractionRequests = new Map();
  const { userInteractionBridge } = createUserInteractionBridge({
    sendEvent(event, data) {
      sentEvents.push({ event, data });
    },
    translateText: (key) => key,
    pendingInteractionRequests,
  });
  const payload = {
    interactionId: "call_oJrviXV4EN69KefLLl2406DH",
    sessionId: "session-1",
    dialogProcessId: "dialog-1",
    toolName: "user_interaction",
    content: "confirm?",
  };

  const first = userInteractionBridge.requestUserInteraction(payload);
  const duplicatePending = userInteractionBridge.requestUserInteraction(payload);
  assert.equal(first, duplicatePending);
  assert.equal(sentEvents.length, 1);
  assert.equal(pendingInteractionRequests.size, 1);

  const [requestId, requestItem] = pendingInteractionRequests.entries().next().value;
  clearTimeout(requestItem.timer);
  pendingInteractionRequests.delete(requestId);
  requestItem.resolve({ confirmed: true });
  assert.deepEqual(await first, { confirmed: true });

  const duplicateResolved = userInteractionBridge.requestUserInteraction(payload);
  assert.equal(duplicateResolved, first);
  assert.deepEqual(await duplicateResolved, { confirmed: true });
  assert.equal(sentEvents.length, 1);
  assert.equal(sentEvents[0]?.data?.interactionId, payload.interactionId);
  assert.equal(sentEvents[0]?.data?.requestId, requestId);
});
