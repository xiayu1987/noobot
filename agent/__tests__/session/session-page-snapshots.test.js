/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  encodeSessionPageSnapshotCursor,
  sessionPageWorkspaceScope,
  treeSessionPageScope,
} from "@noobot/session-protocol/message-read-budget";

import { deferred, fixture } from "./session-page-snapshots.test-helpers.js";

test("explicit release is idempotent and rejects foreign snapshot identities", async (t) => {
  const f = fixture(t);
  const { nextCursor: cursor } = await f.request();
  for (let index = 0; index < f.identity.length; index += 1) {
    const identity = [...f.identity];
    identity[index] = "foreign";
    await assert.rejects(f.snapshots.releaseCursor({ identity, cursor }), {
      code: "SESSION_PAGE_SNAPSHOT_EXPIRED",
    });
  }
  assert.equal(f.work.closes, 0);
  const selection = { identity: f.identity, cursor };
  assert.deepEqual(await f.snapshots.releaseCursor(selection), { released: true });
  assert.deepEqual(await f.snapshots.releaseCursor(selection), { released: false });
  assert.equal(f.work.closes, 1);
  assert.equal(f.work.opens, 1);
  await assert.rejects(f.request(cursor), { code: "SESSION_PAGE_SNAPSHOT_EXPIRED" });
});

test("explicit release drains active reads and prevents further continuation admission", async (t) => {
  const f = fixture(t);
  const { nextCursor: cursor } = await f.request();
  const gate = deferred();
  const started = deferred();
  const reading = f.request(cursor, {
    read: async () => {
      started.resolve();
      await gate.promise;
      return { exists: true, nextCursor: { after: 2, scope: "snapshot-1" } };
    },
  });
  await started.promise;
  const selection = { identity: f.identity, cursor };
  const releases = [f.snapshots.releaseCursor(selection), f.snapshots.releaseCursor(selection)];
  assert.equal(f.work.closes, 0);
  await assert.rejects(f.request(cursor), { code: "SESSION_PAGE_SNAPSHOT_EXPIRED" });
  const rejected = assert.rejects(reading, { code: "SESSION_PAGE_SNAPSHOT_EXPIRED" });
  gate.resolve();
  await Promise.all([...releases, rejected]);
  assert.equal(f.work.closes, 1);
  assert.equal(f.snapshots.entries.size, 0);
});

test("explicit release revokes an in-flight final page", async (t) => {
  const f = fixture(t);
  const { nextCursor: cursor } = await f.request();
  const gate = deferred();
  const started = deferred();
  const reading = f.request(cursor, {
    read: async (reader, storageCursor) => {
      started.resolve();
      await gate.promise;
      return f.read(reader, storageCursor);
    },
  });
  await started.promise;
  const rejected = assert.rejects(reading, { code: "SESSION_PAGE_SNAPSHOT_EXPIRED" });
  const released = f.snapshots.releaseCursor({ identity: f.identity, cursor });
  gate.resolve();
  await rejected;
  assert.deepEqual(await released, { released: true });
  assert.equal(f.work.closes, 1);
});

test("scope release revokes an in-flight final page without closing another session", async (t) => {
  const f = fixture(t, { readers: 3, idleMs: 1000, maxAgeMs: 5000 });
  const scope = f.identity.slice(0, 2);
  const other = [scope[0], "other-session", ...f.identity.slice(2)];
  const branch = [scope[0], "deleted-branch", ...f.identity.slice(2)];
  const { nextCursor: cursor } = await f.request();
  const { nextCursor: otherCursor } = await f.request(null, { identity: other });
  const { nextCursor: branchCursor } = await f.request(null, { identity: branch });
  const gate = deferred();
  const started = deferred();
  const reading = f.request(cursor, {
    read: async (reader, storageCursor) => {
      started.resolve();
      await gate.promise;
      return f.read(reader, storageCursor);
    },
  });
  await started.promise;
  const rejected = assert.rejects(reading, { code: "SESSION_PAGE_SNAPSHOT_EXPIRED" });
  const scopes = [scope, branch.slice(0, 2)];
  assert.equal(f.work.closes, 0);
  const releases = [f.snapshots.releaseScopes(scopes), f.snapshots.releaseScopes(scopes)];
  try {
    assert.equal(f.work.closes, 1);
    await assert.rejects(f.request(cursor), { code: "SESSION_PAGE_SNAPSHOT_EXPIRED" });
    await assert.rejects(f.request(branchCursor, { identity: branch }), {
      code: "SESSION_PAGE_SNAPSHOT_EXPIRED",
    });
  } finally {
    gate.resolve();
  }
  await Promise.all([...releases, rejected]);
  assert.equal(f.work.closes, 2);
  assert.deepEqual(await f.snapshots.releaseCursor({ identity: f.identity, cursor }), {
    released: false,
  });
  assert.equal((await f.request(otherCursor, { identity: other })).generation, 1);
  assert.equal(f.work.closes, 3);
});

