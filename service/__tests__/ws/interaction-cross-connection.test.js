/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import { createInteractionResponseCommand } from "@noobot/agent-transport-protocol";

import { createUserInteractionBridge } from "../../ws/chat-websocket/user-interaction-bridge.js";
import { createMessageQueryHandlers } from "../../ws/chat-websocket/message-query-handlers.js";
import { findPendingInteraction } from "../../ws/chat-websocket/pending-interaction-registry.js";

const OWNER = "user-cross";

function responseCommand(commandId, sessionId, turnScopeId, requestId, response) {
  return createInteractionResponseCommand({
    commandId,
    identity: {
      sessionId,
      parentSessionId: "",
      dialogProcessId: `dialog-${turnScopeId}`,
      parentDialogProcessId: "",
      turnScopeId,
    },
    interaction: { requestId, response },
  });
}

function authority(sessionId, turnScopeId) {
  return {
    session: { userId: OWNER, sessionId, parentSessionId: "" },
    turn: { dialogProcessId: `dialog-${turnScopeId}`, turnScopeId },
    persistenceScope: null,
  };
}

function createOriginConnection() {
  const committed = [];
  const bridge = createUserInteractionBridge({
    ownerUserId: OWNER,
    translateText: (key) => key,
    async commitInteractionRequest(request) {
      committed.push(request);
      return { identity: { eventId: `event-${committed.length}` } };
    },
  });
  return { ...bridge, committed };
}

async function waitForCommit(committed) {
  const deadline = Date.now() + 1000;
  while (!committed.length && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  const requestId = committed[0]?.payload?.requestId;
  assert.ok(requestId, "interaction request was not committed");
  return requestId;
}

test("a new connection answers an interaction registered by a detached connection", async () => {
  const origin = createOriginConnection();
  const pending = origin.userInteractionBridge.requestUserInteraction({
    interactionId: "cross-connection",
    authority: authority("session-cross", "turn-cross"),
    toolName: "user_interaction",
    content: "confirm?",
  });
  const requestId = await waitForCommit(origin.committed);

  const receipts = [];
  const { handleInteractionResponse } = createMessageQueryHandlers({
    state: {},
    authInfo: { userId: OWNER },
    sendEvent: (event, data) => receipts.push({ event, data }),
    translateText: (key) => key,
    resolveBot: () => ({}),
    canonicalRunOwnerId: OWNER,
  });
  handleInteractionResponse(
    responseCommand("answer-1", "session-cross", "turn-cross", requestId, { value: "yes" }),
  );

  assert.deepEqual(await pending, { value: "yes" });
  assert.equal(receipts.length, 0);
  assert.equal(findPendingInteraction({ requestId, ownerUserId: OWNER }), null);
});

test("another owner cannot answer the interaction", async () => {
  const origin = createOriginConnection();
  const pending = origin.userInteractionBridge.requestUserInteraction({
    interactionId: "foreign-owner",
    authority: authority("session-foreign", "turn-foreign"),
    toolName: "user_interaction",
  });
  const requestId = await waitForCommit(origin.committed);
  const receipts = [];
  const { handleInteractionResponse } = createMessageQueryHandlers({
    state: {},
    authInfo: { userId: "intruder" },
    sendEvent: (event, data) => receipts.push({ event, data }),
    translateText: (key) => key,
    resolveBot: () => ({}),
    canonicalRunOwnerId: "intruder",
  });
  handleInteractionResponse(
    responseCommand("answer-2", "session-foreign", "turn-foreign", requestId, {}),
  );
  assert.equal(receipts.length, 1);
  assert.equal(JSON.stringify(receipts[0]).includes("interaction_not_found"), true);
  assert.ok(findPendingInteraction({ requestId, ownerUserId: OWNER }));
  origin.rejectTurnInteractions(
    { sessionId: "session-foreign", turnScopeId: "turn-foreign" },
    new Error("cleanup"),
  );
  await assert.rejects(pending, /cleanup/);
});

test("aborting a turn rejects only that turn's pending interactions", async () => {
  const origin = createOriginConnection();
  const aborted = origin.userInteractionBridge.requestUserInteraction({
    interactionId: "abort-target",
    authority: authority("session-abort", "turn-abort"),
    toolName: "user_interaction",
  });
  const abortedId = await waitForCommit(origin.committed);
  const survivor = createOriginConnection();
  const kept = survivor.userInteractionBridge.requestUserInteraction({
    interactionId: "abort-survivor",
    authority: authority("session-abort", "turn-other"),
    toolName: "user_interaction",
  });
  const keptId = await waitForCommit(survivor.committed);

  origin.rejectTurnInteractions(
    { sessionId: "session-abort", turnScopeId: "turn-abort" },
    new Error("socket closed"),
  );
  await assert.rejects(aborted, /socket closed/);
  assert.equal(findPendingInteraction({ requestId: abortedId, ownerUserId: OWNER }), null);
  const keptItem = findPendingInteraction({ requestId: keptId, ownerUserId: OWNER });
  assert.ok(keptItem);
  keptItem.resolve({ ok: true });
  assert.deepEqual(await kept, { ok: true });
});
