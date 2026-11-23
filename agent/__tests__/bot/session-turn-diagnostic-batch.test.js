/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import test from "node:test";
import { SessionTurnPersister } from "../../src/bot/execution/turn-persister.js";
import { createTestMessageCreationBatch } from "../helpers/message-persistence-receipts.js";
import { useRuntimeEventsEnv } from "../helpers/runtime-events-env.js";
import {
  EXECUTION_LOG_BATCH_MAX_RECORDS,
  partitionExecutionLogRecords,
  executionLogByteBudget,
  encodeExecutionSegmentRecord,
} from "@noobot/session-protocol";

const input = {
  userId: "u1",
  sessionId: "s1",
  dialogProcessId: "dp1",
  turnScopeId: "turn1",
};
const messages = (count) =>
  Array.from({ length: count }, (_, index) => ({
    messageUid: `message-${index}`,
    role: "assistant",
    content: `content-${index}`,
  }));

test(
  "one checkpoint commits messages and ordered diagnostics atomically before publishing saved events",
  { timeout: 5000 },
  async (t) => {
    useRuntimeEventsEnv(t, { executionLog: { sessionTurnFullDebug: true } });
    const batches = [];
    let release;
    const barrier = new Promise((resolve) => {
      release = resolve;
    });
    let entered;
    const started = new Promise((resolve) => {
      entered = resolve;
    });
    t.after(() => release());
    const events = [];
    const receipts = [];
    const persister = new SessionTurnPersister({
      now: () => "2026-01-01T00:00:00.000Z",
      session: {
        appendExecutionLogs: () => assert.fail("diagnostics must use the message transaction"),
        async appendTurns(payload) {
          batches.push(payload);
          entered();
          await barrier;
          return { messageReceipts: receipts };
        },
      },
    });
    const pending = persister.appendAgentMessages(
      createTestMessageCreationBatch({
        ...input,
        messages: messages(201),
        eventListener: { onEvent: ({ event }) => events.push(event) },
      }),
    );
    await started;
    assert.deepEqual(events, []);
    assert.equal(batches.length, 1);
    assert.deepEqual(
      batches[0].turns.map(({ messageUid }) => messageUid),
      messages(201).map(({ messageUid }) => messageUid),
    );
    assert.deepEqual(
      batches[0].messageDiagnostics.map(({ messageUid }) => messageUid),
      batches[0].turns.map(({ messageUid }) => messageUid),
    );
    release();
    assert.equal(await pending, receipts);
    assert.equal(batches.length, 1);
    assert.deepEqual(
      events,
      messages(201).map(() => "assistant_message_saved"),
    );
    assert.deepEqual(
      batches[0].messageDiagnostics.map(({ record }) => record.data.content.preview),
      messages(201).map((message) => message.content),
    );
    assert.ok(
      batches.every(
        (payload) => payload.userId === input.userId && payload.sessionId === input.sessionId,
      ),
    );
  },
);

test("a failed message and diagnostic transaction propagates without retrying or publishing saved events", async (t) => {
  useRuntimeEventsEnv(t, { executionLog: { sessionTurnFullDebug: true } });
  const failure = Object.assign(new Error("projection failed"), { commitState: "committed" });
  let calls = 0;
  const events = [];
  const persister = new SessionTurnPersister({
    now: () => "2026-01-01T00:00:00.000Z",
    session: {
      appendExecutionLogs: () => assert.fail("diagnostics must use the message transaction"),
      async appendTurns({ turns, messageDiagnostics }) {
        calls += 1;
        assert.equal(turns.length, 201);
        assert.equal(messageDiagnostics.length, turns.length);
        throw failure;
      },
    },
  });
  await assert.rejects(
    persister.appendAgentMessages(
      createTestMessageCreationBatch({
        ...input,
        messages: messages(201),
        eventListener: { onEvent: ({ event }) => events.push(event) },
      }),
    ),
    (error) => error === failure,
  );
  assert.equal(calls, 1);
  assert.deepEqual(events, []);
});

test("disabled diagnostics do not serialize diagnostic fields, allocate timestamps or call the log port", async (t) => {
  useRuntimeEventsEnv(t, { executionLog: { sessionTurnFullDebug: false } });
  let saved = false;
  const metadata = {
    toJSON() {
      assert.fail("disabled diagnostics must not serialize metadata");
    },
  };
  const persister = new SessionTurnPersister({
    now: () => assert.fail("disabled diagnostics must not allocate a timestamp"),
    session: {
      appendExecutionLogs: () => assert.fail("disabled diagnostics must not call the log port"),
      appendTurns: async ({ turns, messageDiagnostics }) => {
        assert.equal(turns[0].modelResponseMetadata, metadata);
        assert.deepEqual(messageDiagnostics, []);
        saved = true;
        return { messageReceipts: [] };
      },
    },
  });
  await persister.appendAgentMessages(
    createTestMessageCreationBatch({
      ...input,
      messages: [
        {
          ...messages(1)[0],
          modelResponseMetadata: metadata,
        },
      ],
    }),
  );
  assert.equal(saved, true);
});

test("log partitioning respects both protocol budgets, including UTF-8 byte length", () => {
  const { batchBytes } = executionLogByteBudget();
  const records = Array.from({ length: 5 }, (_, index) => ({
    dialogProcessId: "dp1",
    event: `event-${index}`,
    data: "中".repeat(Math.floor(batchBytes / 7)),
  }));
  const batches = [...partitionExecutionLogRecords(records)];
  assert.deepEqual(batches.flat(), records);
  assert.ok(batches.length > 1);
  for (const batch of batches) {
    assert.ok(batch.length <= EXECUTION_LOG_BATCH_MAX_RECORDS);
    assert.ok(
      batch.reduce((sum, record) => sum + encodeExecutionSegmentRecord(record).bytes, 0) <=
        batchBytes,
    );
  }
  assert.deepEqual([...partitionExecutionLogRecords([])], []);
  assert.throws(() => [...partitionExecutionLogRecords([{ data: "x".repeat(batchBytes) }])], {
    code: "EXECUTION_LOG_RECORD_TOO_LARGE",
  });
});
