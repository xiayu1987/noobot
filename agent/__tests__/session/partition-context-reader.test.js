/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { projectContextSource } from "@noobot/context-protocol/assembly/source";
import { CONTEXT_READ_LIMITS } from "@noobot/session-protocol/context-read-budget";
import { PARTITION_CONTEXT_ROOT } from "@noobot/session-protocol/partition-context-index";
import { PARTITION_MESSAGE_COLLECTIONS } from "@noobot/session-protocol/partition-session-messages";
import { openPartitionSessionReader } from "../../src/session/partition-storage/partition-session-reader.js";
import { PartitionJournal } from "../../src/session/partition-storage/partition-journal.js";
import { PartitionTransactions } from "../../src/session/partition-storage/partition-transactions.js";
import { commitFixtureTransaction } from "../helpers/partition-journal-cases.js";
import {
  createMessageCase,
  openTestMessages,
  prepare,
  message,
} from "./partition-session-messages.test-helpers.js";

const open = (journal, sessionId) =>
  openPartitionSessionReader({ journal, sessionId, parentSessionId: "" });
const ids = (source) => source.messages.map(({ messageUid }) => messageUid);
const historical = (sessionId, id, fields = {}) => ({
  ...message(sessionId, id),
  dialogProcessId: `dialog-${id}`,
  turnScopeId: `turn-${id}`,
  ...fields,
});

async function fixture(t, limits = {}) {
  const state = await createMessageCase(t, { transactionBytes: 16 * 1024, ...limits });
  const repository = openTestMessages(state.journal, state.sessionId);
  const commit = async (operationId, changes) =>
    repository.commit(await prepare(state.journal, repository, operationId, changes));
  return { ...state, repository, commit };
}

test("stopped partition context retains the natural user and latest injection per source and type", async (t) => {
  const { journal, sessionId, commit } = await fixture(t);
  const scope = { sessionId, dialogProcessId: "dialog-stopped", turnScopeId: "turn-stopped" };
  const entry = (id, fields) => ({ ...message(sessionId, id), ...scope, ...fields });
  const user = (id, fields) => {
    const { content, ts, attachments, type, messageUid } = entry(id);
    return { ...scope, content, ts, attachments, type, messageUid, role: "user", ...fields };
  };
  const transition = async (commandId, eventType, phase, extra = {}, messages) => {
    const result = await commit(commandId, {
      ...(messages ? { messages } : {}),
      turnTransition: { ...scope, commandId, causationId: commandId, eventType, phase, ...extra },
    });
    assert.equal(result.result.turnTransition.applied, true);
  };
  const injection = (id, injectedBy, injectedMessageType) =>
    user(id, { injectedMessage: true, injectedBy, injectedMessageType });
  await transition(
    "accept",
    "turn.action_accepted",
    "action",
    {
      action: "send",
      presentationMessageId: "presentation-original",
      executionId: "agent:turn-stopped",
      executionKind: "agent",
      rootExecutionId: "agent:turn-stopped",
    },
    [
      user("original", {
        messageOrigin: "natural",
        pending: true,
        turnCommit: { action: "send", commandId: "accept" },
      }),
    ],
  );
  await transition("start", "turn.processing_started", "processing");
  await commit("responses", {
    messages: [
      injection("old-guidance", "harness-plugin:context", "guidance"),
      injection("other-guidance", "harness-plugin", "context:guidance"),
      injection("planning", "harness-plugin", "planning"),
      injection("new-guidance", "harness-plugin:context", "guidance"),
      entry("partial", { pending: true }),
    ],
  });
  await transition("stop", "turn.stop_accepted", "stop");
  await transition("stop-processing", "turn.stop_processing_completed", "stop", {
    completionCommitId: "stopped",
  });
  await transition("stopped", "turn.stop_completed", "stop", {
    terminalStatus: { command: "user_stopped" },
  });
  await using reader = await open(journal, sessionId);
  const source = await reader.readContextSource({ historyLimit: 1 });
  assert.deepEqual(ids(source), ["original", "other-guidance", "planning", "new-guidance"]);
  const stored = await reader.readTurnState(scope.turnScopeId);
  assert.deepEqual(source.turnLifecycle.turns[scope.turnScopeId], stored);
  const projected = projectContextSource({ source, historyLimit: 1 }).messages;
  assert.deepEqual(
    projected.map(({ content }) => content),
    ["original", "other-guidance", "planning", "new-guidance", stored.terminalStatus.description],
  );
});

