/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { decodeMessageContentPage } from "@noobot/session-protocol/message-read-budget";
import { PartitionJournal } from "../../src/session/partition-storage/partition-journal.js";
import { openPartitionSessionReader } from "../../src/session/partition-storage/partition-session-reader.js";
import { PartitionTransactions } from "../../src/session/partition-storage/partition-transactions.js";
import { getFsAdapter, setFsAdapter } from "../../src/shared/storage/fs-adapter.js";
import {
  scope,
  message,
  prepare,
  openTestMessages,
  createMessageCase,
} from "./partition-session-messages.test-helpers.js";

const singleDisplayRow = { cursor: null, direction: "forward", limit: 1, maxBytes: 4096 };

async function readDisplayBody(repository, snapshot, row) {
  assert.equal(Object.hasOwn(row, "content"), false);
  const selection = {
    messageUid: row.messageUid,
    expectedContentReference: row.contentReference,
    byteOffset: 0,
    maxBytes: row.contentBytes,
  };
  const page = await repository.readMessageContentPage({ snapshot, ...selection });
  const { bytes } = decodeMessageContentPage(page, selection, row.contentBytes);
  return JSON.parse(new TextDecoder().decode(bytes));
}

async function requireDisplayOwners(repository, snapshot, expected) {
  let cursor = null;
  for (const [index, row] of expected.entries()) {
    const page = await repository.readDisplayPage({
      snapshot,
      selection: { ...singleDisplayRow, cursor },
    });
    assert.equal(page.messages.length, 1);
    const [display] = page.messages;
    const { turnScopeId, dialogProcessId, sessionOrdinal } = display;
    const content = await readDisplayBody(repository, snapshot, display);
    assert.deepEqual([content, turnScopeId, dialogProcessId, sessionOrdinal], row);
    assert.equal(page.stats.messageCount, expected.length);
    assert.equal(page.stats.displayMessageCount, expected.length);
    cursor = page.nextCursor;
    if (index < expected.length - 1) assert.ok(cursor);
  }
  assert.equal(cursor, null);
}

