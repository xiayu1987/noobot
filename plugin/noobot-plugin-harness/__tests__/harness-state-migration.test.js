/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";

import { ensureHarnessBucket } from "../src/capabilities/handlers/shared.js";

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
                summaryText: "revision-summary",
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
  assert.equal(state.pending.planUpdate, true);
  assert.equal(state.pending.planUpdateStage, "revision");
  assert.deepEqual(state.pending.planUpdateContext, {
    summaryText: "revision-summary",
    targetMainStepIndexes: [1],
  });
  assert.equal(state.flags.planUpdateCapturePending, false);
  assert.equal("planRevisionCapturePending" in state.flags, false);
  assert.equal(holder.bucket.__harnessBucketVersion, 4);
  assert.equal(state.__harnessBucketVersion, 4);
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
  assert.equal(holder.state.__harnessBucketVersion, 4);
  holder.state.__harnessBucketVersion = 5;
  assert.equal(holder.bucket.__harnessBucketVersion, 5);
  assert.equal(holder.state.__harnessBucketVersion, 5);
});
