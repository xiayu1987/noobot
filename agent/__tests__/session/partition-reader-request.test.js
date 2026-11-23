/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { createSessionChangesSubmission } from "@noobot/session-protocol/session-changes";
import { PartitionJournal } from "../../src/session/partition-storage/partition-journal.js";
import {
  openPartitionSessionReader,
  withPartitionSessionReader,
} from "../../src/session/partition-storage/partition-session-reader.js";
import {
  committedAt,
  createMessageCase,
  openTestMessages,
} from "./partition-session-messages.test-helpers.js";

test("scoped submission replays the original request after a lost response and cold reopen", async (t) => {
  const { journal, root, sessionId } = await createMessageCase(t);
  const submission = createSessionChangesSubmission();
  const owner = { userId: "u1", sessionId };
  const scope = { sessionId, parentSessionId: "" };
  const changes = { sessionMetadata: { customTitle: "published" } };
  let original;
  let published;
  const lost = new Error("response lost after publication");
  await assert.rejects(
    withPartitionSessionReader({ journal, ...scope }, (reader, commit) =>
      submission.submit({
        ...owner,
        prepare: () =>
          reader.prepareRequest({ operationId: "lost-response", committedAt, changes }),
        commit: async (request) => {
          original = request;
          published = await commit(request);
          throw lost;
        },
      }),
    ),
    (error) => error === lost,
  );
  changes.sessionMetadata.customTitle = "must not publish";
  await journal.close();
  const reopened = await PartitionJournal.open({ root, sessionId });
  t.after(() => reopened.close());
  const generation = reopened.head.sequence;
  assert.equal(generation, original.expectedGeneration + 1);
  assert.equal(original.epoch, reopened.head.epoch);
  await withPartitionSessionReader({ journal: reopened, ...scope }, async (reader, commit) => {
    const replay = await submission.submit({
      ...owner,
      prepare: () => assert.fail("retry must not prepare again"),
      commit: (request) => {
        assert.strictEqual(request, original);
        return commit(request);
      },
    });
    assert.deepEqual(replay, { ...published, replayed: true });
    assert.equal((await reader.readMetadata()).customTitle, "published");
  });
  assert.equal(reopened.head.sequence, generation);
});

test("a fresh process replays the serialized request without republishing CURRENT", async (t) => {
  const { journal, root, sessionId } = await createMessageCase(t);
  const prepared = await withPartitionSessionReader(
    { journal, sessionId, parentSessionId: "" },
    async (reader, commit) => {
      const request = await reader.prepareRequest({
        operationId: "cross-process-replay",
        committedAt,
        changes: { sessionMetadata: { customTitle: "published" } },
      });
      return { request, outcome: await commit(request) };
    },
  );
  await journal.close();
  const current = path.join(root, "CURRENT");
  const before = await readFile(current);
  const child = spawnSync(
    process.execPath,
    [
      "--import",
      import.meta.resolve("@noobot/shared/testing/runtime-params"),
      "--input-type=module",
      "-e",
      `
        import { readFileSync } from "node:fs";
        import { restoreSessionCommitRequest } from ${JSON.stringify(import.meta.resolve("@noobot/session-protocol/session-changes"))};
        import { PartitionJournal } from ${JSON.stringify(import.meta.resolve("../../src/session/partition-storage/partition-journal.js"))};
        import { withPartitionSessionReader } from ${JSON.stringify(import.meta.resolve("../../src/session/partition-storage/partition-session-reader.js"))};
        const { root, sessionId, serialized } = JSON.parse(readFileSync(0, "utf8"));
        const journal = await PartitionJournal.open({ root, sessionId });
        try {
          const outcome = await withPartitionSessionReader({ journal, sessionId, parentSessionId: "" },
            (_, commit) => commit(restoreSessionCommitRequest(serialized)));
          process.stdout.write(JSON.stringify({ outcome, generation: journal.head.sequence }));
        } finally {
          await journal.close();
        }
      `,
    ],
    {
      input: JSON.stringify({ root, sessionId, serialized: JSON.stringify(prepared.request) }),
      encoding: "utf8",
      timeout: 15000,
    },
  );
  assert.ifError(child.error);
  assert.equal(child.status, 0, child.stderr);
  assert.deepEqual(JSON.parse(child.stdout), {
    outcome: { ...prepared.outcome, replayed: true },
    generation: prepared.request.expectedGeneration + 1,
  });
  assert.deepEqual(await readFile(current), before);
});

test("reader preparation binds epoch and predecessor and captures input for replay after close", async (t) => {
  const { journal, sessionId } = await createMessageCase(t);
  const messages = openTestMessages(journal, sessionId);
  const reader = await openPartitionSessionReader({ journal, sessionId, parentSessionId: "" });
  const changes = { sessionMetadata: { customTitle: "captured title" } };
  const command = { operationId: "captured-request", committedAt, changes };
  const request = await reader.prepareRequest(command);
  assert.equal(request.epoch, journal.head.epoch);
  assert.equal(request.expectedGeneration, reader.generation);
  assert.ok(Object.isFrozen(request));
  changes.sessionMetadata.customTitle = "later mutation";
  await reader.close();
  await assert.rejects(reader.prepareRequest(command), { code: "SESSION_READER_CLOSED" });
  const committed = await messages.commit(request);
  assert.deepEqual(await messages.commit(request), { ...committed, replayed: true });
  await using current = await openPartitionSessionReader({
    journal,
    sessionId,
    parentSessionId: "",
  });
  assert.equal((await current.readMetadata()).customTitle, "captured title");
});

test("the scoped commit port rejects a copied request before publication", async (t) => {
  const { journal, root, sessionId } = await createMessageCase(t);
  const current = path.join(root, "CURRENT");
  const before = await readFile(current);
  await withPartitionSessionReader(
    { journal, sessionId, parentSessionId: "" },
    async (reader, commit) => {
      const request = await reader.prepareRequest({
        operationId: "require-prepared-request",
        committedAt,
        changes: { sessionMetadata: { customTitle: "published" } },
      });
      await assert.rejects(commit(structuredClone(request)), /reader-prepared request/);
      assert.deepEqual(await readFile(current), before);
      const outcome = await commit(request);
      assert.equal(outcome.generation, reader.generation + 1);
      assert.equal(outcome.replayed, false);
    },
  );
});

test("reader preparation never rebases a stale snapshot onto the current generation", async (t) => {
  const { journal, sessionId } = await createMessageCase(t);
  const messages = openTestMessages(journal, sessionId);
  await using reader = await openPartitionSessionReader({
    journal,
    sessionId,
    parentSessionId: "",
  });
  const command = (operationId, customTitle) => ({
    operationId,
    committedAt,
    changes: { sessionMetadata: { customTitle } },
  });
  await messages.commit(await reader.prepareRequest(command("winner", "winner")));
  const stale = await reader.prepareRequest(command("stale", "stale"));
  assert.equal(stale.expectedGeneration, reader.generation);
  assert.equal(stale.expectedGeneration + 1, journal.head.sequence);
  const before = journal.head.sequence;
  await assert.rejects(messages.commit(stale), { code: "SESSION_OPERATION_CONFLICT" });
  assert.equal(journal.head.sequence, before);
  await using current = await openPartitionSessionReader({
    journal,
    sessionId,
    parentSessionId: "",
  });
  assert.equal((await current.readMetadata()).customTitle, "winner");
});
