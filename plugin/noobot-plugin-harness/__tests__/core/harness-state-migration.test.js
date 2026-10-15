/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";

import { ensureHarnessBucket } from "../../src/capabilities/handlers/shared/index.js";
import { HARNESS_BUCKET_VERSION } from "../../src/capabilities/handlers/shared/constants.js";
import { migrateHarnessBucket } from "../../src/core/bucket-migration.js";
import { ensureTestAgentExecutionScope } from "../helpers/public-runtime-fixtures.js";

test("explicit hook-boundary migration normalizes plan-update counters and pending fields", () => {
  const ctx = {
    agentContext: {
      payload: {
        harness: {
          state: {
            counters: { llmTurns: 2, planRevisionAttempts: 3 },
            flags: { planRevisionCapturePending: true },
            signals: {},
            pending: {
              planRevision: true,
              planRevisionContext: {
                targetMainStepIndexes: [1],
              },
            },
            __harnessBucketVersion: 2,
          },
          acceptanceReports: [],
          reviewReports: [],
          planningRawOutputs: [],
          logs: { planning: [], guidance: [], acceptance: [], review: [] },
          __harnessBucketVersion: 2,
        },
      },
    },
  };
  ensureTestAgentExecutionScope(ctx);

  assert.throws(() => ensureHarnessBucket(ctx), /harness_bucket_migration_required:2/);
  const migration = migrateHarnessBucket(ctx);
  assert.deepEqual(migration, {
    migrated: true,
    fromVersion: 2,
    toVersion: HARNESS_BUCKET_VERSION,
  });
  const holder = ensureHarnessBucket(ctx);
  assert.ok(holder);
  const { state } = holder;
  assert.equal(state.counters.planUpdateAttempts, 3);
  assert.equal(state.counters.planRevisionAttempts, 3);
  assert.equal(state.counters.planRefinementAttempts, 0);
  assert.equal(state.counters.lastPlanningCounterTurn, 0);
  assert.equal(state.pending.planRevision, true);
  assert.deepEqual(state.pending.planRevisionContext, {
    targetMainStepIndexes: [1],
  });
  assert.equal(state.pending.planRefinement, false);
  assert.equal(state.pending.planRefinementContext, null);
  assert.equal("planUpdate" in state.pending, false);
  assert.equal("planUpdateStage" in state.pending, false);
  assert.equal("planUpdateContext" in state.pending, false);
  assert.equal(state.flags.planUpdateCapturePending, false);
  assert.equal("planRevisionCapturePending" in state.flags, false);
  assert.equal(holder.bucket.__harnessBucketVersion, HARNESS_BUCKET_VERSION);
  assert.equal(state.__harnessBucketVersion, HARNESS_BUCKET_VERSION);
});

test("v4 to v5 migration removes bucket.taskChecklist fields without rewriting plan-update state", () => {
  const pending = {
    planRevision: true,
    planRevisionContext: { targetMainStepIndexes: [2], reason: "keep" },
    planRefinement: false,
    planRefinementContext: null,
  };
  const ctx = {
    agentContext: {
      payload: {
        harness: {
          __harnessBucketVersion: 4,
          state: { flags: { planUpdateCapturePending: false }, counters: {}, signals: {}, pending },
          planText: "1. 主计划",
          taskChecklist: [{ index: 1, task: "旧清单" }],
          taskChecklistSource: "plan_text",
          acceptanceReports: [],
          reviewReports: [],
          planningRawOutputs: [],
          logs: { planning: [], guidance: [], acceptance: [], review: [] },
        },
      },
    },
  };
  ensureTestAgentExecutionScope(ctx);

  assert.throws(() => ensureHarnessBucket(ctx), /harness_bucket_migration_required:4/);
  assert.deepEqual(migrateHarnessBucket(ctx), {
    migrated: true,
    fromVersion: 4,
    toVersion: HARNESS_BUCKET_VERSION,
  });
  const { bucket, state } = ensureHarnessBucket(ctx);
  assert.equal("taskChecklist" in bucket, false);
  assert.equal("taskChecklistSource" in bucket, false);
  assert.equal(bucket.planText, "1. 主计划");
  assert.deepEqual(state.pending.planRevisionContext, {
    targetMainStepIndexes: [2],
    reason: "keep",
  });
  assert.equal(bucket.__harnessBucketVersion, HARNESS_BUCKET_VERSION);
});

test("v5 to v6 migration removes duplicated fields from persisted acceptance reports", () => {
  const legacyReport = () => ({
    planText: "1. 主计划",
    taskChecklist: [{ index: 1 }],
    finalPlanChecklist: [{ index: 1 }],
    plan: { totalGoal: "goal", planText: "1. 主计划" },
  });
  const lastAcceptanceReport = legacyReport();
  const listedReport = legacyReport();
  const reviewEmbedded = legacyReport();
  const lastReviewEmbedded = legacyReport();
  const ctx = {
    agentContext: {
      payload: {
        harness: {
          __harnessBucketVersion: 5,
          state: { flags: {}, counters: {}, signals: {}, pending: {} },
          planText: "1. 主计划",
          lastAcceptanceReport,
          acceptanceReports: [listedReport],
          lastReviewReport: { acceptanceReport: lastReviewEmbedded },
          reviewReports: [{ acceptanceReport: reviewEmbedded }, { point: "no_acceptance" }],
          planningRawOutputs: [],
          logs: { planning: [], guidance: [], acceptance: [], review: [] },
        },
      },
    },
  };
  ensureTestAgentExecutionScope(ctx);

  assert.throws(() => ensureHarnessBucket(ctx), /harness_bucket_migration_required:5/);
  assert.deepEqual(migrateHarnessBucket(ctx), { migrated: true, fromVersion: 5, toVersion: 6 });
  for (const report of [lastAcceptanceReport, listedReport, reviewEmbedded, lastReviewEmbedded]) {
    assert.equal("taskChecklist" in report, false);
    assert.equal("planText" in report.plan, false);
    assert.equal(report.planText, "1. 主计划");
    assert.deepEqual(report.finalPlanChecklist, [{ index: 1 }]);
    assert.equal(report.plan.totalGoal, "goal");
  }
});

test("ensureHarnessBucket keeps state version as alias of bucket version", () => {
  const ctx = {
    agentContext: {
      payload: {
        harness: {
          __harnessBucketVersion: 3,
          state: {},
          acceptanceReports: [],
          reviewReports: [],
          planningRawOutputs: [],
          logs: { planning: [], guidance: [], acceptance: [], review: [] },
        },
      },
    },
  };
  ensureTestAgentExecutionScope(ctx);
  migrateHarnessBucket(ctx);
  const holder = ensureHarnessBucket(ctx);
  assert.ok(holder);
  assert.equal(holder.state.__harnessBucketVersion, HARNESS_BUCKET_VERSION);
  holder.state.__harnessBucketVersion = HARNESS_BUCKET_VERSION;
  assert.equal(holder.bucket.__harnessBucketVersion, HARNESS_BUCKET_VERSION);
  assert.equal(holder.state.__harnessBucketVersion, HARNESS_BUCKET_VERSION);
});
