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
  canAttemptPlanRevision,
  runPlanUpdateAfterSummary,
  LLM_SUMMARY_THRESHOLD,
  LLM_SUMMARY_MESSAGE_CHARS_THRESHOLD,
  MAX_PLAN_UPDATE_ATTEMPTS,
  FULL_SUMMARY_TRIGGER_TURNS_THRESHOLD,
  FULL_ANALYSIS_TRIGGER_TURNS_THRESHOLD,
  PROGRAMMING_SUMMARY_TRIGGER_TURNS_THRESHOLD,
  PROGRAMMING_ANALYSIS_TRIGGER_TURNS_THRESHOLD,
  FULL_PLAN_UPDATE_TRIGGER_TURNS_THRESHOLD,
  PROGRAMMING_PLAN_UPDATE_TRIGGER_TURNS_THRESHOLD,
  FULL_PHASE_ACCEPTANCE_TRIGGER_TURNS_THRESHOLD,
  PROGRAMMING_PHASE_ACCEPTANCE_TRIGGER_TURNS_THRESHOLD,
  TEXT_SUMMARY_TRIGGER_TURNS_THRESHOLD,
  TEXT_ANALYSIS_TRIGGER_TURNS_THRESHOLD,
  TEXT_PLAN_UPDATE_TRIGGER_TURNS_THRESHOLD,
  TEXT_PHASE_ACCEPTANCE_TRIGGER_TURNS_THRESHOLD,
  createAgentContext,
  createPlanningAgentContext,
} from "./helpers/guidance-plan-update-threshold-helper.js";

test("revision and refinement have independent MAX_PLAN_UPDATE_ATTEMPTS budgets", () => {
  const state = {
    counters: {
      planRevisionAttempts: 0,
      planRefinementAttempts: 0,
    },
  };
  for (let index = 0; index < MAX_PLAN_UPDATE_ATTEMPTS; index += 1) {
    assert.equal(canAttemptPlanRevision({}, state, { increment: true, stage: "revision" }), true);
  }
  assert.equal(state.counters.planRevisionAttempts, MAX_PLAN_UPDATE_ATTEMPTS);
  assert.equal(canAttemptPlanRevision({}, state, { increment: false, stage: "revision" }), false);
  assert.equal(canAttemptPlanRevision({}, state, { increment: false, stage: "refinement" }), true);
});

test("unified attempts no longer block revision scheduling in planning handler", async () => {
  const planningHandler = createPlanningHandler({ shouldProcessPrimaryToolHooks: () => true });
  const agentContext = createPlanningAgentContext({
    counters: {
      planUpdateTurns: FULL_PLAN_UPDATE_TRIGGER_TURNS_THRESHOLD - 1,
      planUpdateAttempts: MAX_PLAN_UPDATE_ATTEMPTS,
    },
  });
  const ctx = { messages: [{ role: "user", content: "继续任务" }], agentContext };
  await planningHandler({ capability: "planning", point: "before_llm_call", ctx, meta: {} });
  assert.equal(agentContext.payload.harness.state.pending.planRevision, true);
  assert.equal(agentContext.payload.harness.state.counters.planUpdateTurns, 0);
});

test("inject refinement-only flow consumes refinement attempts", async () => {
  const handler = createGuidanceHandler({ shouldProcessPrimaryToolHooks: () => true });
  const agentContext = createAgentContext({
    planText: "1. 主任务\n",
    pending: {
      planRefinement: true,
      planRefinementContext: { targetMainStepIndexes: [1] },
    },
    counters: { planRevisionAttempts: 0, planRefinementAttempts: 0, planUpdateAttempts: 0 },
  });
  const meta = { harness: { planningGuidanceMode: "inject", capabilityModelInvoker: null } };

  const beforeCtx = { messages: [{ role: "user", content: "继续" }], agentContext };
  await handler({ capability: "guidance", point: "before_llm_call", ctx: beforeCtx, meta });
  const afterCtx = {
    messages: beforeCtx.messages,
    ai: { content: "ADD 1.1 细化步骤A" },
    agentContext,
  };
  await handler({ capability: "guidance", point: "after_llm_call", ctx: afterCtx, meta });
  assert.equal(agentContext.payload.harness.state.counters.planRefinementAttempts, 1);
  assert.equal(agentContext.payload.harness.state.counters.planUpdateAttempts, 1);
});

