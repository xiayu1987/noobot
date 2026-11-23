/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import { join } from "node:path";
import { test } from "node:test";
import { decodeStoredAuthorityOutboxEvent } from "@noobot/event-protocol/outbox";
import { PARTITION_SESSION_METADATA } from "@noobot/session-protocol/partition-transaction";
import { PartitionJournal } from "../../src/session/partition-storage/partition-journal.js";
import { openPartitionSessionReader } from "../../src/session/partition-storage/partition-session-reader.js";
import { PartitionTransactions } from "../../src/session/partition-storage/partition-transactions.js";
import { partitionToolPairKey } from "@noobot/session-protocol/partition-tool-pairs";
import { getFsAdapter, setFsAdapter } from "../../src/shared/storage/fs-adapter.js";
import {
  committedAt,
  scope,
  message,
  prepare,
  openTestMessages,
  createMessageCase,
} from "./partition-session-messages.test-helpers.js";

test("a partition commits message, lifecycle, timing and event together and replays after reopening", async (t) => {
  const { journal, sessionId, root } = await createMessageCase(t, { transactionBytes: 8 * 1024 });
  const repository = openTestMessages(journal, sessionId);
  const turnTransition = {
    ...scope,
    sessionId,
    commandId: "accept-command",
    causationId: "accept-command",
    eventType: "turn.action_accepted",
    phase: "action",
    action: "send",
    presentationMessageId: "presentation-m1",
    executionId: "agent:turn-1",
    executionKind: "agent",
    rootExecutionId: "agent:turn-1",
  };
  const request = await prepare(journal, repository, "accept", {
    messages: [
      {
        ...scope,
        sessionId,
        messageUid: "m1",
        role: "user",
        messageOrigin: "natural",
        type: "message",
        content: "m1",
        attachments: [],
        ts: committedAt,
        pending: true,
        turnCommit: { action: "send", commandId: turnTransition.causationId },
      },
    ],
    turnTransition,
    timings: [{ ...scope, thinkingFinishedAt: committedAt }],
  });
  const before = journal.work.publications;
  const committed = await repository.commit(request);
  assert.equal(committed.result.turnTransition.applied, true);
  assert.equal(journal.work.publications, before + 1);
  const rejected = await prepare(journal, repository, "duplicate-command", {
    messages: [message(sessionId, "not-published")],
    turnTransition,
  });
  const aborted = await repository.commit(rejected);
  assert.equal(aborted.status, "aborted");
  assert.equal(aborted.result.turnTransition.deduplicated, true);
  assert.deepEqual(aborted.result.messageReceipts, []);
  assert.equal(journal.work.publications, before + 1);

  await journal.close();
  const reopened = await PartitionJournal.open({ root, sessionId });
  t.after(() => reopened.close());
  const reader = openTestMessages(reopened, sessionId);
  assert.deepEqual(await reader.commit(request), { ...committed, replayed: true });
  const { eventId } = committed.result.turnTransition.committedEvent;
  const transactions = new PartitionTransactions(reopened);
  await reopened.usingSnapshot(async (snapshot) => {
    const { collection, key } = PARTITION_SESSION_METADATA;
    const metadata = await transactions.getLatestMany({ snapshot, collection, keys: [key] });
    assert.equal(metadata.get(key).value.aggregateVersion, 1);
    assert.deepEqual(await reader.readTurnTiming({ snapshot, turnScopeId: scope.turnScopeId }), {
      ...scope,
      thinkingFinishedAt: committedAt,
    });
    const page = await reader.readTurnPage({ snapshot, ...scope, cursor: null, limit: 2 });
    assert.deepEqual(
      page.entries.map(({ message }) => message.messageUid),
      ["m1"],
    );
    const lifecycle = await transactions.getLatestMany({
      snapshot,
      collection: "lifecycle",
      keys: [scope.turnScopeId],
    });
    assert.equal(lifecycle.get(scope.turnScopeId).value.commandId, turnTransition.commandId);
    const events = await transactions.getLatestMany({
      snapshot,
      collection: "events",
      keys: [eventId],
    });
    const stored = events.get(eventId).value;
    assert.deepEqual(stored.envelope, committed.result.turnTransition.committedEvent.envelope);
    assert.deepEqual(decodeStoredAuthorityOutboxEvent(stored), {
      ...committed.result.turnTransition.committedEvent,
      deliveries: {},
      ordinal: 1,
    });
  });

  const beforeTiming = reopened.head.sequence;
  const conflicting = await prepare(reopened, reader, "conflicting-timing", {
    messages: [message(sessionId, "uncommitted-timing-message")],
    timings: [{ ...scope, dialogProcessId: "other-dialog", modelLoopRound: 2 }],
  });
  await assert.rejects(reader.commit(conflicting), { code: "SESSION_TURN_TIMING_CONFLICT" });
  assert.equal(reopened.head.sequence, beforeTiming);
  await reader.commit(
    await prepare(reopened, reader, "timing-only", {
      timings: [{ ...scope, modelLoopRound: 2 }],
    }),
  );
  await reopened.usingSnapshot(async (snapshot) => {
    assert.deepEqual(await reader.readTurnTiming({ snapshot, turnScopeId: scope.turnScopeId }), {
      ...scope,
      thinkingFinishedAt: committedAt,
      modelLoopRound: 2,
    });
  });

  const transition = async (eventType, phase, extra = {}) => {
    const request = await prepare(reopened, reader, eventType, {
      turnTransition: {
        ...scope,
        sessionId,
        commandId: eventType,
        causationId: eventType,
        eventType,
        phase,
        ...extra,
      },
    });
    const outcome = await reader.commit(request);
    assert.equal(outcome.result.turnTransition.applied, true);
    return outcome;
  };
  await transition("turn.processing_started", "processing");
  const assistant = await prepare(reopened, reader, "assistant-message", {
    messages: [{ ...message(sessionId, "assistant-1"), pending: true }],
  });
  await reader.commit(assistant);
  await transition("turn.processing_completed", "completion", { completionCommitId: "completed" });
  const openReader = (journal) =>
    openPartitionSessionReader({ journal, sessionId, parentSessionId: "" });
  const page = (snapshot) => reader.readTurnPage({ snapshot, ...scope, cursor: null, limit: 2 });
  const displayPending = async (sessionReader) => {
    const { messages } = await sessionReader.readDisplayPage({
      direction: "backward",
      cursor: null,
      limit: 5,
      maxBytes: 16 * 1024,
    });
    return messages.find(({ messageUid }) => messageUid === "assistant-1").pending;
  };
  await reopened.usingSnapshot(async (beforeTerminal) => {
    await using retained = await openReader(reopened);
    const sourceBefore = await retained.readLifecycleSource({ terminalLimit: 1 });
    assert.equal(await displayPending(retained), true);
    const terminal = await transition("turn.completed", "completion", {
      commandId: "completed",
      terminalStatus: { command: "completed" },
    });
    assert.equal(terminal.result.turnTransition.terminalMaterialization.materialized, true);
    assert.deepEqual(await retained.readLifecycleSource({ terminalLimit: 1 }), sourceBefore);
    assert.equal(await displayPending(retained), true);
    await using current = await openReader(reopened);
    assert.equal(await displayPending(current), false);
    assert.deepEqual(
      (await page(beforeTerminal)).entries.map(({ message }) => message.pending),
      [true, true],
    );
    await reopened.usingSnapshot(async (snapshot) => {
      assert.deepEqual(
        (await page(snapshot)).entries.map(({ message }) => [message.messageUid, message.pending]),
        [
          ["m1", true],
          ["assistant-1", false],
        ],
      );
      const stored = await transactions.getLatestMany({
        snapshot,
        collection: "messages",
        keys: ["assistant-1"],
      });
      assert.equal(stored.get("assistant-1").value.message.pending, true);
    });
  });
  await reopened.close();
  const cold = await PartitionJournal.open({ root, sessionId });
  t.after(() => cold.close());
  await using current = await openReader(cold);
  assert.equal(await displayPending(current), false);
  const source = await current.readLifecycleSource({ terminalLimit: 1 });
  assert.equal(source.turnLifecycle.activeTurnScopeId, "");
  assert.deepEqual(Object.keys(source.turnLifecycle.turns), [scope.turnScopeId]);
  assert.deepEqual(
    source.turnLifecycle.turns[scope.turnScopeId],
    await current.readTurnState(scope.turnScopeId),
  );
  assert.deepEqual(source.messageTurnScopeIds, [scope.turnScopeId]);
  assert.deepEqual(source.turnTimings, [await current.readTurnTiming(scope.turnScopeId)]);
  assert.deepEqual(
    (await current.readLifecycleSource({ terminalLimit: 0 })).turnLifecycle.turns,
    {},
  );
});

