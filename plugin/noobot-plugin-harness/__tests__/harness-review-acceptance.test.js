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

import { createAgentHookManager } from "../../../agent/src/system-core/hook/index.js";
import { registerNoobotPlugin } from "../src/index.js";
import { createAcceptanceHandler } from "../src/capabilities/handlers/acceptance.js";
import { createGuidanceHandler } from "../src/capabilities/handlers/guidance.js";
import { exists, waitForFile, readJsonl } from "./test-helpers.js";

function assertFlatCapabilityMessages(messages = []) {
  assert.equal(Array.isArray(messages), true);
  assert.equal(messages.length >= 1, true);
  const roles = messages.map((item = {}) => String(item?.role || "").trim());
  assert.equal(roles.includes("user"), true);
  const first = messages[0] || {};
  const last = messages[messages.length - 1] || {};
  assert.equal(["system", "user", "assistant", "tool"].includes(String(first.role || "")), true);
  assert.equal(String(last.role || ""), "user");
}

test("harness review generates review report at final output", async () => {
  const hookManager = createAgentHookManager();
  registerNoobotPlugin({ hookManager }, { trace: false, promptPolicy: false });

  const agentContext = {
    payload: {
      messages: { system: [], history: [] },
      harness: {
        taskChecklist: [{ index: 1, task: "执行核心任务", owner: "owner" }],
      },
    },
  };
  const result = { output: "done" };

  await hookManager.emit("before_final_output", {
    userId: "u12",
    sessionId: "s12",
    dialogProcessId: "dp12",
    result,
    agentContext,
  });

  assert.match(String(result.output), /Harness-Review/);
  assert.equal(Array.isArray(agentContext.payload.harness.reviewReports), true);
  assert.equal(agentContext.payload.harness.reviewReports.length, 1);
  assert.equal(agentContext.payload.harness.lastReviewReport.point, "before_final_output");
  assert.equal(
    agentContext.payload.harness.lastReviewReport.summary.issues.includes("planning_not_captured"),
    true,
  );
  assert.equal(
    agentContext.payload.harness.logs.review.some((item = {}) => item?.event === "workflow_priority_decision"),
    true,
  );
  assert.equal(
    agentContext.payload.harness.logs.review.some((item = {}) => item?.event === "workflow_execution_result"),
    true,
  );
  const reviewDecision = agentContext.payload.harness.logs.review.find(
    (item = {}) => item?.event === "workflow_priority_decision",
  );
  assert.match(
    String(reviewDecision?.detail?.chosenReasonLabel || ""),
    /review 报告|review report/i,
  );
});

test("harness before_final_output capability runtime runs once", async () => {
  const hookManager = createAgentHookManager();
  let count = 0;
  registerNoobotPlugin(
    { hookManager },
    {
      trace: false,
      promptPolicy: false,
      capabilityHandlers: {
        acceptance: async ({ point, ctx }) => {
          if (point === "before_final_output") {
            count += 1;
            ctx.result.output = `${ctx.result.output}|acceptance-${count}`;
          }
          return { capability: "acceptance", point, status: "active", changed: true };
        },
        review: async ({ point }) => ({ capability: "review", point, status: "active", changed: false }),
      },
    },
  );

  const result = { output: "done" };
  await hookManager.emit("before_final_output", {
    userId: "u13",
    sessionId: "s13",
    dialogProcessId: "dp13",
    result,
    agentContext: { payload: { messages: { system: [], history: [] }, harness: {} } },
  });

  assert.equal(count, 1);
  assert.match(result.output, /\|acceptance-1$/);
  assert.equal((result.output.match(/acceptance-1/g) || []).length, 1);
});

test("acceptance checklist attachments are bound to final assistant turn output", async () => {
  const handler = createAcceptanceHandler({ shouldProcessPrimaryToolHooks: () => true });
  const records = [
    {
      attachmentId: "att_plan",
      sessionId: "s-attach",
      attachmentSource: "model",
      name: "harness-plan-text.txt",
      mimeType: "text/plain",
      size: 10,
      path: "/tmp/att_plan.txt",
      relativePath: "runtime/attach/att_plan.txt",
      generatedByModel: true,
      generationSource: "harness_checklist",
    },
    {
      attachmentId: "att_report",
      sessionId: "s-attach",
      attachmentSource: "model",
      name: "harness-acceptance-report.txt",
      mimeType: "text/plain",
      size: 10,
      path: "/tmp/att_report.txt",
      relativePath: "runtime/attach/att_report.txt",
      generatedByModel: true,
      generationSource: "harness_checklist",
    },
  ];
  const ctx = {
    userId: "u-attach",
    sessionId: "s-attach",
    result: {
      output: "done",
      turnMessages: [{ role: "assistant", content: "done", type: "message" }],
    },
    agentContext: {
      payload: {
        messages: { system: [], history: [] },
        harness: {
          planText: "1. 保留计划文本",
          state: {
            flags: { acceptanceRequested: true },
          },
        },
      },
      execution: {
        controllers: {
          runtime: {
            attachmentService: {
              ingestGeneratedArtifacts: async () => records,
            },
            systemRuntime: {
              userId: "u-attach",
              sessionId: "s-attach",
            },
          },
        },
      },
    },
  };

  const result = await handler({ capability: "acceptance", point: "before_final_output", ctx, meta: {} });
  assert.equal(result.status, "active");
  const finalAssistant = ctx.result.turnMessages?.[0] || {};
  const transferAttachmentIds = (Array.isArray(finalAssistant.transferEnvelopes)
    ? finalAssistant.transferEnvelopes
    : []
  )
    .flatMap((envelope = {}) => (Array.isArray(envelope.files) ? envelope.files : []))
    .map((file = {}) => String(file?.attachmentMeta?.attachmentId || "").trim())
    .filter(Boolean);
  const legacyAttachmentIds = (Array.isArray(finalAssistant.attachmentMetas)
    ? finalAssistant.attachmentMetas
    : []
  )
    .map((item = {}) => String(item?.attachmentId || "").trim())
    .filter(Boolean);
  const effectiveAttachmentIds = transferAttachmentIds.length
    ? transferAttachmentIds
    : legacyAttachmentIds;
  assert.deepEqual(
    effectiveAttachmentIds.slice().sort(),
    ["att_plan", "att_report"],
  );
  const acceptanceLogs = ctx.agentContext.payload.harness.logs.acceptance;
  assert.equal(
    acceptanceLogs.some((item = {}) => item?.event === "workflow_priority_decision"),
    true,
  );
  assert.equal(
    acceptanceLogs.some((item = {}) => item?.event === "workflow_execution_result"),
    true,
  );
});