test("scope release drains an opening reader without starting its first page", async (t) => {
  const f = fixture(t);
  const gate = deferred();
  const opening = f.request(null, {
    open: async () => {
      await gate.promise;
      return f.open();
    },
  });
  const rejected = assert.rejects(opening, { code: "SESSION_PAGE_SNAPSHOT_EXPIRED" });
  const release = f.snapshots.releaseScopes([f.identity.slice(0, 2)]);
  gate.resolve();
  await Promise.all([release, rejected]);
  assert.deepEqual(f.work, { opens: 1, closes: 1, reads: [] });
  assert.equal(f.snapshots.entries.size, 0);
});

test("scope release revokes a final page waiting for its reader to close", async (t) => {
  const f = fixture(t);
  const closing = deferred();
  const gate = deferred();
  const { nextCursor: cursor } = await f.request(null, {
    open: async () => ({
      generation: 1,
      async close() {
        closing.resolve();
        await gate.promise;
        f.work.closes += 1;
      },
    }),
  });
  const rejected = assert.rejects(f.request(cursor), { code: "SESSION_PAGE_SNAPSHOT_EXPIRED" });
  await closing.promise;
  const release = f.snapshots.releaseScopes([f.identity.slice(0, 2)]);
  gate.resolve();
  await Promise.all([release, rejected]);
  assert.equal(f.work.closes, 1);
});

test("explicit release failure remains visible and the owner can be released on retry", async (t) => {
  const f = fixture(t);
  const failure = new Error("close failed");
  let failing = true;
  const { nextCursor: cursor } = await f.request(null, {
    open: async () => ({
      close: async () => {
        if (failing) throw failure;
        f.work.closes += 1;
      },
    }),
  });
  const selection = { identity: f.identity, cursor };
  await assert.rejects(f.snapshots.releaseCursor(selection), (cause) => cause === failure);
  assert.equal(f.snapshots.entries.size, 1);
  await assert.rejects(f.request(), (cause) => cause === failure);
  failing = false;
  assert.deepEqual(await f.snapshots.releaseCursor(selection), { released: true });
  assert.equal(f.work.closes, 1);
  assert.equal(f.snapshots.entries.size, 0);
  await f.request();
  assert.equal(f.work.opens, 1);
});

test("expiry retries a failed first-page cleanup even when no cursor was issued", async (t) => {
  const f = fixture(t);
  const failure = new Error("first-page reader close failed");
  let failing = true;
  const open = async () => ({
    async close() {
      if (failing) throw failure;
      f.work.closes += 1;
    },
  });
  try {
    await assert.rejects(
      f.request(null, { open, read: async () => ({ nextCursor: null }) }),
      (cause) => cause === failure,
    );
    await assert.rejects(f.request(), (cause) => cause === failure);
    f.advance(999);
    await f.snapshots.expire();
    assert.equal(f.work.closes, 0);
    f.advance(1000);
    await assert.rejects(
      f.snapshots.expire(),
      (cause) => cause instanceof AggregateError && cause.errors[0] === failure,
    );
    assert.equal(f.snapshots.entries.size, 1);
    await assert.rejects(f.request(), (cause) => cause === failure);
    failing = false;
    f.advance(1999);
    await f.snapshots.expire();
    assert.equal(f.work.closes, 0);
    f.advance(2000);
    await f.snapshots.expire();
    assert.equal(f.work.closes, 1);
    assert.equal(f.snapshots.entries.size, 0);
    await f.request();
    assert.equal(f.work.opens, 1);
  } finally {
    failing = false;
  }
});

