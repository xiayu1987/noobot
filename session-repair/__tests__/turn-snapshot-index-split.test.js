/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import test from "node:test";
import { SESSION_ARTIFACT_MANIFEST_SNAPSHOT_INDEX_SCHEMA_VERSION } from "@noobot/session-protocol";
import { SESSION_REPAIR_ERROR_CODE, splitTurnSnapshotIndexes } from "../src/index.js";

const indexRecord = { op: "summary_snapshot", checkpointId: "c1", file: "turn-snapshots/c1.json" };
const upsertRecord = { op: "upsert", messageUid: "sm_1" };

test("manifest snapshot index schema requires summarySnapshots on every turn", () => {
  assert.throws(
    () =>
      splitTurnSnapshotIndexes(
        SESSION_ARTIFACT_MANIFEST_SNAPSHOT_INDEX_SCHEMA_VERSION,
        { turnId: "t1" },
        [upsertRecord],
      ),
    { code: SESSION_REPAIR_ERROR_CODE.CHECKPOINT_CHAIN_INVALID },
  );
});

test("manifest snapshot index schema reads indexes only from the manifest entry", () => {
  const indexes = [{ checkpointId: "c1", file: "turn-snapshots/c1.json" }];
  const result = splitTurnSnapshotIndexes(
    SESSION_ARTIFACT_MANIFEST_SNAPSHOT_INDEX_SCHEMA_VERSION,
    { turnId: "t1", summarySnapshots: indexes },
    [upsertRecord],
  );
  assert.equal(result.indexes, indexes);
  assert.deepEqual(result.journal, [upsertRecord]);
});

test("pre-manifest-index schema splits snapshot indexes out of the journal", () => {
  const result = splitTurnSnapshotIndexes(
    SESSION_ARTIFACT_MANIFEST_SNAPSHOT_INDEX_SCHEMA_VERSION - 1,
    { turnId: "t1" },
    [indexRecord, upsertRecord],
  );
  assert.deepEqual(result.indexes, [indexRecord]);
  assert.deepEqual(result.journal, [upsertRecord]);
});