test("partition context reads indexed windows, observes metadata membership and pins the old snapshot", async (t) => {
  const { journal, sessionId, commit } = await fixture(t);
  const created = await commit("seed", {
    messages: [
      historical(sessionId, "old"),
      historical(sessionId, "recent"),
      historical(sessionId, "active"),
    ],
  });
  await using pinned = await open(journal, sessionId);
  const options = {
    scope: { dialogProcessId: "dialog-active", turnScopeId: "turn-active" },
    historyLimit: 1,
  };
  assert.deepEqual(ids(await pinned.readContextSource(options)), ["recent"]);
  const receipt = created.result.messageReceipts.find(({ messageUid }) => messageUid === "recent");
  await commit("summarize", {
    messageMetadataUpdates: [
      {
        messageUid: receipt.messageUid,
        dialogProcessId: receipt.dialogProcessId,
        turnScopeId: receipt.turnScopeId,
        expectedContentReference: receipt.contentReference,
        owner: receipt.owner,
        metadata: { summarized: true },
        metadataRemovals: [],
      },
    ],
  });
  await using current = await open(journal, sessionId);
  assert.deepEqual(ids(await current.readContextSource(options)), ["old"]);
  assert.deepEqual(ids(await pinned.readContextSource(options)), ["recent"]);
  assert.deepEqual(ids(await current.readContextSource({ historyLimit: 0 })), []);
  await assert.rejects(current.readContextSource({ historyLimit: -1 }), TypeError);
});

test("partition context retires interleaved suffix candidates and survives reopen", async (t) => {
  const { journal, sessionId, root, commit } = await fixture(t);
  await commit("seed", {
    messages: [
      historical(sessionId, "keep"),
      historical(sessionId, "delete"),
      historical(sessionId, "later", { dialogProcessId: "dialog-keep", turnScopeId: "turn-keep" }),
    ],
  });
  await commit("delete", {
    messageDeletion: { commandId: "delete", anchor: { turnScopeId: "turn-delete" } },
  });
  await journal.close();
  const cold = await PartitionJournal.open({ root, sessionId });
  t.after(() => cold.close());
  await using reader = await open(cold, sessionId);
  assert.deepEqual(ids(await reader.readContextSource({ historyLimit: 10 })), ["keep"]);
});

test("partition context rejects candidate and body budgets explicitly", async (t) => {
  const { journal, sessionId, commit } = await fixture(t);
  await commit("seed", {
    messages: [
      historical(sessionId, "a"),
      historical(sessionId, "b", {
        dialogProcessId: "dialog-a",
        turnScopeId: "turn-a",
        content: "x".repeat(4000),
      }),
    ],
  });
  await using reader = await open(journal, sessionId);
  await assert.rejects(
    reader.readContextSource({
      historyLimit: 1,
      limits: { ...CONTEXT_READ_LIMITS, candidates: 1 },
    }),
    { code: "SESSION_CONTEXT_READ_BUDGET_EXCEEDED", dimension: "candidates" },
  );
  await assert.rejects(
    reader.readContextSource({
      historyLimit: 1,
      limits: { ...CONTEXT_READ_LIMITS, bytes: 3000 },
    }),
    { code: "SESSION_CONTEXT_READ_BUDGET_EXCEEDED", dimension: "bytes" },
  );
});

test("partition context rejects missing directory without an aggregation fallback", async (t) => {
  const { journal, sessionId, commit } = await fixture(t);
  await commit("seed", { messages: [historical(sessionId, "a")] });
  const transactions = new PartitionTransactions(journal);
  const stored = await journal.usingSnapshot(async (snapshot) =>
    (
      await transactions.lookupLatestMany({
        snapshot,
        collection: PARTITION_CONTEXT_ROOT.collection,
        keys: [PARTITION_CONTEXT_ROOT.key],
      })
    ).get(PARTITION_CONTEXT_ROOT.key),
  );
  await commitFixtureTransaction(transactions, {
    epoch: journal.head.epoch,
    expectedGeneration: journal.head.sequence,
    sequence: journal.head.sequence + 1,
    operationId: "damage-context",
    input: {},
    result: null,
    mutations: [{ ...PARTITION_CONTEXT_ROOT, owner: stored.owner, remove: true }],
  });
  await using reader = await open(journal, sessionId);
  const { sequence, activeTurnScopeId } = await reader.readLifecycleHead();
  assert.deepEqual(await reader.readContextSource({ historyLimit: 0 }), {
    messages: [],
    turnLifecycle: { sequence, activeTurnScopeId, turns: {} },
  });
  await assert.rejects(reader.readContextSource({ historyLimit: 1 }), {
    code: "SESSION_STORAGE_CORRUPT",
  });
});