test("failed scope release blocks that workspace without blocking unrelated pages", async (t) => {
  const f = fixture(t, { readers: 3, idleMs: 1000, maxAgeMs: 5000 });
  const failure = new Error("workspace reader close failed");
  let failing = true;
  const scope = sessionPageWorkspaceScope("workspace-a");
  const identity = treeSessionPageScope("workspace-a", "session");
  const sibling = treeSessionPageScope("workspace-a", "sibling");
  const other = treeSessionPageScope("workspace-b", "session");
  const { nextCursor: otherCursor } = await f.request(null, { identity: other });
  await f.request(null, {
    identity,
    open: async () => ({
      close: async () => {
        if (failing) throw failure;
        f.work.closes += 1;
      },
    }),
  });
  try {
    await assert.rejects(
      f.snapshots.releaseScopes([scope]),
      (error) => error instanceof AggregateError && error.errors[0] === failure,
    );
    await assert.rejects(f.request(null, { identity: sibling }), (error) => error === failure);
    assert.equal((await f.request(otherCursor, { identity: other })).nextCursor, null);
    assert.notEqual((await f.request(null, { identity: other })).nextCursor, null);
  } finally {
    failing = false;
    await f.snapshots.releaseScopes([scope]);
  }
  assert.notEqual((await f.request(null, { identity: sibling })).nextCursor, null);
});

test("release recovery keeps admission closed until every failed owner is released", async (t) => {
  const f = fixture(t);
  const failures = [new Error("first owner"), new Error("second owner")];
  const failing = [true, true];
  const cursors = [];
  for (let index = 0; index < failures.length; index += 1) {
    const page = await f.request(null, {
      open: async () => ({
        close: async () => {
          if (failing[index]) throw failures[index];
          f.work.closes += 1;
        },
      }),
    });
    cursors.push(page.nextCursor);
  }
  f.advance(1000);
  await assert.rejects(
    f.snapshots.expire(),
    (cause) =>
      cause instanceof AggregateError &&
      cause.errors.every((error, index) => error === failures[index]),
  );
  failing[0] = false;
  await f.snapshots.releaseCursor({ identity: f.identity, cursor: cursors[0] });
  await assert.rejects(f.request(), (cause) => cause === failures[1]);
  failing[1] = false;
  await f.snapshots.releaseCursor({ identity: f.identity, cursor: cursors[1] });
  await f.request();
  assert.equal(f.work.opens, 1);
});

test("continuations reuse the original reader despite concurrent writes and release on the last page", async (t) => {
  const f = fixture(t);
  const first = await f.request();
  f.write();
  const last = await f.request(first.nextCursor);
  assert.equal(last.generation, 1);
  assert.equal(last.nextCursor, null);
  assert.deepEqual(f.work, {
    opens: 1,
    closes: 1,
    reads: [null, { after: 1, scope: "snapshot-1" }],
  });
  assert.equal(f.snapshots.entries.size, 0);
  await assert.rejects(f.request(first.nextCursor), { code: "SESSION_PAGE_SNAPSHOT_EXPIRED" });
  assert.equal(f.work.opens, 1);
});

test("retained cursors cannot cross user, session, placement or turn boundaries", async (t) => {
  const f = fixture(t);
  const first = await f.request();
  for (let index = 0; index < f.identity.length; index += 1) {
    const identity = [...f.identity];
    identity[index] = "foreign";
    await assert.rejects(f.request(first.nextCursor, { identity }), {
      code: "SESSION_PAGE_SNAPSHOT_EXPIRED",
    });
  }
  assert.equal(f.work.opens, 1);
  assert.equal(f.work.closes, 0);
  await f.request(first.nextCursor);
  assert.equal(f.work.closes, 1);
});

test("reader admission reserves capacity before awaiting open and never evicts a live snapshot", async (t) => {
  const f = fixture(t, { readers: 1, idleMs: 1000, maxAgeMs: 5000 });
  const gate = deferred();
  const opening = f.request(null, {
    open: async () => {
      await gate.promise;
      return f.open();
    },
  });
  await assert.rejects(f.request(), { code: "SESSION_PAGE_SNAPSHOT_CAPACITY" });
  gate.resolve();
  const first = await opening;
  await assert.rejects(f.request(), { code: "SESSION_PAGE_SNAPSHOT_CAPACITY" });
  await f.request(first.nextCursor);
  await f.request();
  assert.equal(f.work.opens, 2);
});

