/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";

import { createUserInteractionBridge } from "../../ws/chat-websocket/user-interaction-bridge.js";

test("requires the interaction authority commit port at composition time", () => {
  assert.throws(
    () => createUserInteractionBridge({ pendingInteractionRequests: new Map() }),
    /commitInteractionRequest is required/,
  );
});

test("same canonical interaction identity reuses one authority commit before and after resolution", async () => {
  const committedRequests = [];
  const pendingInteractionRequests = new Map();
  const { userInteractionBridge } = createUserInteractionBridge({
    async commitInteractionRequest(request) {
      committedRequests.push(request);
      return { identity: { eventId: `event-${committedRequests.length}` } };
    },
    translateText: (key) => key,
    pendingInteractionRequests,
  });
  const payload = {
    interactionId: "call_oJrviXV4EN69KefLLl2406DH",
    sessionId: "session-1",
    dialogProcessId: "dialog-1",
    turnScopeId: "turn-1",
    toolName: "user_interaction",
    content: "confirm?",
  };

  const first = userInteractionBridge.requestUserInteraction(payload);
  const duplicatePending = userInteractionBridge.requestUserInteraction(payload);
  assert.equal(first, duplicatePending);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(committedRequests.length, 1);
  assert.equal(pendingInteractionRequests.size, 1);

  const [requestId, requestItem] = pendingInteractionRequests.entries().next().value;
  clearTimeout(requestItem.timer);
  pendingInteractionRequests.delete(requestId);
  requestItem.resolve({ confirmed: true });
  assert.deepEqual(await first, { confirmed: true });

  const duplicateResolved = userInteractionBridge.requestUserInteraction(payload);
  assert.equal(duplicateResolved, first);
  assert.deepEqual(await duplicateResolved, { confirmed: true });
  assert.equal(committedRequests.length, 1);
  assert.equal(committedRequests[0]?.payload?.interactionId, payload.interactionId);
  assert.equal(committedRequests[0]?.payload?.requestId, requestId);
});

test("timeout publishes the canonical failed interaction lifecycle and rejects the request", async () => {
  const committedRequests = [];
  const pendingInteractionRequests = new Map();
  const { userInteractionBridge } = createUserInteractionBridge({
    async commitInteractionRequest(request) {
      committedRequests.push(request);
      return { identity: { eventId: `event-${committedRequests.length}` } };
    },
    translateText: () => "interaction timed out",
    pendingInteractionRequests,
    interactionTimeoutMs: 1,
  });

  const request = userInteractionBridge.requestUserInteraction({
    interactionId: "timeout-call",
    sessionId: "session-timeout",
    dialogProcessId: "dialog-timeout",
    turnScopeId: "turn-timeout",
    toolName: "user_interaction",
  });
  await assert.rejects(request, /interaction timed out/);
  assert.equal(pendingInteractionRequests.size, 0);
  assert.equal(committedRequests.length, 2);
  assert.equal(committedRequests[1].payload.lifecycle, "failed");
  assert.equal(committedRequests[1].payload.resolvedBy, "system");
  assert.equal(committedRequests[1].payload.interactionData.reason, "timeout");
});

test("explicit per-request timeoutMs overrides the bridge default when shorter", async () => {
  const committedRequests = [];
  const pendingInteractionRequests = new Map();
  const { userInteractionBridge } = createUserInteractionBridge({
    async commitInteractionRequest(request) {
      committedRequests.push(request);
      return { identity: { eventId: `event-${committedRequests.length}` } };
    },
    translateText: () => "interaction timed out",
    pendingInteractionRequests,
    interactionTimeoutMs: 60000,
  });

  const request = userInteractionBridge.requestUserInteraction({
    interactionId: "timeout-call-short",
    sessionId: "session-timeout-short",
    dialogProcessId: "dialog-timeout-short",
    turnScopeId: "turn-timeout-short",
    toolName: "user_interaction",
    content: "confirm?",
    timeoutMs: 1,
  });
  await assert.rejects(request, /interaction timed out/);
  assert.equal(committedRequests[0].payload.timeoutMs, 1);
  assert.equal(committedRequests[1].payload.timeoutMs, 1);
});
