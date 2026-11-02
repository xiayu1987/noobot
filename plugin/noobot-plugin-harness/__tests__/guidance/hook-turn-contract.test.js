/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  createGuidanceHandler,
  createPlanningHandler,
  createPlanningAgentContext,
} from "../helpers/guidance-plan-update-threshold-helper.js";

for (const [capability, factory] of [
  ["planning", createPlanningHandler],
  ["guidance", createGuidanceHandler],
]) {
  test(`${capability} rejects invalid hook rounds without incrementing counters`, async () => {
    const handler = factory({ shouldProcessPrimaryToolHooks: () => true });
    const agentContext = createPlanningAgentContext();
    await handler({
      capability,
      point: "agent.before_llm_call",
      ctx: { turn: 1, agentContext },
      meta: {},
    });
    const counters = agentContext.bindings.extensions.harness.state.counters;
    const before = structuredClone(counters);
    for (const turn of [undefined, null, "2", 0, 1.5]) {
      await assert.rejects(
        handler({
          capability,
          point: "agent.before_llm_call",
          ctx: { turn, agentContext },
          meta: {},
        }),
        /positive integer turn/,
      );
      assert.deepEqual(counters, before);
    }
  });

  test(`${capability} does not increment counters twice for the same round`, async () => {
    const handler = factory({ shouldProcessPrimaryToolHooks: () => true });
    const agentContext = createPlanningAgentContext();
    const input = () => ({
      capability,
      point: "agent.before_llm_call",
      ctx: { turn: 1, agentContext },
      meta: {},
    });
    await handler(input());
    const before = structuredClone(agentContext.bindings.extensions.harness.state.counters);
    await handler(input());
    assert.deepEqual(agentContext.bindings.extensions.harness.state.counters, before);
  });
}
