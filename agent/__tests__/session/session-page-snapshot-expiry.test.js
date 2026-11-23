/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { logger } from "../../src/observability/console/logger.js";
import { SessionPageSnapshots } from "../../src/session/session-page-snapshots.js";
import { deferred, fixture } from "./session-page-snapshots.test-helpers.js";

test("continued progress cannot extend the pinned snapshot lifetime", async (t) => {
  const f = fixture(t, { readers: 1, idleMs: 1000, maxAgeMs: 2500 });
  const first = await f.request();
  const read = async () => ({ exists: true, nextCursor: { after: 2, scope: "snapshot-1" } });
  f.advance(900);
  const second = await f.request(first.nextCursor, { read });
  f.advance(1800);
  const third = await f.request(second.nextCursor, { read });
  f.advance(2500);
  await assert.rejects(f.request(third.nextCursor), { code: "SESSION_PAGE_SNAPSHOT_EXPIRED" });
  await f.snapshots.expire();
  assert.equal(f.work.opens, 1);
  assert.equal(f.work.closes, 1);
  await f.request();
  assert.equal(f.work.opens, 2);
});

test("lifetime expiry stops concurrent admission and drains an in-flight page before release", async (t) => {
  const f = fixture(t, { readers: 1, idleMs: 1000, maxAgeMs: 1500 });
  const first = await f.request();
  const gate = deferred();
  const started = deferred();
  const reading = f.request(first.nextCursor, {
    read: async () => {
      started.resolve();
      await gate.promise;
      return { exists: true, nextCursor: { after: 2, scope: "snapshot-1" } };
    },
  });
  await started.promise;
  f.advance(1500);
  await assert.rejects(f.request(first.nextCursor), { code: "SESSION_PAGE_SNAPSHOT_EXPIRED" });
  await f.snapshots.expire();
  assert.equal(f.work.closes, 0);
  const rejected = assert.rejects(reading, { code: "SESSION_PAGE_SNAPSHOT_EXPIRED" });
  gate.resolve();
  await rejected;
  assert.equal(f.work.closes, 1);
  assert.equal(f.snapshots.entries.size, 0);
});

test("opening a reader consumes lifetime and cannot publish an already expired continuation", async (t) => {
  const f = fixture(t, { readers: 1, idleMs: 1000, maxAgeMs: 1500 });
  await assert.rejects(
    f.request(null, {
      open: async () => {
        f.advance(1500);
        return f.open();
      },
    }),
    { code: "SESSION_PAGE_SNAPSHOT_EXPIRED" },
  );
  assert.deepEqual(f.work.reads, []);
  assert.equal(f.work.closes, 1);
  assert.equal(f.snapshots.entries.size, 0);
});

test("final and absent pages that finish at the absolute deadline are rejected and released", async (t) => {
  const f = fixture(t, { readers: 1, idleMs: 1000, maxAgeMs: 1500 });
  const first = await f.request();
  await assert.rejects(
    f.request(first.nextCursor, {
      read: async () => {
        f.advance(1500);
        return { nextCursor: null };
      },
    }),
    { code: "SESSION_PAGE_SNAPSHOT_EXPIRED" },
  );
  await assert.rejects(
    f.request(null, {
      read: async () => {
        f.advance(3000);
        return null;
      },
    }),
    { code: "SESSION_PAGE_SNAPSHOT_EXPIRED" },
  );
  assert.equal(f.work.closes, 2);
  assert.equal(f.snapshots.entries.size, 0);
});

test("a terminal response cannot publish after reader release crosses the deadline", async (t) => {
  const f = fixture(t, { readers: 1, idleMs: 1000, maxAgeMs: 1500 });
  const closing = deferred();
  const gate = deferred();
  const reading = f.request(null, {
    open: async () => ({
      async close() {
        closing.resolve();
        await gate.promise;
        f.work.closes += 1;
      },
    }),
    read: async () => ({ nextCursor: null }),
  });
  const rejected = assert.rejects(reading, { code: "SESSION_PAGE_SNAPSHOT_EXPIRED" });
  await closing.promise;
  f.advance(1500);
  gate.resolve();
  await rejected;
  assert.equal(f.work.closes, 1);
  assert.equal(f.snapshots.entries.size, 0);
});