test("harness finalResponseGuard false skips final policy injection but keeps review", async () => {
  const hookManager = createAgentHookManager();
  registerNoobotPlugin({ hookManager }, { trace: false, promptPolicy: true, finalResponseGuard: false });

  const result = { output: "done" };
  const agentContext = { payload: { messages: { system: [], history: [] }, harness: {} } };
  await hookManager.emit("before_final_output", {
    userId: "u14",
    sessionId: "s14",
    dialogProcessId: "dp14",
    result,
    agentContext,
  });

  assert.doesNotMatch(String(result.output), /noobot-harness-final-response/);
  assert.match(String(result.output), /Harness-Review/);
});

test("harness promptPolicy false still traces before_llm_call", async () => {
  const basePath = await fs.mkdtemp(path.join(os.tmpdir(), "noobot-harness-"));
  const hookManager = createAgentHookManager();
  registerNoobotPlugin({ hookManager }, { basePath, promptPolicy: false, trace: true });

  await hookManager.emit("before_llm_call", {
    executionScope: "primary",
    userId: "u15",
    sessionId: "s15",
    dialogProcessId: "dp15",
    messages: [{ role: "user", content: "hello" }],
  });

  const eventsFile = path.join(basePath, "runtime", "harness", "runs", "dp15", "events.jsonl");
  assert.equal(await waitForFile(eventsFile), true);
  const events = (await fs.readFile(eventsFile, "utf8")).trim().split("\n").map((line) => JSON.parse(line));
  assert.equal(events.some((event) => event.point === "before_llm_call"), true);
});

test("harness review records reports on error and abort hooks", async () => {
  const hookManager = createAgentHookManager();
  registerNoobotPlugin({ hookManager }, { trace: false, promptPolicy: false });
  const agentContext = { payload: { messages: { system: [], history: [] }, harness: {} } };

  await hookManager.emit("on_error", {
    userId: "u16",
    sessionId: "s16",
    dialogProcessId: "dp16",
    error: new Error("boom"),
    agentContext,
  });
  await hookManager.emit("on_abort", {
    userId: "u16",
    sessionId: "s16",
    dialogProcessId: "dp16",
    agentContext,
  });

  assert.equal(agentContext.payload.harness.reviewReports.length, 2);
  assert.equal(agentContext.payload.harness.reviewReports[0].status, "error");
  assert.equal(agentContext.payload.harness.reviewReports[1].status, "abort");
  assert.equal(
    agentContext.payload.harness.logs.review.filter((item = {}) => item?.event === "review_report_generated").length,
    2,
  );
});

test("harness full engineering capability flow plans, guides, accepts and reviews", async () => {
  const hookManager = createAgentHookManager();
  registerNoobotPlugin({ hookManager }, { trace: false, promptPolicy: false });

  const agentContext = {
    payload: {
      messages: { system: [], history: [] },
      tools: { registry: [] },
      harness: {},
    },
  };
  const messages = [{ role: "user", content: "请处理附件并验收" }];

  await hookManager.emit("before_turn", {
    userId: "flow-user",
    sessionId: "flow-session",
    dialogProcessId: "flow-dp",
    agentContext,
  });

  assert.equal(
    agentContext.payload.tools.registry.some((tool) => tool?.name === "request_task_acceptance"),
    true,
  );

  await hookManager.emit("before_llm_call", {
    userId: "flow-user",
    sessionId: "flow-session",
    dialogProcessId: "flow-dp",
    messages,
    agentContext,
  });
  const planningPromptMessage = messages.find((item = {}) =>
    /harness-planning-bootstrap/.test(String(item?.content || "")),
  );
  assert.equal(String(planningPromptMessage?.role || ""), "system");
  assert.match(String(planningPromptMessage?.content || ""), /harness-planning-bootstrap/);

  await hookManager.emit("after_llm_call", {
    userId: "flow-user",
    sessionId: "flow-session",
    dialogProcessId: "flow-dp",
    ai: {
      content: "1. 解析附件\n2. 执行核心任务",
    },
    agentContext,
  });
  assert.equal(agentContext.payload.harness.state.flags.planningCaptured, true);

  for (let i = 0; i < 3; i += 1) {
    await hookManager.emit("after_tool_call", {
      userId: "flow-user",
      sessionId: "flow-session",
      dialogProcessId: "flow-dp",
      toolName: "call_service",
      call: { name: "call_service" },
      success: false,
      agentContext,
    });
  }
  assert.equal(
    agentContext.payload.harness.state.pending.guidance,
    "consecutive_failures",
  );

  await hookManager.emit("before_llm_call", {
    userId: "flow-user",
    sessionId: "flow-session",
    dialogProcessId: "flow-dp",
    messages,
    agentContext,
  });
  assert.match(String(messages[0]?.content || ""), /harness-guidance/);
  assert.equal(agentContext.payload.harness.state.pending.guidance, null);

  await hookManager.emit("after_tool_call", {
    userId: "flow-user",
    sessionId: "flow-session",
    dialogProcessId: "flow-dp",
    toolName: "doc_to_data",
    call: { name: "doc_to_data" },
    success: true,
    agentContext,
  });
  assert.equal(agentContext.payload.harness.state.signals.parsedAttachment, true);

  const acceptanceTool = agentContext.payload.tools.registry.find(
    (tool) => tool?.name === "request_task_acceptance",
  );
  const acceptanceResult = await acceptanceTool.func({ mode: "active" });
  assert.equal(acceptanceResult.ok, true);
  assert.equal(agentContext.payload.harness.state.flags.acceptanceRequested, true);

  const result = { output: "任务完成" };
  await hookManager.emit("before_final_output", {
    userId: "flow-user",
    sessionId: "flow-session",
    dialogProcessId: "flow-dp",
    result,
    agentContext,
  });

  assert.doesNotMatch(String(result.output), /Harness-Forced-Acceptance/);
  assert.match(String(result.output), /Harness-Review/);
  assert.equal(agentContext.payload.harness.reviewReports.length, 1);
  assert.equal(agentContext.payload.harness.lastReviewReport.summary.planningCaptured, true);
  assert.equal(
    agentContext.payload.harness.lastReviewReport.summary.issues.includes("planning_not_captured"),
    false,
  );
});

