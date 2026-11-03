/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import { createHarnessBucket } from "../../src/core/bucket-contract.js";
import { HARNESS_BUCKET_VERSION } from "../../src/capabilities/handlers/shared/constants.js";
import { migrateHarnessBucket } from "../../src/core/bucket-migration.js";
import { ensureHarnessBucket } from "../../src/capabilities/handlers/shared/bucket-utils.js";
import {
  cleanupExpiredPendingOnHook,
  setPendingStateWithMeta,
  setCaptureFlagStateWithMeta,
} from "../../src/capabilities/pending-cleanup.js";
import { createTestHookContext } from "../helpers/public-runtime-fixtures.js";
import {
  resolvePendingPlanUpdateForWorkflow,
  resolveWorkflowActionDecision,
} from "../../src/capabilities/handlers/shared/workflow/scheduler.js";
import { hasAcceptancePhaseBlockers } from "../../src/capabilities/handlers/shared/workflow/policy.js";
import {
  clearPendingPlanRefinement,
  syncPlanRefinementPolicyFlag,
} from "../../src/capabilities/handlers/shared/workflow/plan-refinement-policy.js";

function context(bucket) {
  return { agentContext: { bindings: { extensions: { harness: bucket } } } };
}

test("workflow decisions reject corrupt state without repairing or scheduling it", () => {
  for (const decide of [
    resolveWorkflowActionDecision,
    resolvePendingPlanUpdateForWorkflow,
    hasAcceptancePhaseBlockers,
  ]) {
    for (const corrupt of [
      (state) => {
        delete state.pending;
      },
      (state) => {
        state.pending = [];
      },
      (state) => {
        state.pending.analysis = "true";
      },
      (state) => {
        delete state.flags;
      },
      (state) => {
        state.counters.hookTurns = -1;
      },
    ]) {
      const { state } = createHarnessBucket();
      corrupt(state);
      const before = structuredClone(state);
      assert.throws(() => decide(state), /invalid_harness_state/);
      assert.deepEqual(state, before);
    }
    assert.throws(() => decide(undefined), /invalid_harness_state/);
    assert.throws(() => decide(null), /invalid_harness_state/);
  }
});

test("current harness state refuses corrupt counters and missing sections without repair", () => {
  for (const corrupt of [
    (bucket) => {
      bucket.state.counters.hookTurns = "3";
    },
    (bucket) => {
      bucket.state.counters.analysisTurns = -1;
    },
    (bucket) => {
      delete bucket.state.counters.summaryTurns;
    },
    (bucket) => {
      delete bucket.state.pendingMeta;
    },
    (bucket) => {
      bucket.state = null;
    },
    (bucket) => {
      bucket.state.pending.guidance = {};
    },
    (bucket) => {
      bucket.globalRevisionCount = "2";
    },
    (bucket) => {
      delete bucket.planRevisions;
    },
    (bucket) => {
      bucket.planRefinementRecords = null;
    },
  ]) {
    const bucket = createHarnessBucket();
    corrupt(bucket);
    const saved = structuredClone(bucket);
    assert.throws(() => ensureHarnessBucket(context(bucket)), /invalid_harness/);
    assert.throws(() => migrateHarnessBucket(context(bucket)), /invalid_harness/);
    assert.deepEqual(bucket, saved);
  }
});

test("legacy migration stages changes and preserves invalid input on failure", () => {
  const bucket = { __harnessBucketVersion: 11, state: { counters: { hookTurns: "3" } } };
  const saved = structuredClone(bucket);
  assert.throws(() => migrateHarnessBucket(context(bucket)), /invalid_harness/);
  assert.deepEqual(bucket, saved);
});

test("legacy pending with unknown age is explicit and cleaned with a recorded outcome", () => {
  const bucket = { __harnessBucketVersion: 11, state: { pending: { analysis: true } } };
  const ctx = createTestHookContext(context(bucket));
  assert.equal(bucket.state.pendingMeta.pending.analysis, null);
  const saved = JSON.stringify(bucket);
  assert.equal(migrateHarnessBucket(ctx).migrated, false);
  assert.equal(JSON.stringify(bucket), saved);
  assert.equal(
    cleanupExpiredPendingOnHook("agent.before_llm_call", ctx, {
      harness: { pendingTtlHookTurns: 1 },
    }),
    true,
  );
  assert.equal(bucket.state.pending.analysis, false);
  assert.ok(bucket.logs.guidance.some((entry) => entry.event === "pending_state_ttl_cleaned"));
});

