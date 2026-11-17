/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import { getSessionTurns } from "../../src/session/services/session-message-service/message-queries.js";

const identity = { userId: "user", sessionId: "session", persistenceContext: {} };

test("scoped message queries use the selected turn view and preserve dialog ownership", async () => {
  const owned = { messageUid: "owned", turnScopeId: "turn", dialogProcessId: "dialog" };
  const calls = [];
  const service = {
    sessionRepo: {
      async requireById() {
        throw new Error("full session reads are forbidden");
      },
      async requireTurnView(...args) {
        calls.push(args);
        return {
          session: { messages: [owned, { messageUid: "other", dialogProcessId: "other-dialog" }] },
        };
      },
    },
  };
  assert.deepEqual(
    await getSessionTurns.call(service, {
      ...identity,
      turnScopeId: "turn",
      dialogProcessId: "dialog",
    }),
    [owned],
  );
  assert.deepEqual(calls, [
    [
      "user",
      "session",
      {
        turnScopeIds: ["turn"],
        persistenceContext: identity.persistenceContext,
      },
    ],
  ]);
});

test("incomplete scoped query identities fail before repository access", async () => {
  const service = {
    sessionRepo: new Proxy(
      {},
      {
        get() {
          throw new Error("repository was accessed");
        },
      },
    ),
  };
  for (const selection of [
    { turnScopeId: "turn" },
    { dialogProcessId: "dialog" },
    { turnScopeId: "", dialogProcessId: "dialog" },
  ])
    await assert.rejects(getSessionTurns.call(service, { ...identity, ...selection }), {
      code: "SESSION_TURN_LOOKUP_KEY_INVALID",
    });
});

test("unscoped message queries retain explicit full export behavior", async () => {
  const messages = [{ messageUid: "all" }];
  const service = {
    sessionRepo: {
      async requireById(userId, sessionId, options) {
        assert.equal(userId, identity.userId);
        assert.equal(sessionId, identity.sessionId);
        assert.equal(options.persistenceContext, identity.persistenceContext);
        return { messages };
      },
    },
  };
  assert.equal(await getSessionTurns.call(service, identity), messages);
});