test("cold context admits complete dialogs before reading any bodies", async (t) => {
  const { journal, root, sessionId, commit } = await fixture(t, {
    pageBytes: 512 * 1024,
    pageRecords: 8,
  });
  for (let i = 0; i < 64; i += 1) {
    await commit(`old-${i}`, { messages: [historical(sessionId, `old-${i}`)] });
    await commit(`dense-${i}`, {
      messages: [
        historical(sessionId, `dense-${i}`, {
          dialogProcessId: "dialog-dense",
          turnScopeId: "turn-dense",
        }),
      ],
    });
  }
  const dialog = { dialogProcessId: "dialog-tool", turnScopeId: "turn-tool" };
  const { modelMessageId: _model, ...toolResult } = historical(sessionId, "result");
  await commit("tool-pair", {
    messages: [
      historical(sessionId, "call", {
        ...dialog,
        type: "tool_call",
        tool_calls: [
          { id: "call-1", type: "function", function: { name: "read_file", arguments: "{}" } },
        ],
      }),
      {
        ...toolResult,
        ...dialog,
        role: "tool",
        type: "tool_result",
        tool_call_id: "call-1",
        content: "x".repeat(4096),
      },
    ],
  });
  await journal.close();

  async function probe(historyLimit, limits, verify) {
    const cold = await PartitionJournal.open({ root, sessionId });
    try {
      const counts = { messages: 0, messageContent: 0 };
      const readSlots = cold.readRecordSlots.bind(cold);
      t.mock.method(cold, "readRecordSlots", async (query) => {
        const slots = await readSlots(query);
        for (const { mutation } of slots.values()) {
          const { collection } = mutation;
          if (collection === PARTITION_MESSAGE_COLLECTIONS.messages) counts.messages += 1;
          if (collection === PARTITION_MESSAGE_COLLECTIONS.content) counts.messageContent += 1;
        }
        return slots;
      });
      await using reader = await open(cold, sessionId);
      const before = cold.work.readBytes;
      await verify(reader.readContextSource({ historyLimit, limits }));
      return { ...counts, bytes: cold.work.readBytes - before };
    } finally {
      await cold.close();
    }
  }

  const limits = { ...CONTEXT_READ_LIMITS, candidates: 8 };
  const selected = await probe(1, limits, async (result) => {
    const source = await result;
    assert.deepEqual(ids(source), ["call", "result"]);
    assert.equal(source.messages[0].tool_calls[0].id, source.messages[1].tool_call_id);
    assert.equal(projectContextSource({ source, historyLimit: 1 }).messages.length, 2);
  });
  const rejected = await probe(66, limits, (result) =>
    assert.rejects(result, {
      code: "SESSION_CONTEXT_READ_BUDGET_EXCEEDED",
      dimension: "candidates",
      used: 8,
      requested: 1,
    }),
  );
  const longTurn = await probe(66, { ...limits, candidates: 90 }, (result) =>
    assert.rejects(result, {
      code: "SESSION_CONTEXT_READ_BUDGET_EXCEEDED",
      dimension: "candidates",
      used: 65,
      requested: 64,
    }),
  );
  const exact = await probe(1, { ...limits, bytes: selected.bytes }, async (result) => {
    assert.deepEqual(ids(await result), ["call", "result"]);
  });
  assert.deepEqual(exact, selected);
  const byteLimit = selected.bytes - 1;
  const byteRejected = await probe(1, { ...limits, bytes: byteLimit }, (result) =>
    assert.rejects(result, { code: "SESSION_CONTEXT_READ_BUDGET_EXCEEDED", dimension: "bytes" }),
  );
  t.diagnostic(JSON.stringify({ selected, rejected, longTurn, byteRejected, byteLimit }));
  assert.equal(selected.messages, 2);
  assert.ok(rejected.messages <= limits.candidates);
  assert.equal(rejected.messageContent, 0);
  assert.equal(longTurn.messages, 65);
  assert.equal(longTurn.messageContent, 0);
  assert.ok(byteRejected.bytes <= byteLimit);
});

