/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  createTestHookManager as createAgentHookManager,
  createTestModelResponse,
  TestModelMessageRuntimeHelpers as ModelMessageRuntimeHelpers,
} from "../helpers/public-runtime-fixtures.js";
import { registerHarnessCore } from "../../src/index.js";
import { createGuidanceHandler } from "../helpers/context-aware-handler-fixtures.js";

function assertFlatCapabilityMessages(messages = []) {
  assert.equal(Array.isArray(messages), true);
  assert.equal(messages.length >= 1, true);
  const roles = messages.map((item = {}) => String(item?.role || "").trim());
  assert.equal(
    roles.every((role) => ["system", "user", "assistant", "tool"].includes(role)),
    true,
  );
  const first = messages[0] || {};
  const last = messages[messages.length - 1] || {};
  assert.equal(["system", "user", "assistant", "tool"].includes(String(first.role || "")), true);
  assert.equal(["system", "user", "assistant", "tool"].includes(String(last.role || "")), true);
}

test("harness summary relay without captured plan keeps final acceptance on default checklist", async () => {
  const hookManager = createAgentHookManager();
  const invocations = [];
  registerHarnessCore(
    { hookManager },
    {
      trace: false,
      promptPolicy: false,
      planningGuidanceMode: "separate_model",
      resolveModelMessages: new ModelMessageRuntimeHelpers().createResolveModelMessages(),
      capabilityModelInvoker: async (payload) => {
        invocations.push(payload);
        if (payload.purpose === "summary") {
          return createTestModelResponse("已完成：完成初始检查\n小结完成");
        }
        return createTestModelResponse("{}");
      },
    },
  );

  const basePath = await fs.mkdtemp(path.join(os.tmpdir(), "noobot-summary-opdir-"));
  const agentContext = {
    bindings: {
      runtime: {
        basePath,
        userId: "summary-user",
        globalConfig: { security: { executionIsolation: { mode: "host" } } },
        systemRuntime: { userId: "summary-user", sessionId: "summary-session" },
      },
      extensions: {
        harness: {
          state: {
            flags: { planningCaptured: true, acceptanceRequested: false },
            counters: {
              llmTurns: 16,
              planUpdateTurns: -100,
              consecutiveToolFailures: 0,
              totalToolFailures: 0,
            },
            signals: { successfulToolCount: 1 },
            pending: { summary: true, guidance: null },
          },
          logs: { planning: [], guidance: [], acceptance: [], review: [] },
        },
      },
    },
  };

  const messagesCtx = {
    messageBlocks: { system: [], history: [], incremental: [{ role: "user", content: "继续" }] },
    agentContext,
  };
  await hookManager.emit("agent.before_llm_call", messagesCtx);
  const messages = messagesCtx.modelContext.messageBlocks.incremental;

  assert.deepEqual(
    invocations.map((item) => item.purpose),
    ["summary"],
  );
  const summaryRelayMessage = messages.find((item = {}) =>
    /\[来自harness外部模型输出\/summary\]/.test(String(item?.content || "")),
  );
  const summaryRelayText = String(summaryRelayMessage?.content || "");
  assert.match(summaryRelayText, /已完成：完成初始检查/);
  assert.match(summaryRelayText, /\[Harness operation dir\] runtime\/ops_workdir/);
  assert.equal(
    summaryRelayText.includes(`Use (non-sandbox): ${basePath}/runtime/ops_workdir`),
    true,
  );
  assert.equal(
    summaryRelayText.indexOf("[Harness operation dir]") >
      summaryRelayText.indexOf("已完成：完成初始检查"),
    true,
  );
  assert.equal(
    String(agentContext.bindings.extensions.harness.planText || "").trim().length > 0,
    false,
  );

  const result = { output: "done" };
  await hookManager.emit("agent.before_final_output", { agentContext, result });

  assert.equal(
    agentContext.bindings.extensions.harness.lastAcceptanceReport.finalPlanChecklist.length >= 1,
    true,
  );
  assert.equal(
    Number(agentContext.bindings.extensions.harness.lastAcceptanceReport.plan.revisionCount || 0),
    0,
  );
});

