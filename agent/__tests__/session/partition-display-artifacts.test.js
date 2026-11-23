/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { createResourceRef } from "@noobot/path-resolver";
import { TRANSFER_VERSION } from "@noobot/semantic-transfer-protocol";
import { createMessageReadBudget } from "@noobot/session-protocol/message-read-budget";
import { PARTITION_MESSAGE_COLLECTIONS } from "@noobot/session-protocol/partition-session-messages";
import {
  sessionDisplayArtifactResultKey,
  sessionDisplayArtifactStateKey,
  sessionDisplayAssistantCountKey,
  sessionDisplayDependencyDirectory,
} from "@noobot/session-protocol/session-reader";
import { readPartitionDisplayArtifactPage } from "../../src/session/partition-storage/partition-display-artifacts.js";
import {
  readRetainedDisplayArtifactPage,
  releaseRetainedDisplayArtifactPage,
} from "../../src/session/session-display-page.js";
import { SessionPageSnapshots } from "../../src/session/session-page-snapshots.js";
import { openPartitionSessionReader } from "../../src/session/partition-storage/partition-session-reader.js";
import { PartitionJournal } from "../../src/session/partition-storage/partition-journal.js";
import {
  committedAt,
  createMessageCase,
  message,
  openTestMessages,
  prepare,
  scope,
} from "./partition-session-messages.test-helpers.js";

function displayArtifactPageFixture() {
  const metadata = new Map();
  const read = async ({ collection, keys }) => {
    assert.equal(collection, "metadata");
    return new Map(
      keys.filter((key) => metadata.has(key)).map((key) => [key, { value: metadata.get(key) }]),
    );
  };
  const directory = (kind) =>
    sessionDisplayDependencyDirectory(
      {
        get: async (key) => (metadata.has(key) ? metadata.get(key) : null),
        set: (key, value) => metadata.set(key, value),
        remove: (key) => metadata.delete(key),
      },
      scope.turnScopeId,
      kind,
    );
  const readPage = () =>
    readPartitionDisplayArtifactPage(
      read,
      { ...scope, generation: 1 },
      { messageCount: 2, lifecycle: null },
      { position: { after: 0 }, limit: 1, budget: createMessageReadBudget() },
    );
  return { metadata, directory, readPage };
}

test("an empty display artifact page does not read the assistant count", async () => {
  const { metadata, readPage } = displayArtifactPageFixture();
  metadata.set(sessionDisplayAssistantCountKey(scope.turnScopeId), "invalid");
  const { summary, records } = await readPage();
  assert.equal(summary.status, "empty");
  assert.equal(summary.ownerPresentationMessageId, null);
  assert.deepEqual(records, []);
});

test("an artifact index pointing outside its turn is rejected before reading message data", async () => {
  const { metadata, directory, readPage } = displayArtifactPageFixture();
  metadata.set(sessionDisplayArtifactStateKey(scope.turnScopeId), {
    count: 1,
    conflicts: 0,
    attachments: 0,
  });
  await directory("artifact-order").update(1, true);
  metadata.set(sessionDisplayArtifactResultKey(scope.turnScopeId, 1), 3);
  await assert.rejects(readPage, {
    code: "SESSION_STORAGE_CORRUPT",
    message: "Artifact dependency outside owning turn",
  });
});