test("interleaved deletion retires lifecycle and delivery without reviving them on retained-turn append", async (t) => {
  const { journal, sessionId, root } = await createMessageCase(t, {
    transactionBytes: 16 * 1024,
  });
  const repository = openTestMessages(journal, sessionId);
  const consumerId = "runtime-events";
  const other = { dialogProcessId: "other-dialog", turnScopeId: "other-turn" };
  const accepted = await repository.commit(
    await prepare(journal, repository, "seed-interleaved-lifecycle", {
      messages: [
        message(sessionId, "retained"),
        { ...message(sessionId, "anchor"), ...other },
        message(sessionId, "removed"),
      ],
      turnTransition: {
        ...scope,
        sessionId,
        commandId: "accept-retained-turn",
        causationId: "accept-retained-turn",
        eventType: "turn.action_accepted",
        phase: "action",
        action: "send",
        presentationMessageId: "presentation-retained",
        executionId: "agent:turn-1",
        executionKind: "agent",
        rootExecutionId: "agent:turn-1",
      },
    }),
  );
  const event = accepted.result.turnTransition.committedEvent;
  assert.equal(accepted.result.turnTransition.applied, true);
  const retainedRow = ["retained", scope.turnScopeId, scope.dialogProcessId, 1];
  const originalRows = [
    retainedRow,
    ["anchor", other.turnScopeId, other.dialogProcessId, 2],
    ["removed", scope.turnScopeId, scope.dialogProcessId, 3],
  ];
  const request = await prepare(journal, repository, "delete-interleaved", {
    messageDeletion: {
      commandId: "delete-interleaved",
      anchor: { turnScopeId: other.turnScopeId },
    },
  });
  let deleted;
  const openReader = (journal) =>
    openPartitionSessionReader({ journal, sessionId, parentSessionId: "" });
  {
    await using pinned = await openReader(journal);
    const before = await pinned.readDisplayProjection();
    assert.deepEqual(
      before.messages.map(({ messageUid }) => messageUid),
      ["retained", "anchor", "removed"],
    );
    assert.equal(before.stats.displayMessageCount, 3);
    await journal.usingSnapshot(async (snapshot) => {
      await requireDisplayOwners(repository, snapshot, originalRows);
      const publications = journal.work.publications;
      deleted = await repository.commit(request);
      assert.equal(journal.work.publications, publications + 1);
      await requireDisplayOwners(repository, snapshot, originalRows);
      assert.deepEqual(
        (await repository.readOutboxPage({ snapshot, consumerId })).events.map(
          ({ eventId }) => eventId,
        ),
        [event.eventId],
      );
      assert.deepEqual(
        (await repository.readTurnPage({ snapshot, ...scope, cursor: null, limit: 8 })).entries.map(
          ({ message }) => message.messageUid,
        ),
        ["retained", "removed"],
      );
      await journal.usingSnapshot(async (latest) => {
        await requireDisplayOwners(repository, latest, [retainedRow]);
        assert.deepEqual(
          (await repository.readOutboxPage({ snapshot: latest, consumerId })).events,
          [],
        );
        const lifecycle = await new PartitionTransactions(journal).getLatestMany({
          snapshot: latest,
          collection: "lifecycle",
          keys: [scope.turnScopeId],
        });
        assert.equal(lifecycle.get(scope.turnScopeId).remove, true);
      });
    });
    assert.deepEqual(await pinned.readDisplayProjection(), before);
  }
  await journal.close();
  const reopened = await PartitionJournal.open({ root, sessionId });
  t.after(() => reopened.close());
  const reader = openTestMessages(reopened, sessionId);
  assert.deepEqual(await reader.commit(request), { ...deleted, replayed: true });
  await reopened.usingSnapshot((snapshot) => requireDisplayOwners(reader, snapshot, [retainedRow]));
  {
    await using current = await openReader(reopened);
    assert.equal(current.generation, deleted.generation);
    const { messages, stats } = await current.readDisplayProjection();
    assert.deepEqual(
      messages.map(({ messageUid, sessionOrdinal }) => [messageUid, sessionOrdinal]),
      [["retained", 1]],
    );
    assert.equal(stats.messageCount, 1);
    assert.equal(stats.displayMessageCount, 1);
  }
  await reader.commit(
    await prepare(reopened, reader, "append-retained-turn", {
      messages: [message(sessionId, "appended")],
    }),
  );
  const beforeReadmission = reopened.head.sequence;
  await assert.rejects(
    reader.commit(
      await prepare(reopened, reader, "readmit-retained-turn", {
        sessionMetadata: { customTitle: "must not publish" },
        turnTransition: {
          ...scope,
          sessionId,
          commandId: "readmit-retained-turn",
          causationId: "readmit-retained-turn",
          eventType: "turn.action_accepted",
          phase: "action",
          action: "send",
          presentationMessageId: "presentation-retained",
          executionId: "agent:turn-1",
          executionKind: "agent",
          rootExecutionId: "agent:turn-1",
        },
      }),
    ),
    { code: "SESSION_TURN_IDENTITY_CONFLICT" },
  );
  assert.equal(reopened.head.sequence, beforeReadmission);
  await reopened.usingSnapshot(async (snapshot) => {
    await requireDisplayOwners(reader, snapshot, [
      retainedRow,
      ["appended", scope.turnScopeId, scope.dialogProcessId, 2],
    ]);
    assert.deepEqual((await reader.readOutboxPage({ snapshot, consumerId })).events, []);
    const lifecycle = await new PartitionTransactions(reopened).getLatestMany({
      snapshot,
      collection: "lifecycle",
      keys: [scope.turnScopeId],
    });
    assert.equal(lifecycle.get(scope.turnScopeId).remove, true);
    assert.deepEqual(
      (await reader.readTurnPage({ snapshot, ...scope, cursor: null, limit: 8 })).entries.map(
        ({ message }) => message.messageUid,
      ),
      ["retained", "appended"],
    );
    await assert.rejects(
      reader.readContentPage({
        snapshot,
        ...scope,
        messageUid: "removed",
        contentReference: accepted.result.messageReceipts.find(
          ({ messageUid }) => messageUid === "removed",
        ).contentReference,
        cursor: null,
        limit: 1,
      }),
      { code: "SESSION_MESSAGE_NOT_FOUND" },
    );
  });
});