test("expiry releases idle readers, rejects old cursors and does not reopen them", async (t) => {
  const f = fixture(t);
  const first = await f.request();
  f.advance(1000);
  await f.snapshots.expire();
  assert.equal(f.work.closes, 1);
  await assert.rejects(f.request(first.nextCursor), {
    code: "SESSION_PAGE_SNAPSHOT_EXPIRED",
    statusCode: 410,
  });
  assert.equal(f.work.opens, 1);
});

test("expiry and shutdown wait for in-flight page reads", async (t) => {
  const f = fixture(t);
  const first = await f.request();
  const gate = deferred();
  const started = deferred();
  const reading = f.request(first.nextCursor, {
    read: async (reader, cursor) => {
      started.resolve();
      await gate.promise;
      return f.read(reader, cursor);
    },
  });
  await started.promise;
  f.advance(2000);
  await f.snapshots.expire();
  assert.equal(f.work.closes, 0);
  let closed = false;
  const closing = f.snapshots.close().then(() => {
    closed = true;
  });
  await Promise.resolve();
  assert.equal(closed, false);
  gate.resolve();
  await reading;
  await closing;
  assert.equal(f.work.closes, 1);
  await assert.rejects(f.request(), { code: "SESSION_READER_CLOSED" });
});

test("concurrent final-page requests share the same reader and one release", async (t) => {
  const f = fixture(t);
  const first = await f.request();
  const responses = await Promise.all([f.request(first.nextCursor), f.request(first.nextCursor)]);
  assert.deepEqual(
    responses.map((page) => page.generation),
    [1, 1],
  );
  assert.equal(f.work.opens, 1);
  assert.equal(f.work.closes, 1);
});

test("read failures and malformed results close the reader; open failure frees admission", async (t) => {
  const f = fixture(t);
  const failure = new Error("read failed");
  await assert.rejects(
    f.request(null, {
      read: async () => {
        throw failure;
      },
    }),
    (cause) => cause === failure,
  );
  assert.equal(f.work.closes, 1);
  await assert.rejects(
    f.request(null, {
      open: async () => {
        throw failure;
      },
    }),
    (cause) => cause === failure,
  );
  assert.equal(f.snapshots.entries.size, 0);
});

test("cursor encoding failures release the reader and restore admission immediately", async (t) => {
  const f = fixture(t, { readers: 1, idleMs: 1000, maxAgeMs: 5000 });
  await assert.rejects(
    f.request(null, {
      read: async () => ({ exists: true, nextCursor: { after: -1, scope: "invalid" } }),
    }),
    TypeError,
  );
  assert.equal(f.work.closes, 1);
  assert.equal(f.snapshots.entries.size, 0);
  await f.request();
  assert.equal(f.work.opens, 2);
});

test("failed reader release is visible and shutdown retries the retained owner", async (t) => {
  const f = fixture(t);
  const failure = new Error("release failed");
  let fail = true;
  await f.request(null, {
    open: async () => ({
      close: async () => {
        if (fail) throw failure;
        f.work.closes += 1;
      },
    }),
  });
  await assert.rejects(f.snapshots.close(), AggregateError);
  assert.equal(f.snapshots.entries.size, 1);
  fail = false;
  await f.snapshots.close();
  assert.equal(f.work.closes, 1);
  assert.equal(f.snapshots.entries.size, 0);
});

test("unknown or malformed continuations reject before acquiring storage", async (t) => {
  const f = fixture(t);
  for (const cursor of [
    { after: 1, scope: "not-json" },
    { after: 1, scope: "[]" },
  ])
    await assert.rejects(f.request(cursor), TypeError);
  await assert.rejects(
    f.request(encodeSessionPageSnapshotCursor("unknown", { after: 1, scope: "original" })),
    { code: "SESSION_PAGE_SNAPSHOT_EXPIRED" },
  );
  assert.equal(f.work.opens, 0);
});