test("tool pair facts survive rolling and reject a duplicate declaration atomically", async (t) => {
  const { journal, sessionId, root } = await createMessageCase(t, { partitionRecords: 1 });
  const repository = openTestMessages(journal, sessionId);
  const call = (uid) => ({
    ...message(sessionId, uid),
    type: "tool_call",
    tool_calls: [
      { id: "call-1", type: "function", function: { name: "read_file", arguments: "{}" } },
    ],
  });
  const { modelMessageId: _model, ...result } = message(sessionId, "result");
  await repository.commit(
    await prepare(journal, repository, "result", {
      messages: [{ ...result, role: "tool", type: "tool_result", tool_call_id: "call-1" }],
    }),
  );
  await journal.close();
  const reopened = await PartitionJournal.open({ root, sessionId });
  t.after(() => reopened.close());
  const cold = openTestMessages(reopened, sessionId);
  await cold.commit(await prepare(reopened, cold, "call", { messages: [call("owner")] }));
  const sequence = reopened.head.sequence;
  await assert.rejects(
    cold.commit(
      await prepare(reopened, cold, "conflict", {
        messages: [message(sessionId, "unpublished"), call("other-owner")],
      }),
    ),
    { code: "SESSION_MESSAGE_IDENTITY_CONFLICT" },
  );
  assert.equal(reopened.head.sequence, sequence);
  await reopened.usingSnapshot(async (snapshot) => {
    const identity = JSON.stringify([scope.dialogProcessId, scope.turnScopeId, "call-1"]);
    const key = partitionToolPairKey(identity);
    const pairs = await new PartitionTransactions(reopened).getLatestMany({
      snapshot,
      collection: "toolPairs",
      keys: [key],
    });
    assert.deepEqual(pairs.get(key).value, { identity, ownerUid: "owner", resultCount: 1 });
    const page = await cold.readTurnPage({ snapshot, ...scope, cursor: null, limit: 4 });
    assert.deepEqual(
      page.entries.map(({ message }) => message.messageUid),
      ["result", "owner"],
    );
  });
});