test("harness review attachToFinalOutput false keeps report internal", async () => {
  const hookManager = createAgentHookManager();
  registerNoobotPlugin(
    { hookManager },
    { trace: false, promptPolicy: false, review: { attachToFinalOutput: false } },
  );

  const agentContext = { payload: { messages: { system: [], history: [] }, harness: {} } };
  const result = { output: "done" };
  await hookManager.emit("before_final_output", {
    userId: "u17",
    sessionId: "s17",
    dialogProcessId: "dp17",
    result,
    agentContext,
  });

  assert.doesNotMatch(String(result.output), /Harness-Review/);
  assert.match(String(result.output), /Harness-验收/);
  assert.equal(agentContext.payload.harness.reviewReports.length, 1);
  assert.equal(
    agentContext.payload.harness.logs.review.filter((item = {}) => item?.event === "review_report_generated").length,
    1,
  );
});

test("harness resets acceptanceRequested/checklistArtifactsAttached on next turn start", async () => {
  const hookManager = createAgentHookManager();
  registerNoobotPlugin({ hookManager }, { trace: false, promptPolicy: false });

  const agentContext = {
    payload: {
      messages: { system: [], history: [] },
      harness: {
        state: {
          flags: {
            planningCaptured: true,
            acceptanceRequested: true,
            checklistArtifactsAttached: true,
          },
          counters: { llmTurns: 0, consecutiveToolFailures: 0, totalToolFailures: 0 },
          signals: {
            parsedAttachment: false,
            subtaskStarted: false,
            subtaskWaited: false,
            successfulToolCount: 0,
          },
          pending: { guidance: null, summary: false },
        },
        logs: { planning: [], guidance: [], acceptance: [], review: [] },
      },
    },
  };

  await hookManager.emit("before_turn", {
    userId: "u17-reset",
    sessionId: "s17-reset",
    dialogProcessId: "dp17-reset",
    agentContext,
  });

  assert.equal(agentContext.payload.harness.state.flags.acceptanceRequested, false);
  assert.equal(agentContext.payload.harness.state.flags.checklistArtifactsAttached, false);
});

test("harness forced acceptance is owned by acceptance and appended once", async () => {
  const hookManager = createAgentHookManager();
  registerNoobotPlugin({ hookManager }, { trace: false, promptPolicy: false });

  const agentContext = {
    payload: {
      messages: { system: [], history: [] },
      harness: {
        state: {
          flags: { planningCaptured: true, acceptanceRequested: false },
          counters: { llmTurns: 0, consecutiveToolFailures: 0, totalToolFailures: 0 },
          signals: { parsedAttachment: false, subtaskStarted: false, subtaskWaited: false, successfulToolCount: 1 },
          pending: { guidance: null, summary: false },
        },
        logs: { planning: [], guidance: [], acceptance: [], review: [] },
      },
    },
  };
  const result = { output: "done" };

  await hookManager.emit("before_final_output", {
    userId: "u18",
    sessionId: "s18",
    dialogProcessId: "dp18",
    result,
    agentContext,
  });

  assert.equal((String(result.output).match(/\[Harness-验收\]/g) || []).length, 1);
  assert.match(String(result.output), /NOOBOT_HARNESS_COLLAPSE:start[^>]*kind="acceptance"/);
  assert.equal(agentContext.payload.harness.acceptanceReports.length, 1);
  assert.equal(agentContext.payload.harness.logs.acceptance.some((log) => log.event === "forced_acceptance_triggered"), true);
  assert.equal(agentContext.payload.harness.logs.planning.some((log) => log.event === "forced_acceptance_triggered"), false);
});

test("harness acceptance semantic validation uses separate model when enabled", async () => {
  const hookManager = createAgentHookManager();
  const invocations = [];
  registerNoobotPlugin(
    { hookManager },
    {
      trace: false,
      promptPolicy: false,
      acceptance: { semanticValidation: true },
      capabilityModelInvoker: async (payload) => {
        invocations.push(payload);
        return {
          content: JSON.stringify({
            status: "pass",
            consistent: true,
            missingItems: [],
            unsupportedClaims: [],
            checklistCoverage: [
              { index: 1, task: "执行核心任务", covered: true, evidence: "final output", risk: "low" },
            ],
            suggestions: [],
          }),
        };
      },
    },
  );

  const agentContext = {
    payload: {
      messages: { system: [], history: [] },
      harness: {
        taskChecklist: [{ index: 1, task: "执行核心任务", owner: "primary_task_owner" }],
        state: {
          flags: { planningCaptured: true, acceptanceRequested: false },
          counters: { llmTurns: 0, consecutiveToolFailures: 0, totalToolFailures: 0 },
          signals: { parsedAttachment: false, subtaskStarted: false, subtaskWaited: false, successfulToolCount: 1 },
          pending: { guidance: null, summary: false },
        },
        logs: { planning: [], guidance: [], acceptance: [], review: [] },
      },
    },
  };
  const result = { output: "done: 执行核心任务" };

  await hookManager.emit("before_final_output", {
    userId: "u19",
    sessionId: "s19",
    dialogProcessId: "dp19",
    result,
    agentContext,
  });

  assert.equal(invocations.length, 2);
  assert.equal(invocations[0].purpose, "phase_acceptance_before_final");
  assert.equal(invocations[1].purpose, "acceptance_semantic_validation");
  assert.equal(invocations[1].promptVersion, "v1");
  assert.equal(invocations[1].envelopeType, "structured_v1");
  assertFlatCapabilityMessages(invocations[1].messages);
  assert.equal(Array.isArray(agentContext.payload.harness.phaseAcceptanceReports), true);
  assert.equal(agentContext.payload.harness.phaseAcceptanceReports.length, 1);
  assert.equal(agentContext.payload.harness.lastAcceptanceReport.semanticValidation.status, "pass");
  assert.equal(agentContext.payload.harness.lastAcceptanceReport.semanticValidation.consistent, true);
  assert.match(String(result.output), /"semanticValidation"/);
  assert.equal(agentContext.payload.harness.logs.acceptance.some((log) => log.event === "acceptance_semantic_validation_completed"), true);
});

