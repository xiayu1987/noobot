/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { IMMUTABLE_READER_RETENTION } from "@noobot/session-protocol/immutable-storage";
import { ImmutableSessionStore } from "../../src/session/session-artifact-session/immutable-session-store.js";
import { withImmutableSessionReader } from "../../src/session/session-artifact-session/immutable-session-reader.js";
import { sessionMutationCoordinator } from "../../src/session/session-mutation-coordinator.js";

async function fixture(t) {
  const sessionDir = await mkdtemp(path.join(tmpdir(), "scoped-reader-"));
  t.after(() => rm(sessionDir, { recursive: true, force: true }));
  const options = { sessionDir, sessionId: "scoped", parentSessionId: "" };
  const store = new ImmutableSessionStore({ ...options, allowCreate: true });
  await store.commit({
    expectedGeneration: 0,
    operationId: "initialize",
    changes: [
      {
        collection: "metadata",
        key: "session",
        value: { sessionId: "scoped", parentSessionId: "" },
      },
      { collection: "metadata", key: "facts", value: { messageCount: 1 } },
    ],
  });
  return { options, store };
}

test("callback reader closes escaped handles without publishing retention files", async (t) => {
  const { options } = await fixture(t);
  const reader = await withImmutableSessionReader(options, async (current) => {
    assert.deepEqual(await current.readFacts(), { messageCount: 1 });
    return current;
  });
  await assert.rejects(reader.readFacts(), { code: "SESSION_READER_CLOSED" });
  const directory = path.join(options.sessionDir, IMMUTABLE_READER_RETENTION.directory);
  await assert.rejects(readdir(directory), { code: "ENOENT" });
});

test("callback failures release the canonical lock and close the reader", async (t) => {
  const { options, store } = await fixture(t);
  const failure = new Error("callback failed");
  let escaped;
  await assert.rejects(
    withImmutableSessionReader(options, async (reader) => {
      escaped = reader;
      throw failure;
    }),
    (error) => error === failure,
  );
  await assert.rejects(escaped.readFacts(), { code: "SESSION_READER_CLOSED" });
  await sessionMutationCoordinator.run(store.lockPath, async () => {
    assert.equal((await store.snapshot()).generation, 1);
  });
});

test("accepted reads drain before the canonical lock admits a competing operation", async (t) => {
  const { options, store } = await fixture(t);
  const entered = Promise.withResolvers();
  const unblock = Promise.withResolvers();
  const returned = Promise.withResolvers();
  const original = ImmutableSessionStore.prototype.get;
  t.mock.method(ImmutableSessionStore.prototype, "get", async function (snapshot, collection, key) {
    if (collection === "metadata" && key === "facts") {
      entered.resolve();
      await unblock.promise;
    }
    return original.call(this, snapshot, collection, key);
  });
  let reader;
  let accepted;
  const scoped = withImmutableSessionReader(options, async (current) => {
    reader = current;
    accepted = reader.readFacts();
    await entered.promise;
    returned.resolve();
  });
  t.after(() => unblock.resolve());
  await returned.promise;

  await new Promise((resolve) => setImmediate(resolve));
  let competitorEntered = false;
  const competitor = sessionMutationCoordinator.run(store.lockPath, async () => {
    competitorEntered = true;
  });
  await assert.rejects(reader.readFacts(), { code: "SESSION_READER_CLOSED" });
  assert.equal(competitorEntered, false);
  unblock.resolve();
  assert.deepEqual(await accepted, { messageCount: 1 });
  await scoped;
  await competitor;
  assert.equal(competitorEntered, true);
});
