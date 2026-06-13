/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";

import {
  resolveGuidancePriorityDecision,
  resolveNextGuidanceAction,
  resolvePendingPlanUpdate,
} from "../src/capabilities/handlers/planning/plan-update-scheduler.js";

test("scheduler priority: overflow-summary > guidance > revision > refinement > turn-summary", () => {
  assert.deepEqual(
    resolveNextGuidanceAction({
      flags: { summaryByCharsPrompted: true },
      pending: {
        summary: true,
        guidance: "consecutive_failures",
        planRevision: true,
        planRevisionContext: { targetMainStepIndexes: [] },
      },
    }),
    { action: "summary", stage: "", reason: "pending_summary_overflow" },
  );

  assert.deepEqual(
    resolveNextGuidanceAction({
      pending: {
        summary: true,
        guidance: "consecutive_failures",
        planRevision: true,
        planRevisionContext: { targetMainStepIndexes: [] },
      },
    }),
    { action: "guidance", stage: "", reason: "pending_guidance" },
  );

  assert.deepEqual(
    resolveNextGuidanceAction({
      pending: {
        summary: false,
        guidance: "consecutive_failures",
        planRevision: true,
        planRevisionContext: { targetMainStepIndexes: [] },
      },
    }),
    { action: "guidance", stage: "", reason: "pending_guidance" },
  );

  assert.deepEqual(
    resolveNextGuidanceAction({
      pending: {
        summary: false,
        guidance: null,
        planRevision: true,
        planRevisionContext: { targetMainStepIndexes: [] },
      },
    }),
    { action: "plan_update", stage: "revision", reason: "pending_revision" },
  );

  assert.deepEqual(
    resolveNextGuidanceAction({
      pending: {
        summary: false,
        guidance: null,
        planRefinement: true,
        planRefinementContext: { targetMainStepIndexes: [1] },
      },
    }),
    { action: "plan_update", stage: "refinement", reason: "pending_refinement" },
  );

  assert.deepEqual(
    resolveNextGuidanceAction({
      pending: { summary: true, guidance: null, planRevision: false, planRefinement: false },
    }),
    { action: "summary", stage: "", reason: "pending_summary_turns" },
  );
});

test("scheduler resolves independent revision/refinement pending fields", () => {
  const resolved = resolvePendingPlanUpdate({
    pending: {
      planRevision: true,
      planRevisionContext: {
        targetMainStepIndexes: [1, 2],
      },
    },
  });
  assert.deepEqual(resolved, {
    active: true,
    stage: "revision",
    targetMainStepIndexes: [1, 2],
  });
  assert.deepEqual(
    resolveNextGuidanceAction({
      pending: {
        planRevision: true,
        planRevisionContext: { targetMainStepIndexes: [] },
      },
    }),
    {
      action: "plan_update",
      stage: "revision",
      reason: "pending_revision",
    },
  );
});

test("priority decision snapshot exposes chosen and blocked actions", () => {
  const decision = resolveGuidancePriorityDecision({
    pending: {
      summary: true,
      guidance: null,
      planRevision: true,
      planRevisionContext: { targetMainStepIndexes: [] },
      phaseAcceptance: true,
    },
    flags: {
      summaryByCharsPrompted: false,
    },
  });
  assert.equal(decision.chosenAction, "plan_update_revision");
  assert.equal(decision.chosenReason, "pending_revision");
  assert.match(String(decision.chosenReasonLabel || ""), /待处理的计划修订|revision/i);
  assert.deepEqual(decision.blockedActions, ["summary_turns", "phase_acceptance"]);
  assert.equal(Array.isArray(decision.blockedReasonLabels), true);
  assert.equal(decision.blockedReasonLabels.length > 0, true);
  assert.equal(decision.pendingSnapshot.summary?.active, true);
  assert.equal(decision.pendingSnapshot.flags?.summaryByCharsPrompted, false);
  assert.equal(decision.pendingSnapshot.phaseAcceptance?.active, true);
});

test("priority decision exposes localized reason labels by locale", () => {
  const zhDecision = resolveGuidancePriorityDecision({
    locale: "zh-CN",
    pending: { guidance: "consecutive_failures" },
    flags: {},
  });
  const enDecision = resolveGuidancePriorityDecision({
    locale: "en-US",
    pending: { guidance: "consecutive_failures" },
    flags: {},
  });
  assert.match(String(zhDecision.chosenReasonLabel || ""), /优先执行 guidance|待处理/);
  assert.match(String(enDecision.chosenReasonLabel || ""), /prioritize guidance/i);
});

test("when revision and refinement are both pending, scheduler always prefers revision", () => {
  const resolved = resolvePendingPlanUpdate({
    pending: {
      planRevision: true,
      planRevisionContext: { targetMainStepIndexes: [1] },
      planRefinement: true,
      planRefinementContext: { targetMainStepIndexes: [2] },
    },
  });
  assert.deepEqual(resolved, {
    active: true,
    stage: "revision",
    targetMainStepIndexes: [1],
  });

  const action = resolveNextGuidanceAction({
    pending: {
      planRevision: true,
      planRevisionContext: { targetMainStepIndexes: [1] },
      planRefinement: true,
      planRefinementContext: { targetMainStepIndexes: [2] },
    },
  });
  assert.deepEqual(action, {
    action: "plan_update",
    stage: "revision",
    reason: "pending_revision",
  });
});