test("all rejection values preserve their identity and free reader admission", async (t) => {
  const f = fixture(t, { readers: 1, idleMs: 1000, maxAgeMs: 5000 });
  for (const failure of [undefined, null, false, 0, ""]) {
    await assert.rejects(f.request(null, { read: () => Promise.reject(failure) }), (cause) =>
      Object.is(cause, failure),
    );
    assert.equal(f.snapshots.entries.size, 0);
    await assert.rejects(f.request(null, { open: () => Promise.reject(failure) }), (cause) =>
      Object.is(cause, failure),
    );
    assert.equal(f.snapshots.entries.size, 0);
  }
  assert.equal(f.work.opens, 5);
  assert.equal(f.work.closes, 5);
});

test("explicit absence releases the reader; missing continuation is invalid", async (t) => {
  const f = fixture(t, { readers: 1, idleMs: 1000, maxAgeMs: 5000 });
  assert.equal(await f.request(null, { read: async () => null }), null);
  assert.equal(f.work.closes, 1);
  for (const response of [undefined, {}]) {
    await assert.rejects(f.request(null, { read: async () => response }), TypeError);
    assert.equal(f.snapshots.entries.size, 0);
  }
  assert.equal(f.work.closes, 3);
});

test("an in-flight page cannot return a continuation after another request retires its snapshot", async (t) => {
  const f = fixture(t);
  const first = await f.request();
  const started = deferred();
  const gate = deferred();
  const reading = f.request(first.nextCursor, {
    read: async (reader) => {
      started.resolve();
      await gate.promise;
      return {
        exists: true,
        generation: reader.generation,
        nextCursor: { after: 2, scope: "snapshot-1" },
      };
    },
  });
  await started.promise;
  const terminal = f.request(first.nextCursor);
  await new Promise(setImmediate);
  assert.equal(f.work.closes, 0);
  const rejected = assert.rejects(reading, { code: "SESSION_PAGE_SNAPSHOT_EXPIRED" });
  gate.resolve();
  await Promise.all([terminal, rejected]);
  assert.equal(f.work.closes, 1);
  assert.equal(f.snapshots.entries.size, 0);
});

test("read and release failures remain visible together and shutdown retries release", async (t) => {
  const f = fixture(t);
  const cleanupFailure = new Error("release failed");
  let fail = true;
  await assert.rejects(
    f.request(null, {
      open: async () => ({
        close: async () => {
          if (fail) throw cleanupFailure;
          f.work.closes += 1;
        },
      }),
      read: () => Promise.reject(null),
    }),
    (cause) =>
      cause instanceof AggregateError &&
      cause.errors[0] === null &&
      cause.errors[1] === cleanupFailure,
  );
  assert.equal(f.snapshots.entries.size, 1);
  fail = false;
  await f.snapshots.close();
  assert.equal(f.work.closes, 1);
  assert.equal(f.snapshots.entries.size, 0);
});

test("release rejection values close admission until explicit shutdown releases the owner", async (t) => {
  for (const failure of [undefined, null, false, 0, ""]) {
    const f = fixture(t);
    let failing = true;
    await assert.rejects(
      f.request(null, {
        open: async () => ({
          close: async () => {
            if (failing) throw failure;
            f.work.closes += 1;
          },
        }),
        read: async () => ({ exists: true, nextCursor: null }),
      }),
      (cause) => Object.is(cause, failure),
    );
    assert.equal(f.snapshots.entries.size, 1);
    await assert.rejects(f.request(), (cause) => Object.is(cause, failure));
    assert.equal(f.work.opens, 0);
    failing = false;
    await f.snapshots.close();
    assert.equal(f.work.closes, 1);
    assert.equal(f.snapshots.entries.size, 0);
  }
});

test("page construction failure releases the reader before admitting another snapshot", async (t) => {
  const f = fixture(t, { readers: 1, idleMs: 1000, maxAgeMs: 5000 });
  const failure = new Error("page field failed");
  await assert.rejects(
    f.request(null, {
      read: async () => ({
        exists: true,
        nextCursor: { after: 1, scope: "snapshot-1" },
        get records() {
          throw failure;
        },
      }),
    }),
    (cause) => cause === failure,
  );
  assert.equal(f.snapshots.entries.size, 0);
  assert.equal(f.work.closes, 1);
  await f.request();
  assert.equal(f.work.opens, 2);
});
