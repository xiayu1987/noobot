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
import { setImmediate } from "node:timers/promises";
import { IMMUTABLE_READER_RETENTION as RETENTION } from "@noobot/session-protocol/immutable-storage";
import { initializeImmutableSession } from "../../src/session/session-artifact-session/immutable-session-bootstrap.js";
import { ImmutableSessionStore } from "../../src/session/session-artifact-session/immutable-session-store.js";
import { readImmutableReaderRetentions } from "../../src/session/session-artifact-session/immutable-reader-retention.js";
import { createScopedSessionArtifactReader } from "../../src/session/session-scoped-artifact-reader.js";
import { readSessionThinkingDetail } from "../../src/session/session-thinking-detail.js";
import { SessionPageSnapshots } from "../../src/session/session-page-snapshots.js";
import { immutableSessionReaderAccess as sessionReaderAccess } from "../../src/session/session-artifact-session/immutable-reader-access.js";
import { prepareAndCleanupSessionArtifacts } from "../helpers/immutable-cleanup.js";
import {
  applySessionMessageFacts,
  createTestSessionRequiredFields,
} from "../helpers/session-message-facts.js";
import {
  ImmutableSessionChanges,
  prepareImmutableMessages,
} from "../../src/session/session-artifact-session/immutable-message-changes.js";
import { TEST_STORAGE_SERVICE as storageService } from "../helpers/storage-service.js";

const authoritySessionId = "scoped-parent";

async function fixture(t) {
  const sessionDir = await mkdtemp(path.join(tmpdir(), "scoped-retention-"));
  t.after(() => rm(sessionDir, { recursive: true, force: true }));
  const message = {
    sessionId: "scoped",
    parentSessionId: authoritySessionId,
    messageUid: "guidance",
    modelMessageId: "model-guidance",
    presentationMessageId: "presentation-guidance",
    turnScopeId: "turn",
    dialogProcessId: "dialog",
    role: "assistant",
    type: "message",
    injectedMessage: true,
    attachments: [],
    ts: "2026-01-01T00:00:00.000Z",
    content: "retained thinking body.".repeat(8192),
  };
  await initializeImmutableSession({
    sessionDir,
    session: applySessionMessageFacts({
      ...createTestSessionRequiredFields(),
      sessionId: "scoped",
      parentSessionId: authoritySessionId,
      aggregateVersion: 0,
      messages: [message],
    }),
    operationId: "initialize-scoped-retention",
  });
  const store = await ImmutableSessionStore.open({ sessionDir });
  const directory = path.join(sessionDir, RETENTION.directory);
  const pageSnapshots = new SessionPageSnapshots();
  t.after(() => pageSnapshots.close());
  const readers = createScopedSessionArtifactReader({
    storageService,
    sessionReaderAccess,
    pageSnapshots,
    withDeletionFence: (_userId, open) => open(),
    assertAuthorityActive: async () => {},
  });
  const readThinking = () =>
    readSessionThinkingDetail({
      pageSnapshots: pageSnapshots.withReadAuthority(async () => {}),
      identity: [sessionDir],
      open: () =>
        sessionReaderAccess.open({
          sessionDir,
          sessionId: "scoped",
          parentSessionId: authoritySessionId,
        }),
      sessionId: "scoped",
      lookupKey: { turnScopeId: "turn", dialogProcessId: "dialog" },
      cursor: null,
      limit: 1,
    });
  return { sessionDir, store, directory, readers, message, readThinking };
}