test("acceptance semantic validation relays via unified ctx.messages protocol", async () => {
  const handler = createAcceptanceHandler({ shouldProcessPrimaryToolHooks: () => true });
  const modelMessages = [{ role: "assistant", content: "任务完成", type: "message" }];
  const ctx = {
    userId: "relay-u",
    sessionId: "relay-s",
    dialogProcessId: "relay-dp",
    messages: modelMessages,
    result: {
      output: "任务完成",
      modelMessages,
      turnMessages: [{ role: "assistant", content: "任务完成", type: "message" }],
    },
    agentContext: {
      payload: {
        messages: { system: [], history: [] },
        harness: {
          planText: "1. 核对输出",
          state: {
            flags: { planningCaptured: true, acceptanceRequested: false },
            counters: {},
            signals: {},
            pending: {},
          },
          logs: { planning: [], guidance: [], acceptance: [], review: [] },
        },
      },
      execution: {
        controllers: {
          runtime: {
            systemRuntime: { userId: "relay-u", sessionId: "relay-s" },
          },
        },
      },
    },
  };
  const meta = {
    harness: {
      planningGuidanceMode: "separate_model",
      acceptance: { semanticValidation: true },
      capabilityModelInvoker: async ({ purpose }) => {
        if (purpose === "acceptance_semantic_validation") {
          return { content: "ADD 1 验收通过，输出与计划一致" };
        }
        return { content: "" };
      },
    },
  };

  const res = await handler({ capability: "acceptance", point: "before_final_output", ctx, meta });
  assert.equal(res.status, "active");
  assert.equal(Array.isArray(ctx.messages), true);
  assert.equal(
    ctx.messages.some(
      (item = {}) =>
        item.injectedMessage === true &&
        String(item.injectedBy || "") === "harness-plugin" &&
        String(item.role || "") === "system" &&
        String(item.content || "").includes("acceptance_semantic_validation"),
    ),
    true,
  );
});

test("phase acceptance injects context, revised plan checklist, then phase request", async () => {
  const handler = createAcceptanceHandler({ shouldProcessPrimaryToolHooks: () => true });
  const ctx = {
    messages: [{ role: "user", content: "阶段上下文：已完成核心实现" }],
    agentContext: {
      payload: {
        messages: { system: [], history: [] },
        harness: {
          planText: "1. 核心实现\n2. 验证交付",
          state: {
            flags: { planningCaptured: true },
            counters: {},
            signals: {},
            pending: { phaseAcceptance: true },
          },
          logs: { planning: [], guidance: [], acceptance: [], review: [] },
        },
      },
    },
  };

  const before = await handler({
    capability: "acceptance",
    point: "before_llm_call",
    ctx,
    meta: { harness: { planningGuidanceMode: "inject" } },
  });

  assert.equal(before.changed, true);
  const planContextIndex = ctx.messages.findIndex((item = {}) =>
    /harness-acceptance-main-plan/.test(String(item?.content || "")),
  );
  const requestIndex = ctx.messages.findIndex((item = {}) =>
    /harness-phase-acceptance-request/.test(String(item?.content || "")),
  );
  const responsibilityIndex = ctx.messages.findIndex((item = {}) =>
    /职责约束：你当前仅负责「阶段验收」/.test(String(item?.content || "")),
  );
  assert.equal(ctx.messages[planContextIndex].role, "system");
  assert.match(String(ctx.messages[planContextIndex].content), /计划清单上下文|Plan checklist context/);
  assert.match(String(ctx.messages[planContextIndex].content), /核心实现/);
  assert.equal(ctx.messages[planContextIndex].injectedMessage, true);
  assert.equal(ctx.messages[planContextIndex].injectedBy, "harness-plugin");
  assert.equal(ctx.messages[requestIndex].role, "user");
  assert.match(String(ctx.messages[requestIndex].content), /acceptance_patch_v1/);
  assert.match(String(ctx.messages[requestIndex].content), /ADD A\[验收ID\] plan=计划ID status=\[pass\|warn\|fail\]/);
  assert.match(String(ctx.messages[requestIndex].content), /evidence=\[简短证据\]/);
  assert.equal(ctx.messages[requestIndex].injectedMessage, true);
  assert.equal(ctx.messages[requestIndex].injectedBy, "harness-plugin");
  assert.equal(
    planContextIndex > -1 && requestIndex > planContextIndex && responsibilityIndex > requestIndex,
    true,
  );
  assert.equal(ctx.agentContext.payload.harness.state.pending.phaseAcceptance, false);
  assert.equal(ctx.agentContext.payload.harness.state.flags.phaseAcceptanceCapturePending, true);

  const after = await handler({
    capability: "acceptance",
    point: "after_llm_call",
    ctx: { ...ctx, ai: { content: "阶段验收：pass" } },
    meta: { harness: { planningGuidanceMode: "inject" } },
  });
  assert.equal(after.changed, true);
  assert.equal(ctx.agentContext.payload.harness.phaseAcceptanceReports.length, 1);
  assert.match(ctx.agentContext.payload.harness.phaseAcceptanceReports[0].content, /pass/);
});

test("phase acceptance separate model receives context, summaries, revised plan, phase checklists, then phase request", async () => {
  const handler = createAcceptanceHandler({ shouldProcessPrimaryToolHooks: () => true });
  const invocations = [];
  const ctx = {
    messages: [{ role: "user", content: "阶段上下文：继续审查" }],
    agentContext: {
      payload: {
        messages: { system: [], history: [] },
        harness: {
          planText: "1. 核心实现\n1.1 子任务A\n2. 验证交付",
          summaryText: "1. 已完成基础结构审查\n2. 正在补齐验收流程",
          phaseAcceptanceReports: [
            { acceptedAt: "2026-05-27T00:00:00.000Z", content: "阶段验收清单一：warn" },
          ],
          state: {
            flags: { planningCaptured: true },
            counters: {},
            signals: {},
            pending: { phaseAcceptance: true },
          },
          logs: { planning: [], guidance: [], acceptance: [], review: [] },
        },
      },
    },
  };

  await handler({
    capability: "acceptance",
    point: "before_llm_call",
    ctx,
    meta: {
      harness: {
        planningGuidanceMode: "separate_model",
        capabilityModelInvoker: async (payload) => {
          invocations.push(payload);
          return { content: "ADD A1 plan=1.1 status=pass risk=low evidence=[ok] [阶段通过]" };
        },
      },
    },
  });

  assert.equal(invocations.length, 1);
  const messages = invocations[0].messages;
  assert.equal(Array.isArray(messages), true);
  const summaryIndexes = messages
    .map((item = {}, index) =>
      String(item.content || "").includes("harness-summary-reports") ? index : -1)
    .filter((index) => index >= 0);
  const planIndex = messages.findIndex((item = {}) => String(item.content || "").includes("harness-acceptance-main-plan"));
  const phaseIndexes = messages
    .map((item = {}, index) =>
      String(item.content || "").includes("harness-phase-acceptance-reports") ? index : -1)
    .filter((index) => index >= 0);
  const requestIndex = messages.findIndex((item = {}) => String(item.content || "").includes("harness-phase-acceptance-request"));
  assert.equal(summaryIndexes.length, 2);
  assert.equal(messages[summaryIndexes[0]].role, "system");
  assert.equal(messages[summaryIndexes[1]].role, "system");
  assert.equal(messages[planIndex].role, "system");
  assert.equal(messages[phaseIndexes[0]].role, "system");
  assert.equal(messages[requestIndex].role, "user");
  assert.equal(
    summaryIndexes[0] > 0 &&
      summaryIndexes[1] > summaryIndexes[0] &&
      planIndex > summaryIndexes[1] &&
      phaseIndexes[0] > planIndex &&
      requestIndex > phaseIndexes[0],
    true,
  );
});

