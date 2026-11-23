/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import { SessionMessageService } from "../../src/session/services/session-message-service.js";

const identity = { userId: "u1", sessionId: "s1", dialogProcessId: "d1", persistenceContext: {} };

function fixture({ readDialogTurnPage, readTurnPage }) {
  let opens = 0;
  let releases = 0;
  const service = new SessionMessageService({
    now: () => "2026-01-01T00:00:00.000Z",
    sessionRepo: {
      async withSessionLifecycleMutation(userId, sessionId, run) {
        assert.equal(userId, identity.userId);
        assert.equal(sessionId, identity.sessionId);
        return run();
      },
      async requireSessionReader(userId, sessionId, options) {
        assert.equal(userId, identity.userId);
        assert.equal(sessionId, identity.sessionId);
        assert.equal(options.persistenceContext, identity.persistenceContext);
        opens += 1;
        return {
          readDialogTurnPage,
          readTurnPage,
          async [Symbol.asyncDispose]() {
            releases += 1;
          },
        };
      },
    },
  });
  return { service, counts: () => ({ opens, releases }) };
}

test("dialog stream validates its selection and consumer before opening storage", async () => {
  const { service, counts } = fixture({});
  await assert.rejects(
    service.withSessionDialogMessageRecords({ ...identity, dialogProcessId: " " }, () => {}),
  );
  await assert.rejects(service.withSessionDialogMessageRecords(identity, null), TypeError);
  assert.deepEqual(counts(), { opens: 0, releases: 0 });
});

test("dialog stream pages members and messages through one pinned reader", async () => {
  const calls = [];
  const { service, counts } = fixture({
    async readDialogTurnPage({ dialogProcessId, after }) {
      assert.equal(dialogProcessId, "d1");
      calls.push(`dialog:${after}`);
      return { turnScopeIds: [after === 0 ? "t1" : "t2"], cursor: after + 1, hasMore: after === 0 };
    },
    async readTurnPage({ turnScopeId, after }) {
      calls.push(`${turnScopeId}:${after}`);
      return { records: [`${turnScopeId}-${after}`], cursor: after + 1, hasMore: after === 0 };
    },
  });
  const output = await service.withSessionDialogMessageRecords(identity, async (records) => {
    const values = [];
    for await (const record of records) values.push(record);
    return values;
  });
  assert.deepEqual(output, ["t1-0", "t1-1", "t2-0", "t2-1"]);
  assert.deepEqual(calls, ["dialog:0", "t1:0", "t1:1", "dialog:1", "t2:0", "t2:1"]);
  assert.deepEqual(counts(), { opens: 1, releases: 1 });
});

test("early exit closes the stream and reader without loading later pages", async () => {
  let escaped;
  let turnReads = 0;
  const { service, counts } = fixture({
    async readDialogTurnPage() {
      return { turnScopeIds: ["t1", "t2"], cursor: 2, hasMore: true };
    },
    async readTurnPage() {
      turnReads += 1;
      return { records: ["first", "second"], cursor: 2, hasMore: true };
    },
  });
  await service.withSessionDialogMessageRecords(identity, async (records) => {
    escaped = records;
    for await (const record of records) {
      assert.equal(record, "first");
      break;
    }
  });
  assert.equal(turnReads, 1);
  assert.equal((await escaped.next()).done, true);
  assert.deepEqual(counts(), { opens: 1, releases: 1 });
});

test("reader release is guaranteed for missing dialogs, broken membership and consumer errors", async () => {
  const failure = new Error("consumer failed");
  for (const outcome of ["absent", "broken", "consumer"]) {
    const { service, counts } = fixture({
      async readDialogTurnPage() {
        return outcome === "absent" ? null : { turnScopeIds: ["t1"], cursor: 1, hasMore: false };
      },
      async readTurnPage() {
        return outcome === "broken" ? null : { records: ["record"], cursor: 1, hasMore: false };
      },
    });
    const task = service.withSessionDialogMessageRecords(identity, async (records) => {
      for await (const record of records) {
        assert.equal(record, "record");
        throw failure;
      }
    });
    if (outcome === "absent") await task;
    else if (outcome === "broken") await assert.rejects(task, /missing turn/);
    else await assert.rejects(task, failure);
    assert.deepEqual(counts(), { opens: 1, releases: 1 });
  }
});