test("failed deletion publication preserves the suffix and command identity for cold retry", async (t) => {
  const { journal, sessionId, root } = await createMessageCase(
    t,
    { transactionBytes: 16 * 1024 },
    { autoClose: false },
  );
  const repository = openTestMessages(journal, sessionId);
  const other = { dialogProcessId: "other-dialog", turnScopeId: "other-turn" };
  const retainedRow = ["retained", scope.turnScopeId, scope.dialogProcessId, 1];
  await repository.commit(
    await prepare(journal, repository, "seed-fault", {
      messages: [
        message(sessionId, "retained"),
        { ...message(sessionId, "anchor"), ...other },
        message(sessionId, "removed"),
      ],
    }),
  );
  const request = await prepare(journal, repository, "delete-fault", {
    messageDeletion: {
      commandId: "delete-fault",
      anchor: { turnScopeId: other.turnScopeId },
    },
  });
  const before = journal.head.sequence;
  const adapter = getFsAdapter();
  let injected = false;
  setFsAdapter({
    ...adapter,
    async rename(source, target) {
      if (String(target).endsWith("/CURRENT")) {
        injected = true;
        throw new Error("deletion publication fault");
      }
      return adapter.rename(source, target);
    },
  });
  try {
    await assert.rejects(repository.commit(request), { code: "SESSION_COMMIT_UNCERTAIN" });
    await assert.rejects(journal.close(), { code: "SESSION_COMMIT_UNCERTAIN" });
  } finally {
    setFsAdapter(adapter);
  }
  assert.equal(injected, true);
  const reopened = await PartitionJournal.open({ root, sessionId });
  t.after(() => reopened.close());
  const reader = openTestMessages(reopened, sessionId);
  assert.equal(reopened.head.sequence, before);
  await reopened.usingSnapshot(async (snapshot) => {
    await requireDisplayOwners(reader, snapshot, [
      retainedRow,
      ["anchor", other.turnScopeId, other.dialogProcessId, 2],
      ["removed", scope.turnScopeId, scope.dialogProcessId, 3],
    ]);
    const page = await reader.readSessionMessageOrderPage({ snapshot, cursor: null, limit: 8 });
    assert.deepEqual(page.entries, ["retained", "anchor", "removed"]);
    const commands = await new PartitionTransactions(reopened).getLatestMany({
      snapshot,
      collection: "commands",
      keys: ["delete-fault"],
    });
    assert.equal(commands.get("delete-fault"), null);
  });
  const committed = await reader.commit(request);
  assert.equal(committed.replayed, false);
  assert.equal(committed.result.messageDeletion.receipt.result.deletedCount, 2);
  assert.deepEqual(await reader.commit(request), { ...committed, replayed: true });
  await reopened.usingSnapshot(async (snapshot) => {
    await requireDisplayOwners(reader, snapshot, [retainedRow]);
    const page = await reader.readSessionMessageOrderPage({ snapshot, cursor: null, limit: 8 });
    assert.deepEqual(page.entries, ["retained"]);
  });
});