test("final acceptance separate model receives revised plan, all phase checklists, then final request", async () => {
  const handler = createAcceptanceHandler({ shouldProcessPrimaryToolHooks: () => true });
  const invocations = [];
  const ctx = {
    messages: [{ role: "assistant", content: "最终输出：done" }],
    result: { output: "最终输出：done" },
    agentContext: {
      payload: {
        messages: { system: [], history: [] },
        harness: {
          planText: "1. 核心实现\n2. 验证交付",
          phaseAcceptanceReports: [
            { acceptedAt: "2026-05-27T00:00:00.000Z", content: "阶段验收清单一：pass" },
            { acceptedAt: "2026-05-27T00:10:00.000Z", content: "阶段验收清单二：warn" },
          ],
          taskChecklist: [{ index: 1, task: "核心实现" }],
          state: {
            flags: { planningCaptured: true, acceptanceRequested: false },
            counters: {},
            signals: { successfulToolCount: 1 },
            pending: {},
          },
          logs: { planning: [], guidance: [], acceptance: [], review: [] },
        },
      },
    },
  };

  await handler({
    capability: "acceptance",
    point: "before_final_output",
    ctx,
    meta: {
      harness: {
        planningGuidanceMode: "separate_model",
        acceptance: { semanticValidation: true },
        capabilityModelInvoker: async (payload) => {
          invocations.push(payload);
          return { content: "ADD A1 plan=1 status=pass 总体验收通过" };
        },
      },
    },
  });

  assert.equal(invocations.length, 2);
  const semanticInvocation = invocations.find((item = {}) => item.purpose === "acceptance_semantic_validation");
  assert.equal(Boolean(semanticInvocation), true);
  const messages = semanticInvocation.messages;
  assert.equal(Array.isArray(messages), true);
  assert.equal(messages.length >= 4, true);
  const planIndex = messages.findIndex((item = {}) => String(item.content || "").includes("harness-acceptance-main-plan"));
  const phaseIndexes = messages
    .map((item = {}, index) =>
      String(item.content || "").includes("harness-phase-acceptance-reports") ? index : -1)
    .filter((index) => index >= 0);
  const requestIndex = messages.findIndex((item = {}) => String(item.content || "").includes("harness-acceptance-semantic-validation"));
  assert.equal(messages[planIndex].role, "system");
  assert.equal(phaseIndexes.length >= 2, true);
  assert.equal(messages[phaseIndexes[0]].role, "system");
  assert.equal(messages[phaseIndexes[1]].role, "system");
  assert.equal(messages[requestIndex].role, "user");
  assert.equal(
    planIndex > -1 &&
      phaseIndexes[0] > planIndex &&
      phaseIndexes[1] > phaseIndexes[0] &&
      requestIndex > phaseIndexes[1],
    true,
  );
  assert.match(String(messages[phaseIndexes[0]].content), /阶段验收清单一/);
  assert.match(String(messages[phaseIndexes[1]].content), /阶段验收清单二/);
  assert.match(String(messages[requestIndex].content), /acceptance_patch_v1/);
  assert.match(String(messages[requestIndex].content), /ADD A\[验收ID\] plan=计划ID status=\[pass\|warn\|fail\]/);
  assert.match(String(messages[requestIndex].content), /risk=\[low\|medium\|high\]/);
});

test("harness active request_task_acceptance semantic validation receives agent ctx via tool config", async () => {
  const hookManager = createAgentHookManager();
  const invocations = [];
  registerNoobotPlugin(
    { hookManager },
    {
      trace: false,
      promptPolicy: false,
      acceptance: { semanticValidation: true },
      capabilityModelInvoker: async (payload) => {
        invocations.push(payload);
        return { content: JSON.stringify({ status: "pass", consistent: true, checklistCoverage: [], missingItems: [], unsupportedClaims: [], suggestions: [] }) };
      },
    },
  );
  const agentContext = {
    payload: {
      tools: { registry: [] },
      harness: {
        taskChecklist: [{ index: 1, task: "执行核心任务" }],
        state: {
          flags: {},
          counters: {},
          signals: { successfulToolCount: 1 },
          pending: {},
        },
        logs: { planning: [], guidance: [], acceptance: [], review: [] },
      },
    },
  };
  await hookManager.emit("before_turn", { agentContext });
  const tool = agentContext.payload.tools.registry.find((item) => item.name === "request_task_acceptance");
  const raw = await tool.invoke({ mode: "active" }, { configurable: { noobotHookContext: { agentContext, result: { output: "done" } }, noobotHookMeta: hookManager.runtime } });
  const result = typeof raw === "string" ? JSON.parse(raw) : raw;
  assert.equal(invocations.length, 2);
  assert.equal(invocations[0].purpose, "phase_acceptance");
  assert.equal(invocations[1].purpose, "acceptance_semantic_validation");
  assert.equal(invocations[1].promptVersion, "v1");
  assert.equal(invocations[1].envelopeType, "structured_v1");
  assertFlatCapabilityMessages(invocations[1].messages);
  assert.equal(result.phaseAcceptanceTriggered, true);
  assert.equal(result.report.semanticValidation.status, "pass");
  assert.equal(agentContext.payload.harness.lastAcceptanceReport.semanticValidation.consistent, true);
});

test("harness active request_task_acceptance falls back to closure meta when configurable meta lacks harness", async () => {
  const hookManager = createAgentHookManager();
  const invocations = [];
  registerNoobotPlugin(
    { hookManager },
    {
      trace: false,
      promptPolicy: false,
      acceptance: { semanticValidation: true },
      capabilityModelInvoker: async (payload) => {
        invocations.push(payload);
        return {
          content: JSON.stringify({
            status: "pass",
            consistent: true,
            checklistCoverage: [],
            missingItems: [],
            unsupportedClaims: [],
            suggestions: [],
          }),
        };
      },
    },
  );
  const agentContext = {
    payload: {
      tools: { registry: [] },
      harness: {
        taskChecklist: [{ index: 1, task: "执行核心任务" }],
        state: {
          flags: {},
          counters: {},
          signals: { successfulToolCount: 1 },
          pending: {},
        },
        logs: { planning: [], guidance: [], acceptance: [], review: [] },
      },
    },
  };
  await hookManager.emit("before_turn", { agentContext });
  const tool = agentContext.payload.tools.registry.find((item) => item.name === "request_task_acceptance");
  const raw = await tool.invoke(
    { mode: "active" },
    {
      configurable: {
        noobotHookContext: { agentContext, result: { output: "done" } },
        noobotHookMeta: { systemRuntime: { userId: "u1", sessionId: "s1" } },
      },
    },
  );
  const result = typeof raw === "string" ? JSON.parse(raw) : raw;
  assert.equal(invocations.length, 2);
  assert.equal(invocations[0].purpose, "phase_acceptance");
  assert.equal(invocations[1].purpose, "acceptance_semantic_validation");
  assert.equal(result.phaseAcceptanceTriggered, true);
  assert.equal(result.report.semanticValidation.status, "pass");
});