test("dense context preserves order, large metadata and snapshot visibility across candidate pages", async (t) => {
  const { journal, root, sessionId, commit } = await fixture(t, {
    pageBytes: 128 * 1024,
    pageRecords: 4,
  });
  const messages = Array.from({ length: 9 }, (_, index) =>
    historical(sessionId, `dense-${index}`, {
      dialogProcessId: "dialog-dense",
      turnScopeId: "turn-dense",
      modelMessageId: `model-${index}-${"x".repeat(1600)}`,
      content: `body-${index}-${"text".repeat(64)}`,
    }),
  );
  for (const entry of messages) await commit(`create-${entry.messageUid}`, { messages: [entry] });
  await journal.close();
  const cold = await PartitionJournal.open({ root, sessionId });
  t.after(() => cold.close());
  const reads = { ownership: 0, positions: 0, bodies: 0 };
  const readSlots = cold.readRecordSlots.bind(cold);
  t.mock.method(cold, "readRecordSlots", async (query) => {
    const slots = await readSlots(query);
    for (const { mutation: record } of slots.values()) {
      if (record.collection === PARTITION_MESSAGE_COLLECTIONS.turns) reads.ownership += 1;
      if (record.collection === PARTITION_MESSAGE_COLLECTIONS.order) reads.positions += 1;
      if (record.collection === PARTITION_MESSAGE_COLLECTIONS.content) reads.bodies += 1;
    }
    return slots;
  });
  await using reader = await open(cold, sessionId);
  const before = cold.work.readBytes;
  const source = await reader.readContextSource({ historyLimit: 1 });
  t.diagnostic(`Cold context: ${cold.work.readBytes - before} B; ${JSON.stringify(reads)}`);
  assert.deepEqual(reads, { ownership: 1, positions: messages.length, bodies: messages.length });
  assert.deepEqual(
    ids(source),
    messages.map(({ messageUid }) => messageUid),
  );
  assert.deepEqual(
    source.messages.map(({ content }) => content),
    messages.map(({ content }) => content),
  );
  assert.deepEqual(
    source.messages.map(({ modelMessageId }) => modelMessageId),
    messages.map(({ modelMessageId }) => modelMessageId),
  );
  assert.ok(cold.work.readBytes - before <= cold.head.limits.pageBytes);
  const reopened = openTestMessages(cold, sessionId);
  await reopened.commit(
    await prepare(cold, reopened, "delete-dense", {
      messageDeletion: { commandId: "delete-dense", anchor: { turnScopeId: "turn-dense" } },
    }),
  );
  assert.deepEqual(ids(await reader.readContextSource({ historyLimit: 1 })), ids(source));
  await using current = await open(cold, sessionId);
  assert.deepEqual(ids(await current.readContextSource({ historyLimit: 1 })), []);
});

test("context projection traverses multiple collection pages under its own total byte budget", async (t) => {
  const { journal, root, sessionId, commit } = await fixture(t, { pageRecords: 4 });
  const messages = Array.from({ length: 16 }, (_, index) =>
    historical(sessionId, `paged-${index}`, {
      content: `paged-${index}-${"x".repeat(2048)}`,
    }),
  );
  for (const entry of messages) await commit(`create-${entry.messageUid}`, { messages: [entry] });
  await journal.close();
  const cold = await PartitionJournal.open({ root, sessionId });
  t.after(() => cold.close());
  await using reader = await open(cold, sessionId);
  const source = await reader.readContextSource({ historyLimit: messages.length });
  assert.deepEqual(
    ids(source),
    messages.map(({ messageUid }) => messageUid),
  );
  assert.deepEqual(
    source.messages.map(({ content }) => content),
    messages.map(({ content }) => content),
  );
});

test("context batching rejects corrupt candidate membership beyond the first page", async (t) => {
  const { journal, sessionId, commit } = await fixture(t, {
    pageRecords: 2,
    pageBytes: 128 * 1024,
  });
  for (let index = 0; index < 5; index += 1)
    await commit(`seed-${index}`, {
      messages: [
        historical(sessionId, `m-${index}`, {
          dialogProcessId: "dialog-dense",
          turnScopeId: "turn-dense",
        }),
      ],
    });
  const transactions = new PartitionTransactions(journal);
  const key = JSON.stringify([sessionId, 1]);
  const entry = await journal.usingSnapshot(async (snapshot) =>
    (
      await transactions.lookupLatestMany({ snapshot, collection: "messageOrder", keys: [key] })
    ).get(key),
  );
  assert.ok(entry);
  await commitFixtureTransaction(transactions, {
    epoch: journal.head.epoch,
    expectedGeneration: journal.head.sequence,
    sequence: journal.head.sequence + 1,
    operationId: "damage-last-context-page",
    input: {},
    result: null,
    mutations: [{ collection: "messageOrder", key, owner: entry.owner, value: "m-4" }],
  });
  await using reader = await open(journal, sessionId);
  await assert.rejects(reader.readContextSource({ historyLimit: 1 }), {
    code: "SESSION_STORAGE_CORRUPT",
  });
});
