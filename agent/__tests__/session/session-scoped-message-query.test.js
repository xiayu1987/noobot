/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import { getSessionTurnMessagePage } from "../../src/session/services/session-message-service/message-queries.js";

const identity = { userId: "user", sessionId: "session", persistenceContext: {} };

test("scoped message queries read one page and release the snapshot", async () => {
  const owned = { messageUid: "owned", turnScopeId: "turn", dialogProcessId: "dialog" };
  const calls = [];
  const page = { records: [{ message: owned }], nextCursor: null };
  const service = {
    sessionRepo: {
      async requireSessionReader(...args) {
        calls.push(args);
        return {
          async readScopedTurnMessagePage(selection) {
            calls.push(selection);
            return page;
          },
          async [Symbol.asyncDispose]() {
            calls.push("released");
          },
        };
      },
    },
  };
  assert.deepEqual(
    await getSessionTurnMessagePage.call(service, {
      ...identity,
      turnScopeId: "turn",
      dialogProcessId: "dialog",
      cursor: null,
      limit: 1,
      maxBytes: 1024,
    }),
    page,
  );
  assert.deepEqual(calls, [
    [
      "user",
      "session",
      {
        persistenceContext: identity.persistenceContext,
      },
    ],
    {
      lookupKey: { turnScopeId: "turn", dialogProcessId: "dialog" },
      cursor: null,
      limit: 1,
      maxBytes: 1024,
    },
    "released",
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
    {},
    { turnScopeId: "turn" },
    { dialogProcessId: "dialog" },
    { turnScopeId: "", dialogProcessId: "dialog" },
  ])
    await assert.rejects(getSessionTurnMessagePage.call(service, { ...identity, ...selection }), {
      code: "SESSION_TURN_LOOKUP_KEY_INVALID",
    });
});