test("harness acceptance semantic validation failure does not block active acceptance", async () => {
  const hookManager = createAgentHookManager();
  registerNoobotPlugin(
    { hookManager },
    {
      trace: false,
      promptPolicy: false,
      acceptance: { semanticValidation: true },
      capabilityModelInvoker: async () => {
        throw new Error("semantic model unavailable");
      },
    },
  );
  const agentContext = {
    payload: {
      tools: { registry: [] },
      harness: {
        taskChecklist: [{ index: 1, task: "执行核心任务" }],
        state: {
          flags: {},
          counters: {},
          signals: { successfulToolCount: 1 },
          pending: {},
        },
        logs: { planning: [], guidance: [], acceptance: [], review: [] },
      },
    },
  };

  await hookManager.emit("before_turn", { agentContext });
  const tool = agentContext.payload.tools.registry.find((item) => item.name === "request_task_acceptance");
  const raw = await tool.invoke(
    { mode: "active" },
    { configurable: { noobotHookContext: { agentContext, result: { output: "done" } }, noobotHookMeta: hookManager.runtime } },
  );
  const result = typeof raw === "string" ? JSON.parse(raw) : raw;

  assert.equal(result.ok, true);
  assert.equal(result.phaseAcceptanceTriggered, false);
  assert.equal(result.report.semanticValidation, undefined);
  assert.equal(agentContext.payload.harness.logs.acceptance.some((log) => log.event === "phase_acceptance_failed"), true);
  assert.equal(agentContext.payload.harness.logs.acceptance.some((log) => log.event === "acceptance_semantic_validation_failed"), true);
});

test("acceptance handler inject mode schedules and captures semantic validation without invoker", async () => {
  const handler = createAcceptanceHandler({ shouldProcessPrimaryToolHooks: () => true });
  const agentContext = {
    payload: {
      messages: { system: [], history: [] },
      harness: {
        taskChecklist: [
          {
            index: 1,
            task: "执行核心任务",
            owner: "primary_task_owner",
            input: "需求",
            output: "结果",
            files: { create: [], modify: ["src/a.js"], delete: [] },
          },
        ],
        state: {
          flags: { planningCaptured: true, acceptanceRequested: false },
          counters: { llmTurns: 0, consecutiveToolFailures: 0, totalToolFailures: 0 },
          signals: { successfulToolCount: 1 },
          pending: { guidance: null, summary: false },
        },
        logs: { planning: [], guidance: [], acceptance: [], review: [] },
      },
    },
  };
  const meta = {
    harness: {
      planningGuidanceMode: "inject",
      capabilityModelInvoker: null,
      acceptance: { semanticValidation: true },
    },
  };

  const finalCtx = { agentContext, result: { output: "done" } };
  await handler({ capability: "acceptance", point: "before_final_output", ctx: finalCtx, meta });
  assert.equal(
    agentContext.payload.harness.logs.acceptance.some(
      (item) => item.event === "acceptance_semantic_validation_scheduled_by_inject",
    ),
    true,
  );

  const injectCtx = { agentContext, messages: [{ role: "user", content: "continue" }] };
  await handler({ capability: "acceptance", point: "before_llm_call", ctx: injectCtx, meta });
  assert.equal(
    injectCtx.messages.some((item) =>
      String(item?.content || "").includes("harness-acceptance-semantic-validation"),
    ),
    true,
  );

  const captureCtx = {
    agentContext,
    ai: {
      content: JSON.stringify({
        status: "pass",
        consistent: true,
        missingItems: [],
        unsupportedClaims: [],
        checklistCoverage: [{ index: 1, task: "执行核心任务", covered: true, evidence: "done", risk: "low" }],
        suggestions: [],
      }),
    },
  };
  await handler({ capability: "acceptance", point: "after_llm_call", ctx: captureCtx, meta });
  assert.equal(agentContext.payload.harness.lastAcceptanceReport.semanticValidation.status, "pass");
  assert.equal(agentContext.payload.harness.lastAcceptanceReport.semanticValidation.consistent, true);
  assert.equal(
    agentContext.payload.harness.logs.acceptance.some(
      (item) => item.event === "acceptance_semantic_validation_completed_inject",
    ),
    true,
  );
});

test("harness review reports failed or inconsistent semantic acceptance", async () => {
  const hookManager = createAgentHookManager();
  registerNoobotPlugin({ hookManager }, { trace: false, promptPolicy: false });
  const agentContext = {
    payload: {
      messages: { system: [], history: [] },
      harness: {
        lastAcceptanceReport: {
          mode: "active",
          summary: { total: 1, completed: 1, inProgress: 0, pending: 0 },
          taskChecklist: [{ index: 1, task: "执行核心任务", status: "completed" }],
          semanticValidation: { status: "fail", consistent: false, missingItems: ["执行核心任务"] },
        },
        state: {
          flags: { planningCaptured: true, acceptanceRequested: true },
          counters: { llmTurns: 0, consecutiveToolFailures: 0, totalToolFailures: 0 },
          signals: { successfulToolCount: 1 },
          pending: {},
        },
        logs: { planning: [], guidance: [], acceptance: [], review: [] },
      },
    },
  };
  const result = { output: "done" };

  await hookManager.emit("before_final_output", { agentContext, result });

  const report = agentContext.payload.harness.lastReviewReport;
  assert.equal(report.summary.semanticValidationStatus, null);
  assert.equal(report.summary.semanticValidationConsistent, null);
  assert.equal(report.summary.issues.includes("acceptance_semantic_validation_failed_or_inconsistent"), false);
});


