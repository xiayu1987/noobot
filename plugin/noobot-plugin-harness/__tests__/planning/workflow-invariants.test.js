/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import { enforceWorkflowInvariants } from "../../src/capabilities/handlers/shared/workflow/invariants.js";

function createCtx(pending) {
  return {
    agentContext: {
      bindings: { extensions: { harness: { state: { pending, flags: {} } } } },
    },
  };
}

test("workflow invariants keep valid pending plan update context without violation", () => {
  const context = { targetMainStepIndexes: [2] };
  const ctx = createCtx({ planRefinement: true, planRefinementContext: context });

  assert.equal(enforceWorkflowInvariants(ctx, { domain: "planning" }), false);
  const { pending } = ctx.agentContext.bindings.extensions.harness.state;
  assert.equal(pending.planRefinementContext, context);
  assert.equal(ctx.harnessCapabilityLogs, undefined);
});

test("workflow invariants clear stale plan update context without pending flag", () => {
  const ctx = createCtx({
    planRevision: false,
    planRevisionContext: { targetMainStepIndexes: [] },
  });

  assert.equal(enforceWorkflowInvariants(ctx, { domain: "planning" }), true);
  const { pending } = ctx.agentContext.bindings.extensions.harness.state;
  assert.equal(pending.planRevisionContext, null);
});