test("checkpoint sees staged tool pairs and cold replays without rewriting messages", async (t) => {
  const { journal, sessionId, root } = await createMessageCase(t, {
    partitionRecords: 1,
    transactionBytes: 8 * 1024,
  });
  const repository = openTestMessages(journal, sessionId);
  const call = {
    ...message(sessionId, "call"),
    type: "tool_call",
    tool_calls: [
      { id: "call-1", type: "function", function: { name: "read_file", arguments: "{}" } },
    ],
  };
  const { modelMessageId: _model, ...result } = message(sessionId, "result");
  const messages = [call, { ...result, role: "tool", type: "tool_result", tool_call_id: "call-1" }];
  const checkpoint = {
    ...scope,
    sessionId,
    userId: "admin",
    checkpointId: "summary-1",
    expectedCheckpointRevision: 0,
    messages,
    persistedMessageUids: ["call", "result"],
    summarizedMessageUids: ["call", "result"],
    retainedMessageUids: [],
  };
  const changes = { messages, summaryCheckpoints: [checkpoint] };
  const before = journal.head.sequence;
  const split = await prepare(journal, repository, "split-summary", {
    ...changes,
    summaryCheckpoints: [{ ...checkpoint, summarizedMessageUids: ["call"] }],
  });
  await assert.rejects(repository.commit(split), {
    code: "TURN_SUMMARY_CHECKPOINT_TOOL_PAIR_SPLIT",
  });
  assert.equal(journal.head.sequence, before);
  const request = await prepare(journal, repository, "summary", changes);
  const committed = await repository.commit(request);
  const [summary] = committed.result.summaryCheckpoints;
  assert.equal(summary.receipt.checkpointRevision, 1);
  assert.equal(summary.markedCount, 2);
  assert.deepEqual(summary.messageReceipts, committed.result.messageReceipts);
  assert.deepEqual(
    summary.messageReceipts.map(({ messageUid }) => messageUid),
    ["call", "result"],
  );
  assert.equal(journal.head.sequence, before + 1);
  await journal.close();
  const reopened = await PartitionJournal.open({ root, sessionId });
  t.after(() => reopened.close());
  const cold = openTestMessages(reopened, sessionId);
  assert.deepEqual((await cold.commit(request)).result, committed.result);
  const duplicate = await cold.commit(await prepare(reopened, cold, "summary-retry", changes));
  assert.equal(duplicate.status, "aborted");
  assert.deepEqual(duplicate.result.summaryCheckpoints[0].receipt, summary.receipt);
  assert.deepEqual(duplicate.result.summaryCheckpoints[0].messageReceipts, summary.messageReceipts);
  assert.equal(reopened.head.sequence, before + 1);
  await reopened.usingSnapshot(async (snapshot) => {
    const page = await cold.readTurnPage({ snapshot, ...scope, cursor: null, limit: 4 });
    assert.deepEqual(
      page.entries.map(({ message }) => [message.messageUid, message.summarized]),
      [
        ["call", true],
        ["result", true],
      ],
    );
  });
});

