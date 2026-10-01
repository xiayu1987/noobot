/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  findPendingInteraction,
  registerPendingInteraction,
  rejectPendingInteractionsForTurn,
  unregisterPendingInteraction,
} from "../../ws/chat-websocket/pending-interaction-registry.js";

function pending(requestId, { ownerUserId = "u1", sessionId = "s1", turnScopeId = "t1" } = {}) {
  const item = { requestId, ownerUserId, sessionId, turnScopeId, rejected: null };
  item.reject = (error) => {
    item.rejected = error;
    unregisterPendingInteraction(item);
  };
  return registerPendingInteraction(item);
}

test("pending interaction is found by requestId independent of the registering connection", () => {
  const item = pending("req-reconnect");
  assert.equal(findPendingInteraction({ requestId: "req-reconnect", ownerUserId: "u1" }), item);
  assert.equal(findPendingInteraction({ requestId: "req-reconnect", ownerUserId: "u2" }), null);
  assert.equal(unregisterPendingInteraction(item), true);
  assert.equal(findPendingInteraction({ requestId: "req-reconnect", ownerUserId: "u1" }), null);
});

test("turn rejection only rejects interactions of the exact owner/session/turn", () => {
  const target = pending("req-a");
  const otherTurn = pending("req-b", { turnScopeId: "t2" });
  const otherOwner = pending("req-c", { ownerUserId: "u2" });
  const error = new Error("aborted");
  assert.equal(
    rejectPendingInteractionsForTurn(
      { ownerUserId: "u1", sessionId: "s1", turnScopeId: "t1" },
      error,
    ),
    1,
  );
  assert.equal(target.rejected, error);
  assert.equal(otherTurn.rejected, null);
  assert.equal(otherOwner.rejected, null);
  assert.equal(rejectPendingInteractionsForTurn({ ownerUserId: "u1", sessionId: "s1" }, error), 0);
  unregisterPendingInteraction(otherTurn);
  unregisterPendingInteraction(otherOwner);
});

test("registration requires requestId and owner", () => {
  assert.throws(() => registerPendingInteraction({ requestId: "x" }));
  assert.throws(() => registerPendingInteraction({ ownerUserId: "u1" }));
});