test("summary separate_model invocation uses flat structured_v1 messages", async () => {
  const hookManager = createAgentHookManager();
  const invocations = [];
  registerHarnessCore(
    { hookManager },
    {
      trace: false,
      promptPolicy: false,
      planningGuidanceMode: "separate_model",
      resolveModelMessages: ({ purpose = "", messages = [] } = {}) => {
        if (purpose === "summary") {
          return (Array.isArray(messages) ? messages : []).filter((item = {}) =>
            String(item?.content || "").includes("history"),
          );
        }
        if (purpose === "planning_revision") {
          return [{ role: "user", content: "REVISION-ONLY" }];
        }
        return Array.isArray(messages) ? messages : [];
      },
      capabilityModelInvoker: async (payload) => {
        invocations.push(payload);
        if (payload.purpose === "summary") return createTestModelResponse("小结完成");
        return createTestModelResponse("{}");
      },
    },
  );

  const messages = [
    { role: "user", content: "history-user" },
    { role: "assistant", content: "history-assistant" },
    { role: "user", content: "non-history" },
  ];
  const agentContext = {
    bindings: {
      extensions: {
        harness: {
          planText: "1. 初始计划",
          state: {
            flags: { planningCaptured: true, acceptanceRequested: false },
            counters: { llmTurns: 16, consecutiveToolFailures: 0, totalToolFailures: 0 },
            signals: { successfulToolCount: 1 },
            pending: { summary: true, guidance: null },
          },
          logs: { planning: [], guidance: [], acceptance: [], review: [] },
        },
      },
    },
  };

  await hookManager.emit("agent.before_llm_call", {
    messageBlocks: { system: [], history: [], incremental: messages },
    agentContext,
  });

  assert.deepEqual(
    invocations.map((item) => item.purpose),
    ["summary"],
  );
  assert.equal(
    invocations.every((item) => item.promptVersion === "v1"),
    true,
  );
  assert.equal(
    invocations.every((item) => item.envelopeType === "structured_v1"),
    true,
  );
  const summaryMessages = invocations[0].messages;
  assertFlatCapabilityMessages(summaryMessages);
});

test("planning_refinement is scheduled independently after revision main-plan change", async () => {
  const hookManager = createAgentHookManager();
  const invocations = [];
  registerHarnessCore(
    { hookManager },
    {
      trace: false,
      promptPolicy: false,
      planningGuidanceMode: "separate_model",
      resolveModelMessages: new ModelMessageRuntimeHelpers().createResolveModelMessages(),
      capabilityModelInvoker: async (payload) => {
        invocations.push(payload);
        if (payload.purpose === "summary") return createTestModelResponse("小结完成");
        if (payload.purpose === "planning_revision") {
          return createTestModelResponse("1. 修复后的主计划\n2. 新增主任务");
        }
        if (payload.purpose === "planning_refinement") {
          return createTestModelResponse("ADD 1.1 细化修复后的主计划");
        }
        return createTestModelResponse("{}");
      },
    },
  );

  const messages = [
    { role: "user", content: "history-user" },
    { role: "assistant", content: "history-assistant" },
  ];
  const agentContext = {
    bindings: {
      extensions: {
        harness: {
          planText: "1. 初始计划",
          state: {
            flags: { planningCaptured: true, acceptanceRequested: false },
            counters: {
              llmTurns: 16,
              planUpdateTurns: -100,
              consecutiveToolFailures: 0,
              totalToolFailures: 0,
            },
            signals: { successfulToolCount: 1 },
            pending: { summary: true, guidance: null },
          },
          logs: { planning: [], guidance: [], acceptance: [], review: [] },
        },
      },
    },
  };

  await hookManager.emit("agent.before_llm_call", {
    messageBlocks: { system: [], history: [], incremental: messages },
    agentContext,
  });

  assert.deepEqual(
    invocations.map((item = {}) => item.purpose),
    ["summary"],
  );
  assert.equal(agentContext.bindings.extensions.harness.state.pending.planRevision, false);
  assert.equal(agentContext.bindings.extensions.harness.state.pending.planRefinement, false);
});

