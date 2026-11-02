/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import { migrateHarnessBucket } from "../../src/core/bucket-migration.js";
import { ensureHarnessBucket } from "../../src/capabilities/handlers/shared/bucket-utils.js";
import { HARNESS_BUCKET_VERSION } from "../../src/capabilities/handlers/shared/constants.js";
import { createHarnessBucket } from "../../src/core/bucket-contract.js";

test("v13 migration removes unused summaryRounds and preserves live counters", () => {
  const bucket = createHarnessBucket();
  bucket.__harnessBucketVersion = 13;
  bucket.state.counters.summaryRounds = 12;
  bucket.state.counters.summaryTurns = 3;
  const ctx = { agentContext: { bindings: { extensions: { harness: bucket } } } };
  const expected = structuredClone(bucket);
  expected.__harnessBucketVersion = HARNESS_BUCKET_VERSION;
  delete expected.state.counters.summaryRounds;
  assert.deepEqual(migrateHarnessBucket(ctx), {
    migrated: true,
    fromVersion: 13,
    toVersion: HARNESS_BUCKET_VERSION,
  });
  assert.deepEqual(bucket, expected);
  assert.equal(migrateHarnessBucket(ctx).migrated, false);
  assert.deepEqual(bucket, expected);
  assert.equal(Object.hasOwn(createHarnessBucket().state.counters, "summaryRounds"), false);
});

test("v10 migration removes redundant counters and version without rewriting stage facts", () => {
  const counters = { planRevisionAttempts: 3, planRefinementAttempts: 2, planUpdateAttempts: 99 };
  const bucket = { __harnessBucketVersion: 10, state: { __harnessBucketVersion: 10, counters } };
  const ctx = { agentContext: { bindings: { extensions: { harness: bucket } } } };
  assert.throws(() => ensureHarnessBucket(ctx), /harness_bucket_migration_required:10/);
  assert.deepEqual(migrateHarnessBucket(ctx), {
    migrated: true,
    fromVersion: 10,
    toVersion: HARNESS_BUCKET_VERSION,
  });
  assert.equal(bucket.state.counters.planRevisionAttempts, 3);
  assert.equal(bucket.state.counters.planRefinementAttempts, 2);
  assert.equal(Object.hasOwn(bucket.state.counters, "planUpdateAttempts"), false);
  const { state } = ensureHarnessBucket(ctx);
  assert.equal(Object.hasOwn(state, "__harnessBucketVersion"), false);
  assert.equal(Object.hasOwn(state.counters, "planUpdateAttempts"), false);
  const saved = JSON.stringify(bucket);
  assert.equal(migrateHarnessBucket(ctx).migrated, false);
  assert.equal(JSON.stringify(bucket), saved);
});