for (const operation of ["thinking", "snapshot"]) {
  test(`${operation} query pins its captured head across a commit and concurrent cleanup`, async (t) => {
    const { sessionDir, store, directory, readers, message, readThinking } = await fixture(t);
    const historical = await store.snapshot();
    const entered = Promise.withResolvers();
    const resume = Promise.withResolvers();
    t.after(() => resume.resolve());
    const get = ImmutableSessionStore.prototype.get;
    let paused = false;
    t.mock.method(
      ImmutableSessionStore.prototype,
      "get",
      async function (snapshot, collection, key) {
        if (this !== store && !paused && operation === "thinking" && collection === "turns") {
          paused = true;
          entered.resolve();
          await resume.promise;
        }
        return get.call(this, snapshot, collection, key);
      },
    );
    const getMany = ImmutableSessionStore.prototype.getMany;
    t.mock.method(
      ImmutableSessionStore.prototype,
      "getMany",
      async function (snapshot, collection, keys) {
        if (
          this !== store &&
          !paused &&
          operation === "snapshot" &&
          collection === "metadata" &&
          keys.includes("facts")
        ) {
          paused = true;
          entered.resolve();
          await resume.promise;
        }
        return getMany.call(this, snapshot, collection, keys);
      },
    );
    const query =
      operation === "thinking"
        ? readThinking()
        : readers.readScopedSessionSnapshot({
            userId: "user",
            authoritySessionId,
            sessionDir,
          });
    const settled = query.then(() => "settled");
    await Promise.race([
      entered.promise,
      settled.then(() => assert.fail("query never pinned a read")),
    ]);
    assert.equal((await readdir(directory)).length, 1);
    await store.transact({
      expectedGeneration: historical.generation,
      operationId: "advance-during-query",
      input: { message: { ...message, content: "replacement thinking body" } },
      prepare: async ({ get, getMany, getMetadata, input }) => {
        const plan = new ImmutableSessionChanges(get, { getMany, getMetadata });
        await prepareImmutableMessages({
          store,
          plan,
          messages: [input.message],
          updatedAt: "2026-01-01T00:00:01.000Z",
        });
        return { changes: plan.changes() };
      },
    });
    await prepareAndCleanupSessionArtifacts({
      storageService,
      sessionDir,
      assertSessionWritable: async () => {},
      dryRun: false,
    });
    assert.deepEqual(await readImmutableReaderRetentions(store, await store.snapshot()), [
      historical,
    ]);
    resume.resolve();
    const result = await query;
    if (operation === "thinking") {
      assert.equal(result.exists, true);
      assert.equal(result.messages[0].content, message.content);
      assert.equal(result.generation, historical.generation);
      assert.equal(result.messageCount, 1);
      assert.equal(result.nextCursor, null);
      const current = await readThinking();
      assert.equal(current.messages[0].content, "replacement thinking body");
      assert.ok(current.generation > result.generation);
      assert.equal(current.messageCount, 1);
      assert.equal(current.nextCursor, null);
    } else assert.equal(result.sessionSummary.sessionId, "scoped");
    assert.deepEqual(await readdir(directory), []);
  });
}

test("failed scoped metadata read drains the concurrent snapshot read before releasing retention", async (t) => {
  const { sessionDir, store, directory, readers } = await fixture(t);
  const entered = Promise.withResolvers();
  const resume = Promise.withResolvers();
  const failed = Promise.withResolvers();
  t.after(() => resume.resolve());
  const failure = new Error("scoped metadata read failed");
  const getMany = ImmutableSessionStore.prototype.getMany;
  t.mock.method(
    ImmutableSessionStore.prototype,
    "getMany",
    async function (snapshot, collection, keys) {
      if (this !== store && collection === "metadata" && keys.includes("facts")) {
        entered.resolve();
        await resume.promise;
      }
      return getMany.call(this, snapshot, collection, keys);
    },
  );
  const get = ImmutableSessionStore.prototype.get;
  t.mock.method(ImmutableSessionStore.prototype, "get", async function (snapshot, collection, key) {
    if (this !== store && collection === "metadata") {
      if (key === "scoped") {
        await entered.promise;
        failed.resolve();
        throw failure;
      }
    }
    return get.call(this, snapshot, collection, key);
  });
  let settled = false;
  const query = readers.readScopedSessionSnapshot({
    userId: "user",
    authoritySessionId,
    sessionDir,
  });
  const checked = assert
    .rejects(query, (error) => error === failure)
    .finally(() => {
      settled = true;
    });
  await failed.promise;
  await setImmediate();
  assert.equal(settled, false);
  assert.equal((await readdir(directory)).length, 1);
  resume.resolve();
  await checked;
  assert.deepEqual(await readdir(directory), []);
});

test("failed thinking-detail read releases its retention and preserves the read error", async (t) => {
  const { store, directory, readThinking } = await fixture(t);
  const failure = new Error("turn read failed");
  const get = ImmutableSessionStore.prototype.get;
  t.mock.method(ImmutableSessionStore.prototype, "get", async function (snapshot, collection, key) {
    if (this !== store && collection === "turns") {
      assert.equal((await readdir(directory)).length, 1);
      throw failure;
    }
    return get.call(this, snapshot, collection, key);
  });
  await assert.rejects(readThinking(), (error) => error === failure);
  assert.deepEqual(await readdir(directory), []);
});