test("harness summary triggers complete revised plan and acceptance uses latest checklist", async () => {
  const hookManager = createAgentHookManager();
  const invocations = [];
  registerNoobotPlugin(
    { hookManager },
    {
      trace: false,
      promptPolicy: false,
      planningGuidanceMode: "separate_model",
      capabilityModelInvoker: async (payload) => {
        invocations.push(payload);
        if (payload.purpose === "summary") {
          return { content: "已完成：完成初始检查\n小结完成" };
        }
        if (payload.purpose === "planning_refinement") {
          return {
            content: JSON.stringify({
              totalGoal: "完成 harness 计划闭环",
              taskOwner: "primary_task_owner",
              nextPhase: { objective: "实现验收闭环", checklistIndexes: [2] },
              taskChecklist: [
                {
                  index: 1,
                  task: "完成初始检查",
                  owner: "primary_task_owner",
                  input: "用户请求",
                  output: "检查结果",
                  files: { create: [], modify: ["src/a.js"], delete: [] },
                },
                {
                  index: 2,
                  task: "实现验收闭环",
                  owner: "primary_task_owner",
                  input: "阶段小结和当前计划",
                  output: "最终计划清单验收结果",
                  files: { create: ["reports/acceptance.json"], modify: [], delete: [] },
                },
              ],
            }),
          };
        }
        if (payload.purpose === "planning_revision") {
          return {
            content: JSON.stringify({
              totalGoal: "完成 harness 计划闭环",
              taskOwner: "primary_task_owner",
              nextPhase: { objective: "实现验收闭环", checklistIndexes: [2] },
              taskChecklist: [
                {
                  index: 1,
                  task: "完成初始检查",
                  owner: "primary_task_owner",
                  input: "用户请求",
                  output: "检查结果",
                  files: { create: [], modify: ["src/a.js"], delete: [] },
                },
                {
                  index: 2,
                  task: "实现验收闭环",
                  owner: "primary_task_owner",
                  input: "阶段小结和当前计划",
                  output: "最终计划清单验收结果",
                  files: { create: ["reports/acceptance.json"], modify: [], delete: [] },
                },
              ],
            }),
          };
        }
        return { content: "{}" };
      },
    },
  );

  const basePath = await fs.mkdtemp(path.join(os.tmpdir(), "noobot-summary-opdir-"));
  const messages = [{ role: "user", content: "继续" }];
  const agentContext = {
    payload: {
      messages: { system: [], history: [] },
      harness: {
        taskChecklist: [{ index: 1, task: "完成初始检查", owner: "primary_task_owner" }],
        state: {
          flags: { planningCaptured: true, acceptanceRequested: false },
          counters: { llmTurns: 16, planUpdateTurns: -100, consecutiveToolFailures: 0, totalToolFailures: 0 },
          signals: { successfulToolCount: 1 },
          pending: { summary: true, guidance: null },
        },
        logs: { planning: [], guidance: [], acceptance: [], review: [] },
      },
    },
    execution: {
      controllers: {
        runtime: {
          basePath,
          userId: "summary-user",
          globalConfig: { tools: { execute_script: { sandboxMode: false } } },
          systemRuntime: { userId: "summary-user", sessionId: "summary-session" },
        },
      },
    },
  };

  await hookManager.emit("before_llm_call", { messages, agentContext });

  assert.deepEqual(invocations.map((item) => item.purpose), ["summary"]);
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
    summaryRelayText.indexOf("[Harness operation dir]") > summaryRelayText.indexOf("已完成：完成初始检查"),
    true,
  );
  assert.equal(String(agentContext.payload.harness.planText || "").trim().length > 0, false);

  const result = { output: "done" };
  await hookManager.emit("before_final_output", { agentContext, result });

  assert.equal(agentContext.payload.harness.lastAcceptanceReport.finalPlanChecklist.length >= 1, true);
  assert.equal(Number(agentContext.payload.harness.lastAcceptanceReport.plan.revisionCount || 0), 0);
});

test("planning_revision reuses summary model messages in separate_model flow", async () => {
  const hookManager = createAgentHookManager();
  const invocations = [];
  registerNoobotPlugin(
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
        if (payload.purpose === "summary") return { content: "小结完成" };
        if (payload.purpose === "planning_refinement") {
          return {
            content: JSON.stringify({
              totalGoal: "完成计划细化",
              taskOwner: "primary_task_owner",
              taskChecklist: [
                {
                  index: 1,
                  task: "细化计划",
                  owner: "primary_task_owner",
                  input: "阶段小结和历史执行",
                  output: "细化后的执行清单",
                  files: { create: [], modify: ["src/capabilities/handlers/guidance.js"], delete: [] },
                },
              ],
            }),
          };
        }
        if (payload.purpose === "planning_revision") {
          return {
            content: JSON.stringify({
              totalGoal: "完成计划修复",
              taskOwner: "primary_task_owner",
              taskChecklist: [
                {
                  index: 1,
                  task: "修复计划",
                  owner: "primary_task_owner",
                  input: "阶段小结和历史执行",
                  output: "更新后的计划清单",
                  files: { create: [], modify: ["src/capabilities/handlers/guidance.js"], delete: [] },
                },
              ],
            }),
          };
        }
        return { content: "{}" };
      },
    },
  );

  const messages = [
    { role: "user", content: "history-user" },
    { role: "assistant", content: "history-assistant" },
    { role: "user", content: "non-history" },
  ];
  const agentContext = {
    payload: {
      messages: { system: [], history: [] },
      harness: {
        planText: "1. 初始计划",
        taskChecklist: [{ index: 1, task: "初始计划", owner: "primary_task_owner" }],
        state: {
          flags: { planningCaptured: true, acceptanceRequested: false },
          counters: { llmTurns: 16, consecutiveToolFailures: 0, totalToolFailures: 0 },
          signals: { successfulToolCount: 1 },
          pending: { summary: true, guidance: null },
        },
        logs: { planning: [], guidance: [], acceptance: [], review: [] },
      },
    },
  };

  await hookManager.emit("before_llm_call", { messages, agentContext });

  assert.deepEqual(invocations.map((item) => item.purpose), ["summary"]);
  assert.equal(invocations.every((item) => item.promptVersion === "v1"), true);
  assert.equal(invocations.every((item) => item.envelopeType === "structured_v1"), true);
  const summaryMessages = invocations[0].messages;
  assertFlatCapabilityMessages(summaryMessages);
});

