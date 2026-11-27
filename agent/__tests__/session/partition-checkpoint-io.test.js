/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { QUANTITY_THRESHOLDS } from "@noobot/shared/quantity-thresholds";
import { PartitionJournal } from "../../src/session/partition-storage/partition-journal.js";
import { observeSessionStorageWork } from "../../src/session/session-storage-observation.js";
import { evaluatePerformanceCollection } from "../../../scripts/e2e-docker/performance-gate.mjs";
import { performanceReportFixture } from "../../../scripts/e2e-docker/__tests__/performance-fixture.mjs";
import { observeStorageIo } from "../helpers/storage-io-observation.js";
import {
  createMessageCase,
  message,
  openTestMessages,
  prepare,
  scope,
} from "./partition-session-messages.test-helpers.js";

async function seed(t, count, pageBytes) {
  const fixture = await createMessageCase(t, { transactionBytes: 16 * 1024, pageBytes });
  const { journal, sessionId } = fixture;
  const repository = openTestMessages(journal, sessionId);
  for (let index = 0; index < count; index += 1) {
    const uid = `source-${index}`;
    await repository.commit(
      await prepare(journal, repository, `checkpoint-${index}`, {
        messages: [message(sessionId, uid)],
        summaryCheckpoints: [
          {
            ...scope,
            sessionId,
            userId: "admin",
            checkpointId: `checkpoint-${index}`,
            expectedCheckpointRevision: index,
            messages: [],
            persistedMessageUids: [],
            summarizedMessageUids: [uid],
            retainedMessageUids: [],
          },
        ],
      }),
    );
  }
  await journal.close();
  return fixture;
}

test("@performance a cold partition checkpoint emits work accepted by the performance gate", async (t) => {
  const { root, sessionId } = await seed(t, 64, 256 * 1024);
  const journal = await PartitionJournal.open({ root, sessionId });
  t.after(() => journal.close());
  const repository = openTestMessages(journal, sessionId);
  const request = await prepare(journal, repository, "cold-write", {
    messages: [message(sessionId, "cold-write")],
  });
  const { result, work } = await observeSessionStorageWork(() => repository.commit(request));
  assert.equal(result.status, "committed");
  const report = performanceReportFixture();
  const continuations = report.stopContinues.map(({ continued }) => continued);
  report.samples[0].checkpointSamples[0].storageWork = work;
  const gate = evaluatePerformanceCollection(report.samples, continuations, report.stopContinues);
  assert.deepEqual(gate.failures, []);
  assert.equal(gate.passed, true);
});

test("@performance cold checkpoint window and historical point reads stay within actual file I/O budgets", async (t) => {
  const limit = QUANTITY_THRESHOLDS.contextProtocol.turnSummaryCheckpointReceiptLimit;
  const costs = [];
  for (const count of [limit + 10, limit * 3 + 10]) {
    const { root, sessionId } = await seed(t, count, 256 * 1024);
    const journal = await PartitionJournal.open({ root, sessionId });
    t.after(() => journal.close());
    const reader = openTestMessages(journal, sessionId);
    await journal.usingSnapshot(async (snapshot) => {
      const { result, work } = await observeStorageIo(root, () =>
        reader.readCheckpointState({ snapshot, turnScopeId: scope.turnScopeId }),
      );
      assert.equal(result.checkpointRevision, count);
      assert.equal(result.receipts.length, limit);
      assert.equal(result.receipts[0].checkpointRevision, count - limit + 1);
      assert.equal(result.receipts.at(-1).checkpointRevision, count);
      assert.ok(work.readBytes > 0);
      assert.ok(work.readBytes <= snapshot.limits.pageBytes);
      assert.equal(work.writeBytes, 0);
      costs.push(work.readBytes);
      t.diagnostic(JSON.stringify({ count, windowReadBytes: work.readBytes }));
    });
    await journal.close();
    const cold = await PartitionJournal.open({ root, sessionId });
    t.after(() => cold.close());
    await cold.usingSnapshot(async (snapshot) => {
      const { result, work } = await observeStorageIo(root, () =>
        openTestMessages(cold, sessionId).readCheckpoint({
          snapshot,
          turnScopeId: scope.turnScopeId,
          checkpointId: "checkpoint-0",
        }),
      );
      assert.equal(result.checkpointRevision, 1);
      assert.ok(work.readBytes > 0);
      assert.ok(work.readBytes <= snapshot.limits.pageBytes);
      assert.equal(work.writeBytes, 0);
      t.diagnostic(JSON.stringify({ count, historicalPointReadBytes: work.readBytes }));
    });
  }
  assert.ok(costs[1] <= costs[0] * 1.25 + 16 * 1024);
});

test("checkpoint window budget exhaustion rejects without a partial state or snapshot invalidation", async (t) => {
  const limit = QUANTITY_THRESHOLDS.contextProtocol.turnSummaryCheckpointReceiptLimit;
  const { root, sessionId } = await seed(t, limit + 10, 16 * 1024);
  const journal = await PartitionJournal.open({ root, sessionId });
  t.after(() => journal.close());
  const reader = openTestMessages(journal, sessionId);
  await journal.usingSnapshot(async (snapshot) => {
    const { work } = await observeStorageIo(root, () =>
      assert.rejects(reader.readCheckpointState({ snapshot, turnScopeId: scope.turnScopeId }), {
        code: "SESSION_QUERY_BUDGET",
      }),
    );
    assert.ok(work.readBytes <= snapshot.limits.pageBytes);
    assert.equal(work.writeBytes, 0);
    const receipt = await reader.readCheckpoint({
      snapshot,
      turnScopeId: scope.turnScopeId,
      checkpointId: "checkpoint-0",
    });
    assert.equal(receipt.checkpointRevision, 1);
  });
});

test("exhausted checkpoint predecessors reject before publication and leave the writer usable", async (t) => {
  const { journal, sessionId } = await createMessageCase(t, { transactionBytes: 16 * 1024 });
  const repository = openTestMessages(journal, sessionId);
  const before = structuredClone(journal.head);
  const publications = journal.work.publications;
  await assert.rejects(
    async () => {
      const request = await prepare(journal, repository, "exhausted-checkpoint", {
        messages: [message(sessionId, "source")],
        summaryCheckpoints: [
          {
            ...scope,
            sessionId,
            userId: "admin",
            checkpointId: "exhausted",
            expectedCheckpointRevision: Number.MAX_SAFE_INTEGER,
            messages: [],
            persistedMessageUids: [],
            summarizedMessageUids: ["source"],
            retainedMessageUids: [],
          },
        ],
      });
      await repository.commit(request);
    },
    { code: "TURN_SUMMARY_CHECKPOINT_REQUEST_INVALID" },
  );
  assert.deepEqual(journal.head, before);
  assert.equal(journal.work.publications, publications);
  await journal.usingSnapshot(async (snapshot) => {
    assert.equal(
      await repository.readCheckpointState({ snapshot, turnScopeId: scope.turnScopeId }),
      null,
    );
    assert.deepEqual(
      (await repository.readSessionMessageOrderPage({ snapshot, cursor: null, limit: 1 })).entries,
      [],
    );
  });
  await repository.commit(
    await prepare(journal, repository, "valid-after-rejection", {
      messages: [message(sessionId, "source")],
    }),
  );
  await journal.usingSnapshot(async (snapshot) => {
    assert.deepEqual(
      (await repository.readSessionMessageOrderPage({ snapshot, cursor: null, limit: 1 })).entries,
      ["source"],
    );
  });
});
