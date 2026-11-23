/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { QUANTITY_THRESHOLDS } from "@noobot/shared/quantity-thresholds";
import { restoreSessionCommitRequest } from "@noobot/session-protocol/session-changes";
import { PartitionJournal } from "../../src/session/partition-storage/partition-journal.js";
import { openPartitionSessionReader } from "../../src/session/partition-storage/partition-session-reader.js";
import {
  createMessageCase,
  message,
  openTestMessages,
  prepare,
  scope,
} from "./partition-session-messages.test-helpers.js";

test("business export keeps its receipt window while cold paging and replay retain older checkpoints", async (t) => {
  const window = QUANTITY_THRESHOLDS.contextProtocol.turnSummaryCheckpointReceiptLimit;
  const count = window + 2;
  const { journal, sessionId, root } = await createMessageCase(t, {
    transactionBytes: 16 * 1024,
    pageRecords: window,
    pageBytes: 512 * 1024,
  });
  const repository = openTestMessages(journal, sessionId);
  let originalRequest;
  let recentRequest;
  let recentReceipt;
  for (let revision = 1; revision <= count; revision += 1) {
    const uid = `source-${revision}`;
    const request = await prepare(journal, repository, `checkpoint-${revision}`, {
      messages: [message(sessionId, uid)],
      summaryCheckpoints: [
        {
          ...scope,
          sessionId,
          userId: "admin",
          checkpointId: `checkpoint-${revision}`,
          expectedCheckpointRevision: revision - 1,
          messages: [],
          persistedMessageUids: [],
          summarizedMessageUids: [uid],
          retainedMessageUids: [],
        },
      ],
    });
    const receipt = await repository.commit(request);
    if (revision === 1) {
      originalRequest = JSON.stringify(request);
    }
    if (revision === count) {
      recentRequest = JSON.stringify(request);
      recentReceipt = receipt;
    }
  }
  const options = { journal, sessionId, parentSessionId: "" };
  let expected;
  {
    await using reader = await openPartitionSessionReader(options);
    expected = await reader.exportSession();
    const state = expected.turnSummaryCheckpoints[scope.turnScopeId];
    assert.equal(state.checkpointRevision, count);
    assert.deepEqual(
      state.receipts.map(({ checkpointRevision }) => checkpointRevision),
      Array.from({ length: window }, (_, index) => index + 3),
    );
    assert.deepEqual(state, await reader.readCheckpointState(scope.turnScopeId));
  }
  await journal.close();
  const cold = await PartitionJournal.open({ root, sessionId });
  t.after(() => cold.close());
  await using reader = await openPartitionSessionReader({ ...options, journal: cold });
  assert.deepEqual(await reader.exportSession(), expected);
  const revisions = [];
  let cursor = null;
  do {
    const page = await reader.readCheckpointPage({
      turnScopeId: scope.turnScopeId,
      cursor,
      limit: 7,
      maxBytes: 8192,
    });
    revisions.push(...page.receipts.map(({ checkpointRevision }) => checkpointRevision));
    cursor = page.nextCursor;
  } while (cursor !== null);
  assert.deepEqual(
    revisions,
    Array.from({ length: count }, (_, index) => count - index),
  );
  assert.equal(
    (await reader.readCheckpoint(scope.turnScopeId, "checkpoint-1")).checkpointRevision,
    1,
  );
  const before = structuredClone(cold.head);
  const coldRepository = openTestMessages(cold, sessionId);
  await assert.rejects(coldRepository.commit(restoreSessionCommitRequest(originalRequest)), {
    code: "SESSION_REQUEST_EXPIRED",
  });
  assert.deepEqual(cold.head, before);
  const replay = await coldRepository.commit(restoreSessionCommitRequest(recentRequest));
  assert.deepEqual(replay, { ...recentReceipt, replayed: true });
  assert.deepEqual(cold.head, before);
  assert.deepEqual(await reader.exportSession(), expected);
});