for (const [pageRecords, withLifecycle] of [
  [1, false],
  [1, true],
  [2, false],
  [2, true],
  [8, false],
  [8, true],
]) {
  test(`interleaved deletion preserves first-occurrence receipt order with ${pageRecords}-record pages, lifecycle=${withLifecycle}`, async (t) => {
    const { journal, sessionId, root } = await createMessageCase(t, {
      pageRecords,
      transactionBytes: 16 * 1024,
    });
    const repository = openTestMessages(journal, sessionId);
    const entries = [
      ["prefix", "retained"],
      ["a1", "a"],
      ["b1", "b"],
      ["a2", "a"],
      ["c1", "c"],
      ["b2", "b"],
    ];
    for (const [uid, turnScopeId] of entries) {
      const turnTransition =
        withLifecycle && ["a1", "b1", "c1"].includes(uid)
          ? {
              ...scope,
              sessionId,
              turnScopeId,
              commandId: `accept-${uid}`,
              causationId: `accept-${uid}`,
              eventType: "turn.action_accepted",
              phase: "action",
              action: "send",
              presentationMessageId: `presentation-${uid}`,
              executionId: `agent:${turnScopeId}`,
              executionKind: "agent",
              rootExecutionId: `agent:${turnScopeId}`,
            }
          : undefined;
      const seeded = await repository.commit(
        await prepare(journal, repository, `seed-${uid}`, {
          messages: [{ ...message(sessionId, uid), turnScopeId }],
          ...(turnTransition ? { turnTransition } : {}),
        }),
      );
      if (!turnTransition) continue;
      assert.equal(seeded.result.turnTransition.applied, true);
      for (const [eventType, phase, extra] of [
        ["turn.processing_started", "processing", {}],
        ["turn.processing_completed", "completion", { completionCommitId: `completed-${uid}` }],
        [
          "turn.completed",
          "completion",
          { commandId: `completed-${uid}`, terminalStatus: { command: "completed" } },
        ],
      ]) {
        const completed = await repository.commit(
          await prepare(journal, repository, `${eventType}-${uid}`, {
            turnTransition: {
              ...scope,
              sessionId,
              turnScopeId,
              eventType,
              phase,
              commandId: `${eventType}-${uid}`,
              causationId: `${eventType}-${uid}`,
              ...extra,
            },
          }),
        );
        assert.equal(completed.result.turnTransition.applied, true);
      }
    }
    const changes = {
      messageDeletion: { commandId: "delete-interleaved-order", anchor: { turnScopeId: "a" } },
    };
    const request = await prepare(journal, repository, "delete-interleaved-order", changes);
    const selection = { cursor: null, direction: "forward", limit: 1, maxBytes: 4096 };
    const readDisplay = (repo, snapshot) => repo.readDisplayPage({ snapshot, selection });
    const requireRetainedPrefix = async (repo, snapshot) => {
      const { stats, messages, nextCursor } = await readDisplay(repo, snapshot);
      assert.equal(stats.messageCount, 1);
      assert.equal(stats.displayMessageCount, 1);
      assert.equal(messages.length, 1);
      assert.equal(await readDisplayBody(repo, snapshot, messages[0]), "prefix");
      assert.equal(nextCursor, null);
    };
    const committed = await journal.usingSnapshot(async (snapshot) => {
      const before = await readDisplay(repository, snapshot);
      assert.equal(before.stats.messageCount, entries.length);
      assert.ok(before.nextCursor);
      const result = await repository.commit(request);
      assert.deepEqual(await readDisplay(repository, snapshot), before);
      await journal.usingSnapshot(async (current) => {
        await requireRetainedPrefix(repository, current);
      });
      return result;
    });
    const expected = {
      anchorIndex: 1,
      deletedCount: 5,
      deletedTurnScopeIds: ["a", "b", "c"],
    };
    assert.deepEqual(committed.result.messageDeletion.receipt.result, expected);
    await journal.close();
    const reopened = await PartitionJournal.open({ root, sessionId });
    t.after(() => reopened.close());
    const reader = openTestMessages(reopened, sessionId);
    assert.deepEqual(await reader.commit(request), { ...committed, replayed: true });
    const duplicate = await reader.commit(
      await prepare(reopened, reader, "replay-command-order", changes),
    );
    assert.equal(duplicate.result.messageDeletion.deduplicated, true);
    assert.deepEqual(duplicate.result.messageDeletion.receipt.result, expected);
    await reopened.usingSnapshot(async (snapshot) => {
      await requireRetainedPrefix(reader, snapshot);
      const transactions = new PartitionTransactions(reopened);
      for (const key of withLifecycle ? expected.deletedTurnScopeIds : []) {
        const ranges = await transactions.getLatestMany({
          snapshot,
          collection: "turnOutbox",
          keys: [key],
        });
        assert.equal(ranges.get(key).value.eventCount, 0);
        assert.ok(ranges.get(key).value.removedThrough > 0);
      }
      assert.deepEqual(
        await reader.readSessionMessageOrderPage({ snapshot, cursor: null, limit: 1 }),
        { entries: ["prefix"], nextCursor: null },
      );
    });
  });
}
