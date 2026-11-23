/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { createPluginArtifactEnvelope } from "@noobot/event-protocol/plugin-artifact-event";
import { normalizeSessionEntity } from "../../src/session/entities/session-entity.js";
import { PartitionJournal } from "../../src/session/partition-storage/partition-journal.js";
import { withPartitionSessionReader } from "../../src/session/partition-storage/partition-session-reader.js";
import { PartitionTransactions } from "../../src/session/partition-storage/partition-transactions.js";
import { emptyPartitionSession } from "../helpers/partition-session-cases.js";
import {
  committedAt,
  createMessageCase,
  message,
  openTestMessages,
  prepare,
  scope,
} from "./partition-session-messages.test-helpers.js";

const options = (journal, sessionId) => ({ journal, sessionId, parentSessionId: "" });
const exported = (journal, sessionId) =>
  withPartitionSessionReader(options(journal, sessionId), (reader) => reader.exportSession());

test("partition export preserves the normalized empty aggregate and closes its reader port", async (t) => {
  const { journal, sessionId } = await createMessageCase(t);
  let escaped;
  await withPartitionSessionReader(options(journal, sessionId), async (reader) => {
    escaped = reader;
    assert.deepEqual(
      await reader.exportSession(),
      normalizeSessionEntity(
        emptyPartitionSession({ sessionId, parentSessionId: "", committedAt }),
      ),
    );
  });
  await assert.rejects(escaped.exportSession(), { code: "SESSION_READER_CLOSED" });
});

test("partition export retains ordered bodies, dialogs and artifact authority across rollover and cold reopen", async (t) => {
  const { journal, sessionId, root } = await createMessageCase(t, { partitionRecords: 4 });
  const repository = openTestMessages(journal, sessionId);
  const originals = [];
  for (let index = 0; index < 12; index += 1) {
    const source = { ...message(sessionId, `m${index}`), content: `正文-${index}🙂` };
    originals.push(source);
    await repository.commit(
      await prepare(journal, repository, `seed-${index}`, { messages: [source] }),
    );
  }
  const envelope = createPluginArtifactEnvelope({
    pluginId: "export-test",
    artifactType: "result",
    artifactId: "result-1",
    sessionId,
    turnScopeId: scope.turnScopeId,
    sequence: 1,
    revision: 1,
    operation: "created",
    baseRevision: null,
    data: { title: "导出" },
    occurredAt: committedAt,
  });
  const event = {
    eventId: envelope.identity.eventId,
    envelope: { ...envelope, ordering: { ...envelope.ordering, aggregateVersion: 1 } },
    committedAt,
    deliveries: {},
  };
  await repository.commit(
    await prepare(journal, repository, "artifact", { artifactEvents: [event] }),
  );
  assert.ok(journal.head.tail.partition > 0);
  let before;
  await withPartitionSessionReader(options(journal, sessionId), async (reader) => {
    before = await reader.exportSession();
    assert.deepEqual(
      before.messages.map(({ content }) => content),
      originals.map(({ content }) => content),
    );
    assert.deepEqual(before.sessionArtifactEvents, [event.envelope]);
    assert.equal(before.dialogOrder.length, 1);
    assert.equal(Object.hasOwn(before.dialogOrder[0], "contextCandidates"), false);
    await repository.commit(
      await prepare(journal, repository, "new-message", {
        messages: [message(sessionId, "later")],
      }),
    );
    assert.deepEqual(await reader.exportSession(), before);
  });
  const latest = await exported(journal, sessionId);
  assert.equal(latest.messages.length, 13);
  await journal.close();
  const reopened = await PartitionJournal.open({ root, sessionId });
  t.after(() => reopened.close());
  assert.deepEqual(await exported(reopened, sessionId), latest);
});

test("export respects pinned visibility after deletion while the journal retains the message", async (t) => {
  const { journal, sessionId } = await createMessageCase(t, { partitionRecords: 3 });
  const repository = openTestMessages(journal, sessionId);
  await repository.commit(
    await prepare(journal, repository, "seed", { messages: [message(sessionId, "m1")] }),
  );
  const collections = new PartitionTransactions(journal);
  const later = { ...message(sessionId, "m2"), dialogProcessId: "dialog-2", turnScopeId: "turn-2" };
  await repository.commit(await prepare(journal, repository, "append", { messages: [later] }));
  await withPartitionSessionReader(options(journal, sessionId), async (reader) => {
    const before = await reader.exportSession();
    assert.deepEqual(
      before.messages.map(({ messageUid }) => messageUid),
      ["m1", "m2"],
    );
    await repository.commit(
      await prepare(journal, repository, "delete", {
        messageDeletion: { commandId: "delete", anchor: { turnScopeId: later.turnScopeId } },
      }),
    );
    assert.deepEqual(await reader.exportSession(), before);
  });
  await journal.usingSnapshot(async (snapshot) => {
    const retained = await collections.lookupLatestMany({
      snapshot,
      collection: "messages",
      keys: ["m2"],
    });
    assert.ok(retained.has("m2"));
  });
  assert.deepEqual(
    (await exported(journal, sessionId)).messages.map(({ messageUid }) => messageUid),
    ["m1"],
  );
});
