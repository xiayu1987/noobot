/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import { borrowFixtureJournal } from "../helpers/partition-journal-lease.js";
import { test } from "node:test";
import { createPartitionSessionReaderAccess } from "../../src/session/partition-storage/partition-reader-access.js";
import { PartitionJournal } from "../../src/session/partition-storage/partition-journal.js";
import { createTransactionCase } from "../helpers/partition-journal-cases.js";
import { emptyPartitionSession } from "../helpers/partition-session-cases.js";

const committedAt = "2026-11-20T00:00:00.000Z";

function initialization(sessionId) {
  const turnTransition = {
    sessionId,
    dialogProcessId: "dialog",
    turnScopeId: "turn",
    commandId: "send",
    causationId: "send",
    eventType: "turn.action_accepted",
    phase: "action",
    action: "send",
    presentationMessageId: "presentation",
    executionId: "agent:turn",
    executionKind: "agent",
    rootExecutionId: "agent:turn",
  };
  return {
    operationId: "create",
    session: emptyPartitionSession({ sessionId, parentSessionId: "", committedAt }),
    scopedMetadata: null,
    initialTurn: {
      committedAt,
      changes: {
        turnTransition,
        messages: [
          {
            sessionId,
            dialogProcessId: "dialog",
            turnScopeId: "turn",
            messageUid: "user-message",
            userMessageId: "input",
            role: "user",
            type: "message",
            messageOrigin: "natural",
            content: "first input",
            attachments: [],
            ts: committedAt,
            pending: true,
            turnCommit: { action: "send", commandId: "send" },
          },
        ],
      },
    },
  };
}

test("access publishes the first turn atomically and replays its result after reopening", async (t) => {
  const { journal, root, sessionId } = await createTransactionCase(t, {
    transactionBytes: 16 * 1024,
  });
  const scope = { sessionId, sessionDir: root, parentSessionId: "" };
  let owned = journal;
  const access = createPartitionSessionReaderAccess({
    acquireJournal: async () => borrowFixtureJournal(owned),
    withJournalRemoval: () => assert.fail("Unexpected journal removal"),
  });
  const input = initialization(sessionId);
  const before = journal.work.publications;
  const created = await access.create(scope, input);
  assert.equal(created.generation, 1);
  assert.equal(journal.work.publications, before + 1);
  assert.equal(created.result.metadata.aggregateVersion, 1);
  assert.equal(created.result.turnTransition.applied, true);
  await using reader = await access.open(scope);
  assert.equal((await reader.readMetadata()).aggregateVersion, 1);
  const messages = await reader.readMessagePage({ limit: 1 });
  assert.equal(messages.records[0].message.content, "first input");
  assert.equal((await reader.readLifecycleHead()).activeTurnScopeId, "turn");
  const events = await reader.readOutboxPage({ consumerId: "test", limit: 1 });
  assert.equal(events.events.length, 1);
  assert.equal(events.events[0].eventId, created.result.turnTransition.committedEvent.eventId);
  assert.equal((await reader.readCommand("send")).eventId, events.events[0].eventId);
  await reader.close();
  await journal.close();
  owned = await PartitionJournal.open({ root, sessionId });
  t.after(() => owned.close());
  const head = owned.head;
  assert.deepEqual(await access.create(scope, input), { ...created, replayed: true });
  assert.deepEqual(owned.head, head);
});

test("invalid first turn publishes neither an empty session nor partial authority", async (t) => {
  const { journal, root, sessionId } = await createTransactionCase(t, {
    transactionBytes: 16 * 1024,
  });
  const access = createPartitionSessionReaderAccess({
    acquireJournal: async () => borrowFixtureJournal(journal),
    withJournalRemoval: () => assert.fail("Unexpected journal removal"),
  });
  const scope = { sessionId, sessionDir: root, parentSessionId: "" };
  const invalid = initialization(sessionId);
  invalid.initialTurn.changes.messages[0].turnScopeId = "foreign";
  const head = journal.head;
  await assert.rejects(access.create(scope, invalid));
  assert.deepEqual(journal.head, head);
  assert.equal(await access.readPlacement(scope), null);
  const created = await access.create(scope, initialization(sessionId));
  assert.equal(created.generation, 1);
});
