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
import { prepareAndCleanupSessionArtifacts } from "../helpers/immutable-cleanup.js";
import {
  applySessionMessageFacts,
  createTestSessionRequiredFields,
} from "../helpers/session-message-facts.js";
import { prepareImmutableMessages } from "../../src/session/session-artifact-session/immutable-message-changes.js";
import { TEST_STORAGE_SERVICE as storageService } from "../helpers/storage-service.js";

async function fixture(t) {
  const sessionDir = await mkdtemp(path.join(tmpdir(), "scoped-retention-"));
  t.after(() => rm(sessionDir, { recursive: true, force: true }));
  const message = {
    sessionId: "scoped",
    parentSessionId: "",
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
      aggregateVersion: 0,
      messages: [message],
    }),
    operationId: "initialize-scoped-retention",
  });
  const store = await ImmutableSessionStore.open({ sessionDir });
  const directory = path.join(sessionDir, RETENTION.directory);
  const readers = createScopedSessionArtifactReader({ storageService });
  return { sessionDir, store, directory, readers, message };
}

for (const operation of ["thinking", "snapshot"]) {
  test(`${operation} query pins its captured head across a commit and concurrent cleanup`, async (t) => {
    const { sessionDir, store, directory, readers, message } = await fixture(t);
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
        ? readSessionThinkingDetail({ sessionDir, turnScopeId: "turn", dialogProcessId: "dialog" })
        : readers.readScopedSessionSnapshot({ sessionDir });
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
      prepare: ({ get, getMetadata, input }) =>
        prepareImmutableMessages({
          store,
          get,
          getMetadata,
          messages: [input.message],
          updatedAt: "2026-01-01T00:00:01.000Z",
        }),
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
      assert.equal(result.messageItem.thinkingContentTimeline[0].text, message.content);
      const current = await readSessionThinkingDetail({
        sessionDir,
        turnScopeId: "turn",
        dialogProcessId: "dialog",
      });
      assert.equal(
        current.messageItem.thinkingContentTimeline[0].text,
        "replacement thinking body",
      );
      assert.notEqual(current.revision, result.revision);
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
  const query = readers.readScopedSessionSnapshot({ sessionDir });
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
  const { sessionDir, store, directory } = await fixture(t);
  const failure = new Error("turn read failed");
  const get = ImmutableSessionStore.prototype.get;
  t.mock.method(ImmutableSessionStore.prototype, "get", async function (snapshot, collection, key) {
    if (this !== store && collection === "turns") {
      assert.equal((await readdir(directory)).length, 1);
      throw failure;
    }
    return get.call(this, snapshot, collection, key);
  });
  await assert.rejects(
    readSessionThinkingDetail({ sessionDir, turnScopeId: "turn", dialogProcessId: "dialog" }),
    (error) => error === failure,
  );
  assert.deepEqual(await readdir(directory), []);
});
