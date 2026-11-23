/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  partitionCheckpointOrderKey,
  requirePartitionCheckpointOrder,
  requirePartitionCheckpointTail,
} from "../src/partition-summary-checkpoints.js";

test("live checkpoint revisions decrease strictly and cannot exceed the owning head", () => {
  assert.equal(partitionCheckpointOrderKey("turn", 7), '["turn",7]');
  assert.equal(requirePartitionCheckpointTail(7, 9), 7);
  const node = { checkpointId: "checkpoint", previousRevision: 2 };
  assert.equal(requirePartitionCheckpointOrder(node, 7), node);
  assert.deepEqual(requirePartitionCheckpointOrder({ ...node, previousRevision: null }, 7), {
    checkpointId: "checkpoint",
    previousRevision: null,
  });
  for (const previousRevision of [0, -1, 7, 8, 1.5, "2", Number.MAX_SAFE_INTEGER + 1])
    assert.throws(() => requirePartitionCheckpointOrder({ ...node, previousRevision }, 7), {
      code: "SESSION_STORAGE_CORRUPT",
    });
  for (const tail of [0, -1, 10, "7", Number.MAX_SAFE_INTEGER + 1])
    assert.throws(() => requirePartitionCheckpointTail(tail, 9), {
      code: "SESSION_STORAGE_CORRUPT",
    });
});

test("checkpoint order has one shape and rejects malformed identity and additional fields", () => {
  for (const node of [
    "checkpoint",
    null,
    {},
    { checkpointId: " checkpoint", previousRevision: null },
    { checkpointId: "checkpoint", previousRevision: null, nextRevision: null },
  ])
    assert.throws(() => requirePartitionCheckpointOrder(node, 7), {
      code: "SESSION_STORAGE_CORRUPT",
    });
  assert.throws(() => partitionCheckpointOrderKey("turn", 0), TypeError);
  assert.throws(() => partitionCheckpointOrderKey(" turn", 1), TypeError);
});
