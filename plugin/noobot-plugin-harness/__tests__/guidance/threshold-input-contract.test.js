/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  resolveAnalysisThresholdWithSource,
  resolveGatedThresholdWithSource,
} from "../../src/capabilities/handlers/shared/threshold-utils.js";
import {
  createGuidanceHandler,
  createPlanningHandler,
  createAgentContext,
} from "../helpers/guidance-plan-update-threshold-helper.js";
import { ensureTestHookContext } from "../helpers/public-runtime-fixtures.js";

const invalidValues = [null, "2", 0, -1, 1.5, NaN, Infinity, {}, Number.MAX_SAFE_INTEGER + 1];

test("threshold contract rejects malformed declared facts without coercion or fallback", () => {
  for (const runtimeValue of invalidValues) {
    const input = { runtimeValue, scopedValue: 3, defaultValue: 4 };
    assert.throws(() => resolveAnalysisThresholdWithSource(input));
    for (const frontendThresholdsEnabled of [false, true]) {
      assert.throws(() =>
        resolveGatedThresholdWithSource({
          ...input,
          meta: { harness: { frontendThresholdsEnabled } },
        }),
      );
    }
  }
  assert.deepEqual(resolveAnalysisThresholdWithSource({ runtimeValue: 11 }), {
    value: 11,
    source: "runtime",
  });
  assert.deepEqual(resolveAnalysisThresholdWithSource({ scopedValue: 3, defaultValue: 4 }), {
    value: 3,
    source: "workflow_params",
  });
});

test("invalid guidance and planning thresholds reject before mutating harness state", async () => {
  const cases = [
    [createGuidanceHandler, "guidance", { guidance: { analysis: { turnsThreshold: "2" } } }],
    [createGuidanceHandler, "guidance", { guidance: { summary: { turnsThreshold: 1.5 } } }],
    [createPlanningHandler, "planning", { planning: { planUpdate: { triggerTurnsThreshold: 0 } } }],
    [createPlanningHandler, "planning", { acceptance: { phase: { triggerTurnsThreshold: null } } }],
  ];
  for (const [factory, capability, config] of cases) {
    const ctx = ensureTestHookContext({ turn: 2, agentContext: createAgentContext() });
    const bucket = ctx.agentContext.bindings.extensions.harness;
    const before = structuredClone(bucket.state);
    const handler = factory({ shouldProcessPrimaryToolHooks: () => true });
    await assert.rejects(
      handler({
        capability,
        point: "agent.before_llm_call",
        ctx,
        meta: { harness: { frontendThresholdsEnabled: true, ...config } },
      }),
    );
    assert.deepEqual(bucket.state, before);
  }
});
