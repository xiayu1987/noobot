/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  PARTITION_MESSAGE_PAGE,
  requirePartitionMessagePage,
} from "@noobot/session-protocol/partition-session-messages";
import { PartitionSessionMessages } from "../../src/session/partition-storage/partition-session-messages.js";
import { readPartitionMessageDiagnosticPage } from "../../src/session/partition-storage/partition-message-diagnostics.js";
import { readPartitionOutboxPage } from "../../src/session/partition-storage/partition-outbox.js";
import { createTransactionCase } from "../helpers/partition-journal-cases.js";
import { initializePartitionSession } from "../helpers/partition-session-cases.js";

const committedAt = "2026-11-20T00:00:00.000Z";

const pageReaders = {
  messages: (read, scope, snapshot, limit) =>
    requirePartitionMessagePage(snapshot, PARTITION_MESSAGE_PAGE.sessionOrder, [], {
      cursor: null,
      limit,
    }),
  diagnostics: (read, scope, snapshot, limit) =>
    readPartitionMessageDiagnosticPage({ read, scope, snapshot, options: { after: 0, limit } }),
  outbox: (read, scope, snapshot, limit) =>
    readPartitionOutboxPage(read, scope, snapshot, { consumerId: "consumer", after: 0, limit }),
};

for (const [name, reader] of Object.entries(pageReaders)) {
  test(`${name} rejects invalid and over-budget pages before reading collections`, async (t) => {
    const { journal, sessionId } = await createTransactionCase(t);
    await journal.usingSnapshot(async (snapshot) => {
      const read = () => assert.fail("Rejected page must not read collections");
      const scope = { sessionId, parentSessionId: "" };
      for (const limit of [0, -1, 1.5, "1"])
        await assert.rejects(async () => reader(read, scope, snapshot, limit), TypeError);
      await assert.rejects(
        async () => reader(read, scope, snapshot, snapshot.limits.pageRecords + 1),
        { code: "SESSION_QUERY_BUDGET" },
      );
    });
  });
}

test("business page admission is independent of empty or short history and leaves snapshots usable", async (t) => {
  const { journal, sessionId } = await createTransactionCase(t, { transactionBytes: 16 * 1024 });
  const scope = { sessionId, parentSessionId: "" };
  await initializePartitionSession(journal, scope, committedAt);
  const repository = new PartitionSessionMessages(journal, scope);
  const readers = [
    (snapshot, limit) => repository.readSessionMessageOrderPage({ snapshot, cursor: null, limit }),
    (snapshot, limit) => repository.readMessageDiagnosticPage({ snapshot, after: 0, limit }),
    (snapshot, limit) =>
      repository.readOutboxPage({ snapshot, consumerId: "consumer", after: 0, limit }),
  ];
  for (const seeded of [false, true]) {
    if (seeded) {
      const request = await journal.usingSnapshot((snapshot) =>
        repository.prepareRequest(snapshot, {
          operationId: "seed",
          committedAt,
          changes: {
            messages: [
              {
                ...scope,
                messageUid: "message",
                dialogProcessId: "dialog",
                turnScopeId: "turn",
                modelMessageId: "model",
                presentationMessageId: "presentation",
                role: "assistant",
                type: "message",
                content: "body",
                attachments: [],
                ts: committedAt,
              },
            ],
          },
        }),
      );
      await repository.commit(request);
    }
    const before = structuredClone(journal.head);
    await journal.usingSnapshot(async (snapshot) => {
      for (const reader of readers) {
        await assert.rejects(reader(snapshot, snapshot.limits.pageRecords + 1), {
          code: "SESSION_QUERY_BUDGET",
        });
        await reader(snapshot, snapshot.limits.pageRecords);
      }
      const order = await readers[0](snapshot, 1);
      assert.deepEqual(order.entries, seeded ? ["message"] : []);
      const outbox = await repository.readOutboxPage({ snapshot, consumerId: "consumer" });
      assert.deepEqual(outbox.events, []);
    });
    assert.deepEqual(journal.head, before);
  }
});