test("harness summary without completion marker still triggers planning revision", async () => {
  const hookManager = createAgentHookManager();
  const invocations = [];
  registerHarnessCore(
    { hookManager },
    {
      trace: false,
      promptPolicy: false,
      planningGuidanceMode: "separate_model",
      resolveModelMessages: new ModelMessageRuntimeHelpers().createResolveModelMessages(),
      capabilityModelInvoker: async (payload) => {
        invocations.push(payload);
        if (payload.purpose === "summary") {
          return createTestModelResponse("已完成：完成初始检查");
        }
        return createTestModelResponse("{}");
      },
    },
  );

  const messages = [{ role: "user", content: "继续" }];
  const agentContext = {
    bindings: {
      extensions: {
        harness: {
          state: {
            flags: { planningCaptured: true, acceptanceRequested: false },
            counters: { llmTurns: 16, consecutiveToolFailures: 0, totalToolFailures: 0 },
            signals: { successfulToolCount: 1 },
            pending: { summary: true, guidance: null },
          },
          logs: { planning: [], guidance: [], acceptance: [], review: [] },
        },
      },
    },
  };

  await hookManager.emit("agent.before_llm_call", {
    messageBlocks: { system: [], history: [], incremental: messages },
    agentContext,
  });

  assert.deepEqual(
    invocations.map((item) => item.purpose),
    ["summary"],
  );
  assert.equal(
    agentContext.bindings.extensions.harness.logs.guidance.some(
      (item) => item.event === "summary_completion_marker_missing",
    ),
    false,
  );
  assert.equal(
    agentContext.bindings.extensions.harness.logs.planning.some(
      (item) => item.event === "planning_checklist_revised_after_summary",
    ),
    false,
  );
});

test("guidance handler inject mode does not schedule planning revision without captured plan", async () => {
  const handler = createGuidanceHandler({ shouldProcessPrimaryToolHooks: () => true });
  const agentContext = {
    bindings: {
      extensions: {
        harness: {
          totalGoal: "初始目标",
          state: {
            flags: { planningCaptured: true, acceptanceRequested: false },
            counters: { llmTurns: 16, consecutiveToolFailures: 0, totalToolFailures: 0 },
            signals: { successfulToolCount: 1 },
            pending: { summary: true, guidance: null },
          },
          logs: { planning: [], guidance: [], acceptance: [], review: [] },
        },
      },
    },
  };
  const meta = {
    harness: {
      planningGuidanceMode: "inject",
      capabilityModelInvoker: null,
    },
  };

  const firstCtx = {
    messageBlocks: { system: [], history: [], incremental: [{ role: "user", content: "继续" }] },
    agentContext,
  };
  await handler({ capability: "guidance", point: "agent.before_llm_call", ctx: firstCtx, meta });
  assert.equal(
    firstCtx.modelContext.messages.some((msg) =>
      String(msg.content || "").includes("harness-guidance-summary"),
    ),
    true,
  );

  const summaryCtx = {
    messageBlocks: firstCtx.modelContext.messageBlocks,
    modelResponse: { text: "已完成：完成初始检查\n小结完成" },
    calls: [],
    agentContext,
  };
  await handler({ capability: "guidance", point: "agent.after_llm_call", ctx: summaryCtx, meta });
  assert.equal(agentContext.bindings.extensions.harness.state.pending.planRevision, false);
  assert.equal(agentContext.bindings.extensions.harness.state.pending.planRefinement, false);
  assert.equal(
    agentContext.bindings.extensions.harness.logs.planning.some(
      (item) => item.event === "planning_revision_scheduled_by_inject",
    ),
    false,
  );

  const secondCtx = {
    messageBlocks: {
      system: [],
      history: [],
      incremental: [{ role: "user", content: "继续执行" }],
    },
    agentContext,
  };
  await handler({ capability: "guidance", point: "agent.before_llm_call", ctx: secondCtx, meta });
  assert.equal(
    secondCtx.modelContext.messages.some((msg) =>
      String(msg.content || "").includes("harness-planning-revision"),
    ),
    false,
  );

  const revisionCtx = {
    messageBlocks: secondCtx.modelContext.messageBlocks,
    modelResponse: { text: "已完成：完成初始检查" },
    calls: [],
    agentContext,
  };
  await handler({ capability: "guidance", point: "agent.after_llm_call", ctx: revisionCtx, meta });
  assert.equal(agentContext.bindings.extensions.harness.state.pending.planRevision, false);
  assert.equal(agentContext.bindings.extensions.harness.state.pending.planRefinement, false);
  assert.equal(
    agentContext.bindings.extensions.harness.logs.planning.some(
      (item) => item.event === "planning_refinement_converged_no_target_main_step",
    ),
    false,
  );
  assert.equal(
    String(agentContext.bindings.extensions.harness.planText || "").trim().length > 0,
    false,
  );
  assert.equal(
    agentContext.bindings.extensions.harness.logs.planning.some(
      (item) => item.event === "planning_checklist_revised_after_summary",
    ),
    false,
  );
});
