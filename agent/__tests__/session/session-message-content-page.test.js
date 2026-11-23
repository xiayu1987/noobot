/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import { SessionMessageService } from "../../src/session/services/session-message-service.js";

const selection = {
  messageUid: "message",
  byteOffset: 0,
  maxBytes: 10,
  expectedContentReference: null,
};
const identity = { userId: "user", sessionId: "session", persistenceContext: {} };

test("content page service validates before opening a reader", async () => {
  const service = new SessionMessageService({
    now: () => "2026-01-01T00:00:00.000Z",
    sessionRepo: {
      requireSessionReader() {
        assert.fail("invalid ranges must not open storage");
      },
    },
  });
  for (const invalid of [{ maxBytes: 0 }, { byteOffset: 1 }, { messageUid: " " }])
    await assert.rejects(
      service.getSessionMessageContentPage({ ...identity, ...selection, ...invalid }),
      TypeError,
    );
});

test("content page service releases readers on success, missing data and read failure", async () => {
  for (const outcome of [{ contentReference: "version" }, null, new Error("read failed")]) {
    let releases = 0;
    const service = new SessionMessageService({
      now: () => "2026-01-01T00:00:00.000Z",
      sessionRepo: {
        async requireSessionReader(userId, sessionId, options) {
          assert.equal(userId, identity.userId);
          assert.equal(sessionId, identity.sessionId);
          assert.equal(options.persistenceContext, identity.persistenceContext);
          return {
            async readMessageContentPage(options) {
              assert.deepEqual(options, selection);
              if (outcome instanceof Error) throw outcome;
              return outcome;
            },
            async [Symbol.asyncDispose]() {
              releases += 1;
            },
          };
        },
      },
    });
    const read = service.getSessionMessageContentPage({ ...identity, ...selection });
    if (outcome === null)
      await assert.rejects(read, { code: "SESSION_MESSAGE_NOT_FOUND", statusCode: 404 });
    else if (outcome instanceof Error) await assert.rejects(read, outcome);
    else assert.equal(await read, outcome);
    assert.equal(releases, 1);
  }
});