test("planning_refinement is scheduled independently after revision main-plan change", async () => {
  const hookManager = createAgentHookManager();
  const invocations = [];
  registerNoobotPlugin(
    { hookManager },
    {
      trace: false,
      promptPolicy: false,
      planningGuidanceMode: "separate_model",
      capabilityModelInvoker: async (payload) => {
        invocations.push(payload);
        if (payload.purpose === "summary") return { content: "小结完成" };
        if (payload.purpose === "planning_revision") {
          return { content: "1. 修复后的主计划\n2. 新增主任务" };
        }
        if (payload.purpose === "planning_refinement") {
          return { content: "ADD 1.1 细化修复后的主计划" };
        }
        return { content: "{}" };
      },
    },
  );

  const messages = [
    { role: "user", content: "history-user" },
    { role: "assistant", content: "history-assistant" },
  ];
  const agentContext = {
    payload: {
      messages: { system: [], history: [] },
      harness: {
        planText: "1. 初始计划",
        taskChecklist: [{ index: 1, task: "初始计划", owner: "primary_task_owner" }],
        state: {
          flags: { planningCaptured: true, acceptanceRequested: false },
          counters: { llmTurns: 16, planUpdateTurns: -100, consecutiveToolFailures: 0, totalToolFailures: 0 },
          signals: { successfulToolCount: 1 },
          pending: { summary: true, guidance: null },
        },
        logs: { planning: [], guidance: [], acceptance: [], review: [] },
      },
    },
  };

  await hookManager.emit("before_llm_call", { messages, agentContext });

  assert.deepEqual(invocations.map((item = {}) => item.purpose), ["summary"]);
  assert.equal(agentContext.payload.harness.state.pending.planRevision, false);
  assert.equal(agentContext.payload.harness.state.pending.planRefinement, false);
});

test("harness summary without completion marker still triggers planning revision", async () => {
  const hookManager = createAgentHookManager();
  const invocations = [];
  registerNoobotPlugin(
    { hookManager },
    {
      trace: false,
      promptPolicy: false,
      planningGuidanceMode: "separate_model",
      capabilityModelInvoker: async (payload) => {
        invocations.push(payload);
        if (payload.purpose === "summary") {
          return { content: "已完成：完成初始检查" };
        }
        return { content: "{}" };
      },
    },
  );

  const messages = [{ role: "user", content: "继续" }];
  const agentContext = {
    payload: {
      messages: { system: [], history: [] },
      harness: {
        taskChecklist: [{ index: 1, task: "完成初始检查", owner: "primary_task_owner" }],
        state: {
          flags: { planningCaptured: true, acceptanceRequested: false },
          counters: { llmTurns: 16, consecutiveToolFailures: 0, totalToolFailures: 0 },
          signals: { successfulToolCount: 1 },
          pending: { summary: true, guidance: null },
        },
        logs: { planning: [], guidance: [], acceptance: [], review: [] },
      },
    },
  };

  await hookManager.emit("before_llm_call", { messages, agentContext });

  assert.deepEqual(invocations.map((item) => item.purpose), ["summary"]);
  assert.equal(
    agentContext.payload.harness.logs.guidance.some((item) => item.event === "summary_completion_marker_missing"),
    false,
  );
  assert.equal(agentContext.payload.harness.logs.planning.some((item) => item.event === "planning_checklist_revised_after_summary"), false);
});

test("guidance handler inject mode can schedule and capture planning revision without invoker", async () => {
  const handler = createGuidanceHandler({ shouldProcessPrimaryToolHooks: () => true });
  const agentContext = {
    payload: {
      messages: { system: [], history: [] },
      harness: {
        totalGoal: "初始目标",
        taskChecklist: [
          {
            index: 1,
            task: "完成初始检查",
            owner: "primary_task_owner",
            input: "用户请求",
            output: "检查结果",
            files: { create: [], modify: [], delete: [] },
          },
        ],
        state: {
          flags: { planningCaptured: true, acceptanceRequested: false },
          counters: { llmTurns: 16, consecutiveToolFailures: 0, totalToolFailures: 0 },
          signals: { successfulToolCount: 1 },
          pending: { summary: true, guidance: null },
        },
        logs: { planning: [], guidance: [], acceptance: [], review: [] },
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
    messages: [{ role: "user", content: "继续" }],
    agentContext,
  };
  await handler({ capability: "guidance", point: "before_llm_call", ctx: firstCtx, meta });
  assert.equal(
    firstCtx.messages.some((msg) => String(msg.content || "").includes("harness-guidance-summary")),
    true,
  );

  const summaryCtx = {
    messages: firstCtx.messages,
    ai: { content: "已完成：完成初始检查\n小结完成" },
    agentContext,
  };
  await handler({ capability: "guidance", point: "after_llm_call", ctx: summaryCtx, meta });
  assert.equal(agentContext.payload.harness.state.pending.planRevision, false);
  assert.equal(agentContext.payload.harness.state.pending.planRefinement, false);
  assert.equal(
    agentContext.payload.harness.logs.planning.some((item) => item.event === "planning_revision_scheduled_by_inject"),
    false,
  );

  const secondCtx = {
    messages: [{ role: "user", content: "继续执行" }],
    agentContext,
  };
  await handler({ capability: "guidance", point: "before_llm_call", ctx: secondCtx, meta });
  assert.equal(
    secondCtx.messages.some((msg) => String(msg.content || "").includes("harness-planning-revision")),
    false,
  );

  const revisionCtx = {
    messages: secondCtx.messages,
    ai: {
      content: JSON.stringify({
        totalGoal: "完成 inject 模式计划闭环",
        taskOwner: "primary_task_owner",
        nextPhase: { objective: "完成最终验收", checklistIndexes: [2] },
        taskChecklist: [
          {
            index: 1,
            task: "完成初始检查",
            owner: "primary_task_owner",
            input: "用户请求",
            output: "检查结果",
            files: { create: [], modify: ["src/a.js"], delete: [] },
          },
          {
            index: 2,
            task: "完成最终验收",
            owner: "primary_task_owner",
            input: "修正后的计划清单",
            output: "验收报告",
            files: { create: ["reports/acceptance.json"], modify: [], delete: [] },
          },
        ],
      }),
    },
    agentContext,
  };
  await handler({ capability: "guidance", point: "after_llm_call", ctx: revisionCtx, meta });
  assert.equal(agentContext.payload.harness.state.pending.planRevision, false);
  assert.equal(agentContext.payload.harness.state.pending.planRefinement, false);
  assert.equal(
    agentContext.payload.harness.logs.planning.some((item) => item.event === "planning_refinement_converged_no_target_main_step"),
    false,
  );
  assert.equal(String(agentContext.payload.harness.planText || "").trim().length > 0, false);
  assert.equal(
    agentContext.payload.harness.logs.planning.some((item) => item.event === "planning_checklist_revised_after_summary"),
    false,
  );
});