test("separate_model refinement-only flow runs planning_refinement then guidance followup", async () => {
  const handler = createGuidanceHandler({ shouldProcessPrimaryToolHooks: () => true });
  const invocations = [];
  const agentContext = createAgentContext({
    planText: "1. 主任务\n",
    pending: {
      planRefinement: true,
      planRefinementContext: { targetMainStepIndexes: [1] },
    },
    counters: { planRevisionAttempts: 0, planRefinementAttempts: 0, planUpdateAttempts: 0 },
  });
  const meta = {
    harness: {
      planningGuidanceMode: "separate_model",
      capabilityModelInvoker: async (payload = {}) => {
        invocations.push(payload);
        if (payload.purpose === "planning_refinement") return { content: "ADD 1.1 细化步骤A" };
        return { content: "" };
      },
    },
  };

  await handler({
    capability: "guidance",
    point: "before_llm_call",
    ctx: { messages: [{ role: "user", content: "继续" }], agentContext },
    meta,
  });

  assert.deepEqual(
    invocations.map((item = {}) => item.purpose),
    ["planning_refinement", "guidance"],
  );
  assert.equal(agentContext.payload.harness.state.counters.planRevisionAttempts, 0);
  assert.equal(agentContext.payload.harness.state.counters.planRefinementAttempts, 1);
  assert.equal(agentContext.payload.harness.state.pending.planRevision, false);
  assert.equal(agentContext.payload.harness.state.pending.planRefinement, false);
  assert.equal(agentContext.payload.harness.state.pending.guidance, null);
});


test("planning revision followup uses dynamic programming scenario over initial text scenario", async () => {
  const agentContext = createAgentContext({
    counters: { llmTurns: 16, planUpdateTurns: -100 },
  });
  agentContext.execution = {
    controllers: {
      runtime: {
        runConfig: { scenario: "text" },
        systemRuntime: { runConfig: { scenario: "text" } },
      },
    },
  };
  const ctx = {
    agentContext,
    messages: [{ role: "user", content: "继续修代码" }],
  };
  const revisedPlan = JSON.stringify({
    totalGoal: "修复代码",
    taskOwner: "primary_task_owner",
    taskChecklist: [
      {
        index: 1,
        task: "修改代码并验证",
        owner: "primary_task_owner",
        input: "当前仓库",
        output: "通过测试的代码修改",
        files: { create: [], modify: ["plugin/noobot-plugin-harness/src/index.js"], delete: [] },
      },
    ],
  });
  const meta = {
    harness: {
      capabilityModelInvoker: async (payload = {}) => {
        if (payload.purpose === "planning_refinement") return { content: "" };
        return {
          content: [
            revisedPlan,
            "[HARNESS_DYNAMIC_POLICY_PROMPT]",
            "scenario = programming",
            "reason = actual user intent is code change",
            "prompt:",
            "Dynamic policy: perform smallest-slice reversible code changes and verify after each step.",
            "[/HARNESS_DYNAMIC_POLICY_PROMPT]",
          ].join("\n"),
        };
      },
    },
  };

  const changed = await runPlanUpdateAfterSummary(ctx, meta);
  assert.equal(changed, true);
  assert.equal(agentContext.payload.harness.dynamicPolicyPrompt?.scenario, "programming");

  const followupMessage = ctx.messages.find((item = {}) =>
    /next_phase_plan_followup/.test(String(item?.content || "")),
  );
  const followupText = String(followupMessage?.content || "");
  assert.match(followupText, /具体推进方式遵守系统场景策略/);
  assert.doesNotMatch(followupText, /\[HARNESS_SCENARIO_POLICY\]/);
  assert.doesNotMatch(followupText, /Dynamic policy: perform smallest-slice reversible code changes and verify after each step/);
  assert.doesNotMatch(followupText, /文本场景批次产出/);
  assert.doesNotMatch(followupText, /建议外部文本拿到就保真消费/);
});