test("display artifact counts track distinct calls and reassign when the presentation becomes ambiguous", async (t) => {
  const { journal, sessionId, root } = await createMessageCase(t, {
    transactionBytes: 24 * 1024,
    receiptBytes: 32 * 1024,
    pageBytes: 24 * 1024,
  });
  const repository = openTestMessages(journal, sessionId);
  const open = (journal) => openPartitionSessionReader({ journal, sessionId, parentSessionId: "" });
  const commit = async (id, changes) =>
    repository.commit(await prepare(journal, repository, id, changes));
  const page = (reader) =>
    reader.readDisplayPage({ cursor: null, direction: "forward", limit: 4, maxBytes: 16384 });
  const result = (uid, callId) => ({
    ...scope,
    sessionId,
    messageUid: uid,
    role: "tool",
    type: "tool_result",
    presentationMessageId: "presentation-answer",
    tool_call_id: callId,
    toolName: "read_file",
    content: JSON.stringify({ ok: true, path: { view: "workspace", path: `${uid}.txt` } }),
    attachments: [],
    ts: committedAt,
    resourceRefs: [
      createResourceRef({
        owner: "admin",
        source: "workspace",
        logical: { view: "workspace", path: `${uid}.txt` },
        mimeType: "text/plain",
        capabilities: { read: true, write: false },
      }),
    ],
  });
  await commit("seed-artifact", {
    messages: [message(sessionId, "answer"), result("older-result", "call-1")],
  });
  await commit("second-artifact", { messages: [result("other-result", "call-2")] });
  let now = 0;
  await using pageSnapshots = new SessionPageSnapshots({
    limits: { readers: 2, idleMs: 1000, maxAgeMs: 5000 },
    now: () => now,
  });
  const readers = [];
  const access = {
    pageSnapshots: pageSnapshots.withReadAuthority(async () => {}),
    identity: ["owner", root],
    async open() {
      const reader = await open(journal);
      readers.push(reader);
      return reader;
    },
  };
  const key = { sessionId, dialogProcessId: scope.dialogProcessId, turnScopeId: scope.turnScopeId };
  const readArtifacts = (cursor = null) =>
    readRetainedDisplayArtifactPage({
      ...access,
      request: { ...key, cursor, limit: 1, maxBytes: 4096 },
    });
  const releaseArtifacts = (cursor) =>
    releaseRetainedDisplayArtifactPage({
      ...access,
      request: { ...key, cursor },
    });
  const firstRetained = await readArtifacts();
  assert.equal(firstRetained.records[0].message.messageUid, "older-result");
  {
    await using retained = await open(journal);
    const artifacts = (reader, cursor = null, maxBytes = 4096) =>
      reader.readDisplayArtifactPage({
        lookupKey: scope,
        cursor,
        limit: 1,
        maxBytes,
      });
    const firstArtifact = await artifacts(retained);
    assert.equal(firstArtifact.records[0].message.messageUid, "older-result");
    assert.ok(firstArtifact.nextCursor);
    {
      await using anotherReader = await open(journal);
      assert.equal((await artifacts(anotherReader)).generation, firstArtifact.generation);
      await assert.rejects(artifacts(anotherReader, firstArtifact.nextCursor), {
        code: "SESSION_PAGE_CURSOR_CONFLICT",
      });
    }
    await assert.rejects(artifacts(retained, null, 1), {
      code: "SESSION_MESSAGE_READ_BUDGET_EXCEEDED",
    });
    const first = await page(retained);
    assert.equal(first.stats.displayToolLogCount, 2);
    const replacement = result("newer-result", "call-1");
    const published = await commit("replace-artifact", { messages: [replacement] });
    const lastRetained = await readArtifacts(firstRetained.nextCursor);
    assert.equal(lastRetained.generation, firstRetained.generation);
    assert.deepEqual(lastRetained.summary, firstRetained.summary);
    assert.equal(lastRetained.records[0].message.messageUid, "other-result");
    assert.equal(lastRetained.nextCursor, null);
    assert.equal(readers.length, 1);
    await assert.rejects(readers[0].readMetadata(), { code: "SESSION_READER_CLOSED" });
    assert.deepEqual(await releaseArtifacts(firstRetained.nextCursor), { released: false });
    const freshRetained = await readArtifacts();
    assert.ok(freshRetained.generation > firstRetained.generation);
    assert.equal(freshRetained.records[0].message.messageUid, "newer-result");
    assert.deepEqual(await releaseArtifacts(freshRetained.nextCursor), { released: true });
    await assert.rejects(readers[1].readMetadata(), { code: "SESSION_READER_CLOSED" });
    const abandoned = await readArtifacts();
    now = 1000;
    await pageSnapshots.expire();
    await assert.rejects(readArtifacts(abandoned.nextCursor), {
      code: "SESSION_PAGE_SNAPSHOT_EXPIRED",
    });
    await assert.rejects(readers[2].readMetadata(), { code: "SESSION_READER_CLOSED" });
    assert.equal(readers.length, 3);
    await using assigned = await open(journal);
    const current = await page(assigned);
    const updatedArtifact = await artifacts(assigned);
    assert.equal(updatedArtifact.records[0].message.messageUid, "newer-result");
    await assert.rejects(artifacts(assigned, firstArtifact.nextCursor), {
      code: "SESSION_PAGE_CURSOR_CONFLICT",
    });
    const retainedNext = await artifacts(retained, firstArtifact.nextCursor);
    assert.equal(retainedNext.generation, firstArtifact.generation);
    assert.deepEqual(retainedNext.summary, firstArtifact.summary);
    assert.equal(retainedNext.records[0].message.messageUid, "other-result");
    assert.equal(retainedNext.nextCursor, null);
    assert.equal(current.stats.displayToolLogCount, 2);
    assert.equal(Object.hasOwn(current.messages[0], "toolTimeline"), false);
    const updatedNext = await artifacts(assigned, updatedArtifact.nextCursor);
    assert.deepEqual(
      [updatedArtifact, updatedNext].map(
        ({ records }) => records[0].message.resourceRefs[0].logical.path,
      ),
      ["newer-result.txt", "other-result.txt"],
    );
    const [{ owner, contentReference }] = published.result.messageReceipts;
    const content = JSON.stringify({ ok: false, output: "文".repeat(4096) });
    const replaced = await commit("replace-artifact-body", {
      messageContentReplacements: [
        {
          ...scope,
          messageUid: replacement.messageUid,
          owner,
          expectedContentReference: contentReference,
          content,
        },
      ],
    });
    await using fresh = await open(journal);
    const bodyUpdated = await artifacts(fresh);
    assert.ok(bodyUpdated.generation > updatedArtifact.generation);
    assert.deepEqual(bodyUpdated.summary, updatedArtifact.summary);
    assert.deepEqual(bodyUpdated.records, [
      {
        ...updatedArtifact.records[0],
        message: {
          ...updatedArtifact.records[0].message,
          contentReference: replaced.result.messageReceipts[0].contentReference,
          contentBytes: Buffer.byteLength(JSON.stringify(content)),
        },
      },
    ]);
    const { message: ref } = bodyUpdated.records[0];
    assert.equal(Object.hasOwn(ref, "content"), false);
    assert.ok(ref.contentBytes > 4096);
    const selection = { messageUid: ref.messageUid, byteOffset: 0, maxBytes: 64 };
    await assert.rejects(
      fresh.readMessageContentPage({ ...selection, expectedContentReference: contentReference }),
      { code: "SESSION_MESSAGE_CONTENT_VERSION_CONFLICT" },
    );
    const body = await fresh.readMessageContentPage({
      ...selection,
      expectedContentReference: ref.contentReference,
    });
    assert.equal(body.totalBytes, ref.contentBytes);
    assert.equal(body.hasMore, true);
    assert.deepEqual(await artifacts(assigned), updatedArtifact);
    await commit("ambiguous-artifact", { messages: [message(sessionId, "other-answer")] });
    assert.deepEqual(await page(retained), first);
  }
  await journal.close();
  const cold = await PartitionJournal.open({ root, sessionId });
  t.after(() => cold.close());
  const readSlots = cold.readRecordSlots.bind(cold);
  let contentRecordsRead = 0;
  cold.readRecordSlots = async (query) => {
    const slots = await readSlots(query);
    for (const { mutation } of slots.values()) {
      if (mutation.collection === PARTITION_MESSAGE_COLLECTIONS.content) contentRecordsRead += 1;
    }
    return slots;
  };
  {
    await using reopened = await open(cold);
    const ambiguous = await page(reopened);
    const artifactPage = await reopened.readDisplayArtifactPage({
      lookupKey: scope,
      cursor: null,
      limit: 1,
      maxBytes: 4096,
    });
    assert.deepEqual(artifactPage.summary, {
      status: "unassigned",
      ownerPresentationMessageId: null,
      toolArtifactCount: 2,
      assignedAttachmentCount: 0,
    });
    const { messageUid, contentReference, contentBytes } = artifactPage.records[0].message;
    assert.equal(messageUid, "newer-result");
    assert.ok(contentBytes > 4096);
    assert.equal(contentRecordsRead, 0);
    await reopened.readMessageContentPage({
      messageUid,
      expectedContentReference: contentReference,
      byteOffset: 0,
      maxBytes: 64,
    });
    assert.ok(contentRecordsRead > 0);
    assert.equal(ambiguous.stats.displayToolLogCount, 0);
    assert.equal(ambiguous.stats.unassignedToolArtifactCount, 2);
    assert.ok(ambiguous.messages.every((row) => !Object.hasOwn(row, "toolTimeline")));
  }
  const coldRepository = openTestMessages(cold, sessionId);
  await coldRepository.commit(
    await prepare(cold, coldRepository, "retire-artifact", {
      messageDeletion: { commandId: "retire-artifact", anchor: { turnScopeId: scope.turnScopeId } },
    }),
  );
  await using retired = await open(cold);
  const final = await page(retired);
  assert.equal(final.stats.unassignedToolArtifactCount, 0);
  assert.deepEqual(final.messages, []);
});

