/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";

import { maybeInjectPlanUpdatePrompt } from "../../src/capabilities/handlers/guidance/revision-injector.js";
import { readPlanUpdateCaptureContext } from "../../src/capabilities/handlers/planning/plan-update-engine.js";
import { ensureHarnessBucket } from "../../src/capabilities/handlers/shared/bucket-utils.js";
import { createAgentContext } from "../helpers/guidance-plan-update-threshold-helper.js";
import {
  createTestHookContext,
  getTestContextMessages,
} from "../helpers/public-runtime-fixtures.js";
import { resolveContextInjectedMessageType } from "@noobot/context-protocol/message/codec";

function createRefinementInjectContext(planText) {
  const agentContext = createAgentContext({
    planText,
    pending: { planRefinement: true, planRefinementContext: { targetMainStepIndexes: [3] } },
  });
  const ctx = createTestHookContext({
    agentContext,
    messageBlocks: { system: [], history: [], incremental: [{ role: "user", content: "继续" }] },
  });
  return { ctx, ...ensureHarnessBucket(ctx) };
}

function injectedTypes(ctx) {
  return getTestContextMessages(ctx).map((item = {}) => resolveContextInjectedMessageType(item));
}

test("refinement inject converges when scheduled targets became stale and every main step is refined", () => {
  const { ctx, bucket, state } = createRefinementInjectContext(
    ["1. 主计划一", "1.1 子计划一", "2. 主计划二", "2.1 子计划二"].join("\n"),
  );

  assert.equal(maybeInjectPlanUpdatePrompt(ctx), false);
  assert.equal(injectedTypes(ctx).includes("planning_refinement_prompt"), false);
  assert.equal(state.pending.planRefinement, false);
  assert.equal(state.pending.planRefinementContext, null);
  assert.notEqual(state.flags.planUpdateCapturePending, true);
  assert.equal(
    bucket.logs.planning.some(
      (item = {}) => item.event === "planning_refinement_converged_no_target_main_step",
    ),
    true,
  );
});

test("refinement inject writes the resolved prompt targets into the capture context", () => {
  const { ctx, state } = createRefinementInjectContext(
    ["1. 主计划一", "1.1 子计划一", "2. 主计划二"].join("\n"),
  );

  assert.equal(maybeInjectPlanUpdatePrompt(ctx), true);
  assert.equal(injectedTypes(ctx).includes("planning_refinement_prompt"), true);
  assert.deepEqual(readPlanUpdateCaptureContext(state), {
    stage: "refinement",
    targetMainStepIndexes: [2],
  });
});