test("runPlanUpdateAfterSummary does not start revision when refinement is already pending", async () => {
  const invocations = [];
  const ctx = {
    agentContext: createAgentContext({
      pending: {
        planRefinement: true,
        planRefinementContext: { targetMainStepIndexes: [1] },
      },
    }),
    messages: [{ role: "user", content: "继续" }],
  };
  const meta = {
    harness: {
      capabilityModelInvoker: async (payload = {}) => {
        invocations.push(payload);
        return { content: "" };
      },
    },
  };
  const changed = await runPlanUpdateAfterSummary(ctx, meta, "小结完成");
  assert.equal(changed, false);
  assert.deepEqual(invocations.map((item = {}) => item.purpose), []);
  assert.equal(ctx.agentContext.payload.harness.state.pending.planRefinement, true);
  assert.equal(ctx.agentContext.payload.harness.state.pending.planRevision, false);
});

test("separate_model skips planning_revision when revision attempts already reached max", async () => {
  const handler = createGuidanceHandler({ shouldProcessPrimaryToolHooks: () => true });
  const invocations = [];
  const agentContext = createAgentContext({
    pending: { summary: true },
    counters: {
      planRevisionAttempts: MAX_PLAN_UPDATE_ATTEMPTS,
      planRefinementAttempts: 0,
      planUpdateAttempts: MAX_PLAN_UPDATE_ATTEMPTS,
    },
  });
  const meta = {
    harness: {
      planningGuidanceMode: "separate_model",
      capabilityModelInvoker: async (payload = {}) => {
        invocations.push(payload);
        return { content: "小结完成" };
      },
    },
  };
  await handler({
    capability: "guidance",
    point: "before_llm_call",
    ctx: { messages: [{ role: "user", content: "继续" }], agentContext },
    meta,
  });
  assert.deepEqual(invocations.map((item = {}) => item.purpose), ["summary"]);
});

test("separate_model summary does not consume refinement attempts", async () => {
  const handler = createGuidanceHandler({ shouldProcessPrimaryToolHooks: () => true });
  const invocations = [];
  const agentContext = createAgentContext({
    planText: "1. 主任务\n",
    pending: { summary: true },
    counters: {
      planRevisionAttempts: 0,
      planRefinementAttempts: MAX_PLAN_UPDATE_ATTEMPTS,
      planUpdateAttempts: MAX_PLAN_UPDATE_ATTEMPTS,
    },
  });
  const meta = {
    harness: {
      planningGuidanceMode: "separate_model",
      capabilityModelInvoker: async (payload = {}) => {
        invocations.push(payload);
        if (payload.purpose === "summary") return { content: "小结完成" };
        return { content: "" };
      },
    },
  };
  await handler({
    capability: "guidance",
    point: "before_llm_call",
    ctx: { messages: [{ role: "user", content: "继续" }], agentContext },
    meta,
  });
  assert.deepEqual(invocations.map((item = {}) => item.purpose), ["summary"]);
  assert.equal(agentContext.payload.harness.state.counters.planRevisionAttempts, 0);
  assert.equal(agentContext.payload.harness.state.counters.planRefinementAttempts, MAX_PLAN_UPDATE_ATTEMPTS);
  assert.equal(agentContext.payload.harness.logs.planning.length >= 0, true);
});

test("separate_model does not auto-run refinement when revision has no main-plan diff", async () => {
  const handler = createGuidanceHandler({ shouldProcessPrimaryToolHooks: () => true });
  const invocations = [];
  const agentContext = createAgentContext({
    planText: "1. 主任务\n",
    pending: { summary: true },
  });
  const meta = {
    harness: {
      planningGuidanceMode: "separate_model",
      capabilityModelInvoker: async (payload = {}) => {
        invocations.push(payload);
        if (payload.purpose === "summary") return { content: "小结完成" };
        return { content: "" };
      },
    },
  };
  await handler({
    capability: "guidance",
    point: "before_llm_call",
    ctx: { messages: [{ role: "user", content: "继续" }], agentContext },
    meta,
  });
  assert.deepEqual(
    invocations.map((item = {}) => item.purpose),
    ["summary"],
  );
});
