/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { createTestModelResponse } from "../helpers/public-runtime-fixtures.js";
import test from "node:test";
import assert from "node:assert/strict";

import {
  createGuidanceHandler,
  createAgentContext,
} from "../helpers/guidance-plan-update-threshold-helper.js";
import { resolveContextInjectedMessageType } from "@noobot/context-protocol/message/codec";

test("separate_model mode: when turn-summary and revision are both pending, planning_revision runs before summary", async () => {
  const handler = createGuidanceHandler({ shouldProcessPrimaryToolHooks: () => true });
  const invocations = [];
  const agentContext = createAgentContext({
    pending: {
      summary: true,
      planRevision: true,
      planRevisionContext: { targetMainStepIndexes: [] },
    },
  });
  const meta = {
    harness: {
      planningGuidanceMode: "separate_model",
      capabilityModelInvoker: async (payload = {}) => {
        invocations.push(payload);
        return createTestModelResponse("小结完成");
      },
    },
  };

  const ctx = {
    messageBlocks: { system: [], history: [], incremental: [{ role: "user", content: "继续" }] },
    agentContext,
  };
  await handler({ capability: "guidance", point: "agent.before_llm_call", ctx, meta });
  assert.equal(invocations.length >= 1, true);
  assert.equal(invocations[0]?.purpose, "planning_revision");
  assert.equal(
    invocations.some((item = {}) => item.purpose === "planning_revision"),
    true,
  );
  assert.equal(
    invocations.some((item = {}) => item.purpose === "summary"),
    true,
  );
  assert.equal(agentContext.bindings.extensions.harness.state.pending.summary, false);
  assert.equal(agentContext.bindings.extensions.harness.state.pending.planRevision, false);
  assert.equal(agentContext.bindings.extensions.harness.state.pending.planRefinement, false);
  assert.equal(
    ctx.modelContext.messages.some((msg = {}) =>
      String(msg?.content || "").includes("harness-planning-revision"),
    ),
    false,
  );
});

test("separate_model mode: pending revision runs by separate model without prompt injection", async () => {
  const handler = createGuidanceHandler({ shouldProcessPrimaryToolHooks: () => true });
  const invocations = [];
  const agentContext = createAgentContext({
    pending: {
      planRevision: true,
      planRevisionContext: { targetMainStepIndexes: [] },
    },
  });
  const meta = {
    harness: {
      planningGuidanceMode: "separate_model",
      capabilityModelInvoker: async (payload = {}) => {
        invocations.push(payload);
        if (payload.purpose === "planning_revision") return createTestModelResponse("");
        return createTestModelResponse("");
      },
    },
  };

  const ctx = {
    messageBlocks: { system: [], history: [], incremental: [{ role: "user", content: "继续" }] },
    agentContext,
  };
  await handler({ capability: "guidance", point: "agent.before_llm_call", ctx, meta });
  assert.equal(
    invocations.some((item = {}) => item.purpose === "planning_revision"),
    true,
  );
  assert.equal(
    ctx.modelContext.messages.some((msg = {}) =>
      String(msg?.content || "").includes("harness-planning-revision"),
    ),
    false,
  );
  assert.equal(agentContext.bindings.extensions.harness.state.pending.planRevision, false);
  assert.equal(agentContext.bindings.extensions.harness.state.pending.planRefinement, false);
});

test("separate_model simultaneous plan update follows up with summary before analysis", async () => {
  const handler = createGuidanceHandler({ shouldProcessPrimaryToolHooks: () => true });
  const invocations = [];
  const agentContext = createAgentContext({
    pending: {
      summary: true,
      analysis: true,
      planRevision: true,
      planRevisionContext: { targetMainStepIndexes: [] },
    },
  });
  agentContext.bindings.extensions.harness.state.flags.planRefinementEnabled = false;
  const meta = {
    harness: {
      planningGuidanceMode: "separate_model",
      capabilityModelInvoker: async (payload = {}) => {
        invocations.push(payload);
        if (payload.purpose === "planning_revision") {
          return createTestModelResponse("ADD [2] 补充执行");
        }
        if (payload.pluginFlow === "analysis") {
          return createTestModelResponse("疑点：计划更新后还有待确认项。");
        }
        return createTestModelResponse("小结完成");
      },
    },
  };

  const ctx = {
    messageBlocks: { system: [], history: [], incremental: [{ role: "user", content: "继续" }] },
    agentContext,
  };
  await handler({ capability: "guidance", point: "agent.before_llm_call", ctx, meta });

  assert.deepEqual(
    invocations.map((item = {}) => item.pluginFlow || item.purpose),
    ["planning_revision", "summary"],
  );
  assert.equal(agentContext.bindings.extensions.harness.state.pending.planRevision, false);
  assert.equal(agentContext.bindings.extensions.harness.state.pending.analysis, true);
  assert.equal(agentContext.bindings.extensions.harness.state.pending.summary, false);
  assert.equal(
    ctx.modelContext.messages.some(
      (item = {}) =>
        resolveContextInjectedMessageType(item) === "separate_model_relay:guidance" &&
        String(item?.content || "").includes("疑点"),
    ),
    false,
  );
  assert.equal(
    ctx.modelContext.messages.some(
      (item = {}) =>
        resolveContextInjectedMessageType(item) === "separate_model_relay:summary" &&
        String(item?.content || "").includes("小结完成"),
    ),
    true,
  );
  const executionLog = agentContext.bindings.extensions.harness.logs.guidance.find(
    (item = {}) => item?.event === "workflow_execution_result",
  );
  assert.equal(executionLog?.detail?.chosenAction, "plan_update_revision");
  assert.equal(executionLog?.detail?.requestedAction, "plan_update_revision_separate_model");
  assert.equal(executionLog?.detail?.executedPrimary, true);
  assert.equal(executionLog?.detail?.executedFollowup, true);
});

test("workflow_execution_result captures errorCode when separate_model guidance fails", async () => {
  const handler = createGuidanceHandler({ shouldProcessPrimaryToolHooks: () => true });
  const agentContext = createAgentContext({
    pending: {
      guidance: "consecutive_failures",
    },
  });
  const meta = {
    harness: {
      planningGuidanceMode: "separate_model",
      capabilityModelInvoker: async () => {
        throw new Error("model down");
      },
    },
  };

  const ctx = {
    messageBlocks: { system: [], history: [], incremental: [{ role: "user", content: "继续" }] },
    agentContext,
  };
  await handler({ capability: "guidance", point: "agent.before_llm_call", ctx, meta });

  const executionLog = agentContext.bindings.extensions.harness.logs.guidance.find(
    (item = {}) => item?.event === "workflow_execution_result",
  );
  assert.equal(Boolean(executionLog), true);
  assert.equal(executionLog?.detail?.mode, "separate_model");
  assert.equal(executionLog?.detail?.chosenAction, "guidance");
  assert.equal(executionLog?.detail?.errorCode, "GUIDANCE_SEPARATE_MODEL_CALL_FAILED");
});
