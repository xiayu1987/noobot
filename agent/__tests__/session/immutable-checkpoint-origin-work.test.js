/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import test from "node:test";
import { parseTurnSummaryCheckpointRequest } from "@noobot/context-protocol/policy/summary-checkpoint-request";
import { immutableTransactionInputDigest } from "@noobot/session-protocol/immutable-storage-graph";
import { immutableCheckpointKey } from "../../src/session/session-artifact-session/immutable-checkpoint-index.js";
import { migrateCheckpointReceipts } from "../../src/session/session-artifact-session/immutable-checkpoint-receipt-migration.js";

function fixture() {
  const requests = ["first", "second", "third"].map((checkpointId) =>
    parseTurnSummaryCheckpointRequest({
      userId: "admin",
      sessionId: "origin-work",
      dialogProcessId: "dialog",
      turnScopeId: "turn",
      checkpointId,
      expectedCheckpointRevision: 0,
      persistedMessageUids: [],
      summarizedMessageUids: [],
      retainedMessageUids: [],
      messages: [],
    }),
  );
  const results = requests.map((request) => ({
    receipt: {
      checkpointId: request.checkpointId,
      checkpointRevision: 1,
      requestHash: request.requestHash,
    },
  }));
  const evidence = { expectedGeneration: 3, input: { changes: { summaryCheckpoints: requests } } };
  const receipt = {
    generation: 4,
    commit: "commit-4",
    digest: immutableTransactionInputDigest(evidence.expectedGeneration, evidence.input),
    result: { summaryCheckpoints: results },
  };
  const checkpointMutation = (index) => ({
    collection: "checkpoints",
    key: immutableCheckpointKey("turn", requests[index].checkpointId),
    reference: `checkpoint-${index}`,
  });
  const records = new Map([
    ["commit-4", { generation: 4, operationId: "operation", previous: "commit-3", mutations: [] }],
    ["commit-3", { generation: 3, previous: "commit-2", mutations: [checkpointMutation(1)] }],
    [
      "commit-2",
      {
        generation: 2,
        previous: "commit-1",
        mutations: [checkpointMutation(0), checkpointMutation(2)],
      },
    ],
  ]);
  const reads = [];
  const source = {
    sessionId: "origin-work",
    readCommitRecord: async (reference, generation) => {
      reads.push(reference);
      const record = records.get(reference);
      assert.equal(record?.generation, generation);
      return record;
    },
    objects: { readValue: async (reference) => results[Number(reference.split("-")[1])].receipt },
  };
  return {
    requests,
    results,
    records,
    reads,
    receipt,
    run: (options = {}) =>
      migrateCheckpointReceipts({
        source,
        receipt,
        operationId: "operation",
        readOperationInput: async () => evidence,
        ...options,
      }),
  };
}

test("checkpoint origins share one history traversal and retain request order", async () => {
  const { run, reads, receipt } = fixture();
  const before = structuredClone(receipt);
  const migrated = await run();
  assert.deepEqual(reads, ["commit-4", "commit-3", "commit-2"]);
  assert.deepEqual(
    migrated.result.summaryCheckpoints.map((result) => result.receipt.checkpointId),
    ["first", "second", "third"],
  );
  assert.ok(
    migrated.result.summaryCheckpoints.every(
      (result) => result.turnScopeId === "turn" && result.messages.length === 0,
    ),
  );
  assert.deepEqual(receipt, before);
});

test("a missing origin rejects the entire batch after a single history pass", async () => {
  const { run, reads, records, receipt } = fixture();
  records.get("commit-2").mutations.pop();
  records.get("commit-2").previous = null;
  const before = structuredClone(receipt);
  await assert.rejects(run(), { code: "SESSION_IMMUTABLE_STORAGE_INVALID" });
  assert.deepEqual(reads, ["commit-4", "commit-3", "commit-2"]);
  assert.deepEqual(receipt, before);
});

test("a newer conflicting origin never falls through to an older matching receipt", async () => {
  const { run, reads, records } = fixture();
  records
    .get("commit-4")
    .mutations.push({ ...records.get("commit-2").mutations[0], reference: "checkpoint-1" });
  await assert.rejects(run(), { code: "SESSION_IMMUTABLE_STORAGE_INVALID" });
  assert.deepEqual(reads, ["commit-4"]);
});

test("cancelled origin migration does not read history", async () => {
  const { run, reads } = fixture();
  const failure = new Error("cancel migration");
  await assert.rejects(run({ signal: AbortSignal.abort(failure) }), (error) => error === failure);
  assert.deepEqual(reads, []);
});