test(
  "the real idle timer releases an abandoned reader without a following request",
  { timeout: 2000 },
  async (t) => {
    await using snapshots = new SessionPageSnapshots({
      limits: { readers: 1, idleMs: 10, maxAgeMs: 1000 },
    });
    const released = deferred();
    const timeout = setTimeout(() => released.resolve("timeout"), 1000);
    t.after(() => clearTimeout(timeout));
    await snapshots.read({
      assertReadAuthority: async () => {},
      identity: ["user", "session", "turn"],
      cursor: null,
      open: async () => ({ close: async () => released.resolve("released") }),
      read: async () => ({ exists: true, nextCursor: { after: 1, scope: "snapshot" } }),
    });
    assert.equal(await released.promise, "released");
    await snapshots.close();
    assert.equal(snapshots.entries.size, 0);
  },
);

test("background expiry reports a release failure and recovers without another request", async (t) => {
  const reported = Promise.withResolvers();
  const released = Promise.withResolvers();
  const failure = new Error("snapshot close failed");
  const log = t.mock.method(logger, "error", (...args) => reported.resolve(args));
  let timer;
  const deadline = new Promise((resolve) => {
    timer = setTimeout(() => resolve(null), 1000);
  });
  t.after(() => clearTimeout(timer));
  await using snapshots = new SessionPageSnapshots({
    limits: { readers: 1, idleMs: 20, maxAgeMs: 1000 },
  });
  let attempts = 0;
  const request = {
    assertReadAuthority: async () => {},
    identity: ["user", "session", "turn"],
    cursor: null,
    open: async () => ({
      async close() {
        if (++attempts === 1) throw failure;
        released.resolve(true);
      },
    }),
    read: async () => ({ nextCursor: { after: 1, scope: "snapshot" } }),
  };
  await snapshots.read(request);
  assert.deepEqual(await Promise.race([reported.promise, deadline]), [
    "[session_page_snapshot][release_failed]",
    { err: failure },
  ]);
  assert.equal(await Promise.race([released.promise, deadline]), true);
  await new Promise(setImmediate);
  assert.equal(snapshots.entries.size, 0);
  assert.equal(log.mock.callCount(), 1);
  assert.equal(attempts, 2);
  await snapshots.read(request);
});

test(
  "idle expiry continues for unrelated readers after a release fails",
  { timeout: 2000 },
  async (t) => {
    const f = fixture(t, { readers: 2, idleMs: 20, maxAgeMs: 1000 });
    const failure = new Error("reader release failed");
    const failed = deferred();
    const released = deferred();
    const timeout = setTimeout(() => released.resolve(false), 1000);
    t.after(() => clearTimeout(timeout));
    let attempts = 0;
    const { nextCursor: cursor } = await f.request(null, {
      open: async () => ({
        close: async () => {
          attempts += 1;
          if (attempts === 1) {
            failed.resolve();
            throw failure;
          }
        },
      }),
    });
    f.advance(10);
    await f.request(null, { open: async () => ({ close: async () => released.resolve(true) }) });

    f.advance(20);
    await failed.promise;
    await new Promise(setImmediate);
    await assert.rejects(f.request(), (cause) => cause === failure);
    f.advance(30);
    assert.equal(await released.promise, true);
    assert.equal(attempts, 1);
    assert.deepEqual(await f.snapshots.releaseCursor({ identity: f.identity, cursor }), {
      released: true,
    });
    assert.equal(attempts, 2);
    assert.equal(f.snapshots.entries.size, 0);
    await f.request();
    assert.equal(f.work.opens, 1);
  },
);

test(
  "idle expiry does not wait for an earlier reader to finish closing",
  { timeout: 2000 },
  async (t) => {
    const f = fixture(t, { readers: 2, idleMs: 20, maxAgeMs: 1000 });
    const closing = deferred();
    const finish = deferred();
    const released = deferred();
    const timeout = setTimeout(() => released.resolve(false), 1000);
    try {
      await f.request(null, {
        open: async () => ({
          close: async () => {
            closing.resolve();
            await finish.promise;
          },
        }),
      });
      f.advance(10);
      await f.request(null, { open: async () => ({ close: async () => released.resolve(true) }) });
      f.advance(20);
      await Promise.race([closing.promise, released.promise]);

      f.advance(30);
      assert.equal(await released.promise, true);
      await new Promise(setImmediate);
      assert.equal(f.snapshots.entries.size, 1);
      await f.request();
      assert.equal(f.work.opens, 1);
    } finally {
      clearTimeout(timeout);
      finish.resolve();
    }
    await f.snapshots.close();
    assert.equal(f.snapshots.entries.size, 0);
  },
);