test("artifact transfer conflicts retire and restore distinct attachments without changing retained snapshots", async (t) => {
  const { journal, sessionId } = await createMessageCase(t);
  const repository = openTestMessages(journal, sessionId);
  const open = () => openPartitionSessionReader({ journal, sessionId, parentSessionId: "" });
  const page = (reader) =>
    reader.readDisplayPage({ cursor: null, direction: "forward", limit: 4, maxBytes: 16384 });
  const commit = async (id, messages) =>
    repository.commit(await prepare(journal, repository, id, { messages }));
  const answer = message(sessionId, "answer");
  const transfer = (transferId, ...ids) => ({
    protocol: "noobot.semantic-transfer",
    version: TRANSFER_VERSION,
    transferId,
    presentationMessageId: answer.presentationMessageId,
    identity: {
      sessionId,
      turnScopeId: scope.turnScopeId,
      runId: "run-1",
      producer: { type: "plugin", id: "test" },
    },
    direction: "output",
    payload: {
      mode: "attachment",
      attachments: ids.map((attachmentId) => ({
        identity: { attachmentId, sessionId, attachmentSource: "model" },
        role: "primary",
        name: `${attachmentId}.txt`,
        mimeType: "text/plain",
      })),
    },
    intent: {
      source: "plugin",
      reason: "semantic_transfer_tool_result",
      scenario: "tool",
      strategy: "tool_result_text",
    },
    meta: { persisted: true },
  });
  const result = (messageUid, callId, envelope) => ({
    ...scope,
    sessionId,
    messageUid,
    role: "tool",
    type: "tool_result",
    presentationMessageId: answer.presentationMessageId,
    tool_call_id: callId,
    toolName: "read_file",
    content: "{}",
    attachments: [],
    ts: committedAt,
    transferEnvelopes: [envelope],
  });
  const shared = transfer("shared-transfer", "shared");
  const other = transfer("other-transfer", "shared", "other");
  await commit("seed-shared", [{ ...answer, transferEnvelopes: [shared] }]);
  await commit("seed-results", [
    result("first", "call-1", shared),
    result("second", "call-2", other),
  ]);
  await using assigned = await open();
  const initial = await page(assigned);
  const stats = ({ stats }) => [
    stats.displayToolLogCount,
    stats.conflictedToolArtifactCount,
    stats.attachmentCount,
  ];
  assert.deepEqual(stats(initial), [2, 0, 2]);
  const artifacts = (reader, cursor = null, maxBytes = 8192) =>
    reader.readDisplayArtifactPage({ lookupKey: scope, cursor, limit: 1, maxBytes });
  const first = await artifacts(assigned);
  assert.deepEqual(first.summary, {
    status: "assigned",
    ownerPresentationMessageId: answer.presentationMessageId,
    toolArtifactCount: 2,
    assignedAttachmentCount: 2,
  });
  await assert.rejects(
    artifacts(assigned, null, 1),
    (error) =>
      error.code === "SESSION_MESSAGE_READ_BUDGET_EXCEEDED" &&
      error.used === 0 &&
      error.requested === Buffer.byteLength(JSON.stringify(first.summary)),
  );

  await commit("introduce-conflict", [
    result("conflicting", "call-1", transfer("shared-transfer", "conflicting")),
  ]);
  await using conflicted = await open();
  const conflict = await page(conflicted);
  assert.deepEqual(stats(conflict), [0, 2, 1]);
  assert.deepEqual(conflict.messages, initial.messages);
  const conflictFirst = await artifacts(conflicted);
  assert.deepEqual(conflictFirst.summary, {
    ...first.summary,
    status: "conflicted",
    assignedAttachmentCount: 0,
  });

  await commit("resolve-conflict", [result("resolved", "call-1", shared)]);
  await using restored = await open();
  assert.deepEqual(stats(await page(restored)), [2, 0, 2]);
  assert.deepEqual((await artifacts(restored)).summary, first.summary);
  for (const [reader, previous] of [
    [assigned, first],
    [conflicted, conflictFirst],
  ]) {
    const next = await artifacts(reader, previous.nextCursor);
    assert.equal(next.generation, previous.generation);
    assert.deepEqual(next.summary, previous.summary);
    assert.equal(next.records[0].message.messageUid, "second");
    assert.equal(next.nextCursor, null);
  }
  assert.deepEqual(await page(assigned), initial);
  assert.deepEqual(await page(conflicted), conflict);
});
