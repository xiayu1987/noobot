/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";

import { ensureHarnessBucket } from "../src/capabilities/handlers/shared.js";
import { HARNESS_BUCKET_VERSION } from "../src/capabilities/handlers/shared/constants.js";

test("ensureHarnessBucket normalizes plan-update counters and pending fields", () => {
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
          taskChecklist: [],
          acceptanceReports: [],
          reviewReports: [],
          planningRawOutputs: [],
          logs: { planning: [], guidance: [], acceptance: [], review: [] },
          __harnessBucketVersion: 2,
        },
      },
    },
  };

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

test("ensureHarnessBucket keeps state version as alias of bucket version", () => {
  const ctx = {
    agentContext: {
      payload: {
        harness: {
          __harnessBucketVersion: 3,
          state: {},
          taskChecklist: [],
          acceptanceReports: [],
          reviewReports: [],
          planningRawOutputs: [],
          logs: { planning: [], guidance: [], acceptance: [], review: [] },
        },
      },
    },
  };
  const holder = ensureHarnessBucket(ctx);
  assert.ok(holder);
  assert.equal(holder.state.__harnessBucketVersion, HARNESS_BUCKET_VERSION);
  holder.state.__harnessBucketVersion = 5;
  assert.equal(holder.bucket.__harnessBucketVersion, 5);
  assert.equal(holder.state.__harnessBucketVersion, 5);
});