test("pending writers record the current hook turn and missing runtime times are rejected", () => {
  const ctx = createTestHookContext(context(createHarnessBucket()));
  const { state } = ctx.agentContext.bindings.extensions.harness;
  state.counters.hookTurns = 4;
  setPendingStateWithMeta(state, "analysis", true);
  assert.equal(state.pendingMeta.pending.analysis, 4);
  delete state.pendingMeta.pending.analysis;
  assert.throws(
    () =>
      cleanupExpiredPendingOnHook("agent.before_turn", ctx, {
        harness: { pendingTtlHookTurns: 1 },
      }),
    /invalid_harness_pending_time/,
  );
  assert.equal(Object.hasOwn(state.pendingMeta.pending, "analysis"), false);
});

test("invalid pending TTL is rejected before hook ticks or pending cleanup", () => {
  for (const pendingTtlHookTurns of [-1, 1.5, "invalid", Infinity]) {
    const ctx = createTestHookContext(context(createHarnessBucket()));
    const bucket = ctx.agentContext.bindings.extensions.harness;
    setPendingStateWithMeta(bucket.state, "analysis", true);
    const saved = structuredClone(bucket);
    assert.throws(() =>
      cleanupExpiredPendingOnHook("agent.before_llm_call", ctx, {
        harness: { pendingTtlHookTurns },
      }),
    );
    assert.deepEqual(bucket, saved);
  }
});

test("pending and capture writes reject corrupt clocks before changing state", () => {
  for (const hookTurns of [undefined, "3", -1, NaN]) {
    for (const write of [
      (state) => setPendingStateWithMeta(state, "analysis", true),
      (state) => setCaptureFlagStateWithMeta(state, "planUpdateCapturePending", true),
    ]) {
      const { state } = createHarnessBucket();
      state.counters.hookTurns = hookTurns;
      const saved = structuredClone(state);
      assert.throws(() => write(state), /invalid_harness_state:hookTurns/);
      assert.deepEqual(state, saved);
    }
  }
});

test("pending writers reject invalid values and unknown keys without normalizing state", () => {
  for (const write of [
    (state) => setPendingStateWithMeta(state, "analysis", "true"),
    (state) => setPendingStateWithMeta(state, "unknown", true),
    (state) => setPendingStateWithMeta(state, "guidance", {}),
    (state) => setPendingStateWithMeta(state, "acceptanceSemanticValidation", { reportIndex: "0" }),
    (state) => setPendingStateWithMeta(state, "acceptanceSemanticValidation", { reportIndex: -1 }),
    (state) => setCaptureFlagStateWithMeta(state, "planUpdateCapturePending", "true"),
    (state) => setCaptureFlagStateWithMeta(state, "unknown", false),
  ]) {
    const { state } = createHarnessBucket();
    const saved = structuredClone(state);
    assert.throws(() => write(state), /invalid_harness_state/);
    assert.deepEqual(state, saved);
  }
});

test("v12 migration initializes only new plan histories and remains idempotent", () => {
  const bucket = createHarnessBucket();
  bucket.__harnessBucketVersion = 12;
  delete bucket.planRevisions;
  delete bucket.planRefinementRecords;
  const ctx = context(bucket);
  assert.equal(migrateHarnessBucket(ctx).toVersion, HARNESS_BUCKET_VERSION);
  assert.deepEqual(bucket.planRevisions, []);
  assert.deepEqual(bucket.planRefinementRecords, []);
  const saved = structuredClone(bucket);
  assert.equal(migrateHarnessBucket(ctx).migrated, false);
  assert.deepEqual(bucket, saved);
  bucket.__harnessBucketVersion = 12;
  delete bucket.state.counters.summaryTurns;
  const corrupt = structuredClone(bucket);
  assert.throws(() => migrateHarnessBucket(ctx), /invalid_harness_state/);
  assert.deepEqual(bucket, corrupt);
});

test("plan refinement policy rejects missing state containers before mutation", () => {
  for (const section of ["pending", "flags"]) {
    for (const apply of [
      (state) => clearPendingPlanRefinement(state),
      (state) =>
        syncPlanRefinementPolicyFlag({}, state, { harness: { planRefinementEnabled: false } }),
    ]) {
      const { state } = createHarnessBucket();
      delete state[section];
      const before = structuredClone(state);
      assert.throws(() => apply(state), /invalid_harness_state/);
      assert.deepEqual(state, before);
    }
  }
});