test("failed checkpoint publication exposes neither messages nor checkpoint state on reopen", async (t) => {
  const { journal, sessionId, root } = await createMessageCase(t, {}, { autoClose: false });
  const repository = openTestMessages(journal, sessionId);
  const messages = [message(sessionId, "summary-source")];
  const checkpoint = {
    ...scope,
    sessionId,
    userId: "admin",
    checkpointId: "summary-fault",
    expectedCheckpointRevision: 0,
    messages,
    persistedMessageUids: ["summary-source"],
    summarizedMessageUids: ["summary-source"],
    retainedMessageUids: [],
  };
  const before = journal.head.sequence;
  const checkpointTime = "2026-11-19T00:01:00.000Z";
  const request = await journal.usingSnapshot((snapshot) =>
    repository.prepareRequest(snapshot, {
      operationId: "summary-fault",
      committedAt: checkpointTime,
      changes: { messages, summaryCheckpoints: [checkpoint] },
    }),
  );
  const adapter = getFsAdapter();
  let injected = false;
  setFsAdapter({
    ...adapter,
    async rename(source, target) {
      if (String(target) === join(root, "CURRENT")) {
        injected = true;
        throw Object.assign(new Error("Injected checkpoint publication failure"), { code: "EIO" });
      }
      return adapter.rename(source, target);
    },
  });
  try {
    await assert.rejects(repository.commit(request), { code: "SESSION_COMMIT_UNCERTAIN" });
    await assert.rejects(journal.close(), { code: "SESSION_COMMIT_UNCERTAIN" });
    assert.equal(injected, true);
  } finally {
    setFsAdapter(adapter);
  }
  const reopened = await PartitionJournal.open({ root, sessionId });
  t.after(() => reopened.close());
  const cold = openTestMessages(reopened, sessionId);
  await reopened.usingSnapshot(async (snapshot) => {
    assert.equal(snapshot.sequence, before);
    const page = await cold.readTurnPage({ snapshot, ...scope, cursor: null, limit: 4 });
    assert.deepEqual(page.entries, []);
    const transactions = new PartitionTransactions(reopened);
    for (const [collection, key] of [
      ["checkpointHeads", scope.turnScopeId],
      ["checkpoints", JSON.stringify([scope.turnScopeId, checkpoint.checkpointId])],
    ]) {
      const values = await transactions.getLatestMany({ snapshot, collection, keys: [key] });
      assert.equal(values.get(key), null);
    }
  });
  const committed = await cold.commit(request);
  assert.equal(committed.replayed, false);
  assert.equal(committed.result.summaryCheckpoints[0].markedCount, 1);
  assert.equal(reopened.head.sequence, before + 1);
  await reopened.usingSnapshot(async (snapshot) => {
    const { collection, key } = PARTITION_SESSION_METADATA;
    const transactions = new PartitionTransactions(reopened);
    const metadata = await transactions.getLatestMany({ snapshot, collection, keys: [key] });
    assert.equal(metadata.get(key).value.updatedAt, checkpointTime);
  });
});
