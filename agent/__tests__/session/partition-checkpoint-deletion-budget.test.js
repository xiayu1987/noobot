/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { preparePartitionCheckpointDeletion } from "../../src/session/partition-storage/partition-checkpoint-deletion.js";
import { summaryCheckpointEffectMessageUids } from "@noobot/context-protocol/policy/summary-checkpoint-transaction";

for (const revision of [2, 1000000]) {
  test(`checkpoint cleanup visits only live receipts at head revision ${revision}`, async () => {
    const values = new Map([
      [
        '["checkpointHeads","turn"]',
        { dialogProcessId: "dialog", turnScopeId: "turn", checkpointRevision: revision },
      ],
      ['["turnCheckpoints","turn"]', revision],
    ]);
    for (const [current, previousRevision] of [
      [revision, 1],
      [1, null],
    ]) {
      const checkpointId = `summary-${current}`;
      values.set(JSON.stringify(["checkpointOrder", JSON.stringify(["turn", current])]), {
        checkpointId,
        previousRevision,
      });
      values.set(JSON.stringify(["checkpoints", JSON.stringify(["turn", checkpointId])]), {
        checkpointId,
        checkpointRevision: current,
        requestHash: "hash",
        committedAt: "2026-11-20T00:00:00.000Z",
        markedCount: 1,
        persistedMessageUids: [],
        summarizedMessageUids: ["source"],
        retainedMessageUids: [],
      });
    }
    const reads = [];
    const mutations = [];
    await preparePartitionCheckpointDeletion({
      mutations,
      tails: [{ key: "turn", remove: true }],
      async lookup({ collection, key }) {
        const identity = JSON.stringify([collection, key]);
        reads.push(identity);
        assert.ok(values.has(identity), `Unexpected read: ${identity}`);
        return { owner: { partition: 0, sequence: 1 }, mutation: { value: values.get(identity) } };
      },
    });
    assert.equal(reads.length, 6);
    assert.equal(mutations.length, 6);
    assert.ok(mutations.every(({ remove }) => remove));
  });
}

test("checkpoint deletion effect includes persisted and summarized UIDs, with retention remaining a separate fact", () => {
  assert.deepEqual(
    [
      ...summaryCheckpointEffectMessageUids({
        persistedMessageUids: ["persisted", "both"],
        summarizedMessageUids: ["both", "summarized"],
        retainedMessageUids: ["retained"],
      }),
    ],
    ["persisted", "both", "summarized"],
  );
});
