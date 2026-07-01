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
import { ModelMessageRuntimeHelpers } from "../../../agent/src/system-core/bot-manage/session/model-message-runtime-helpers.js";
import { registerNoobotPlugin } from "../src/index.js";
import { createAcceptanceHandler } from "../src/capabilities/handlers/acceptance.js";
import { createGuidanceHandler } from "../src/capabilities/handlers/guidance.js";
import { markGuidanceSummarizedMessages } from "../src/capabilities/handlers/guidance/signal-tracker.js";
import { exists, waitForFile, readJsonl } from "./test-helpers.js";

function assertFlatCapabilityMessages(messages = []) {
  assert.equal(Array.isArray(messages), true);
  assert.equal(messages.length >= 1, true);
  const roles = messages.map((item = {}) => String(item?.role || "").trim());
  assert.equal(roles.every((role) => ["system", "user", "assistant", "tool"].includes(role)), true);
  const first = messages[0] || {};
  const last = messages[messages.length - 1] || {};
  assert.equal(["system", "user", "assistant", "tool"].includes(String(first.role || "")), true);
  assert.equal(["system", "user", "assistant", "tool"].includes(String(last.role || "")), true);
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
              ingestGeneratedArtifacts: async (payload = {}) => {
                assert.equal(payload.owner?.type, "plugin");
                assert.equal(payload.owner?.id, "harness-plugin");
                return records.map((record) => ({
                  ...record,
                  owner: payload.owner,
                }));
              },
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
  assert.deepEqual(
    transferAttachmentIds.slice().sort(),
    ["att_plan", "att_report"],
  );
  const transferAttachmentOwners = (Array.isArray(finalAssistant.transferEnvelopes)
    ? finalAssistant.transferEnvelopes
    : []
  )
    .flatMap((envelope = {}) => (Array.isArray(envelope.files) ? envelope.files : []))
    .map((file = {}) => file?.attachmentMeta?.owner?.type);
  assert.deepEqual(transferAttachmentOwners, ["plugin", "plugin"]);
  assert.equal(finalAssistant.attachments, undefined);
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
  assert.equal(String(planningPromptMessage?.role || ""), "user");
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
  const guidancePromptMessage = messages[messages.length - 1] || {};
  assert.equal(String(guidancePromptMessage?.role || ""), "user");
  assert.match(String(guidancePromptMessage?.content || ""), /harness-guidance/);
  assert.match(String(guidancePromptMessage?.content || ""), /工具失败达到阈值/);
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
  assert.equal(String(result.output), "done");
  assert.equal(agentContext.payload.harness.acceptanceReports.length, 1);
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

test("harness forced acceptance is owned by acceptance without appending to final output", async () => {
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

  assert.match(String(result.output), /^done/);
  assert.doesNotMatch(String(result.output), /\[Harness-验收\]/);
  assert.doesNotMatch(String(result.output), /NOOBOT_HARNESS_COLLAPSE/);
  assert.doesNotMatch(String(result.output), /acceptanceReport|完整计划清单/);
  assert.equal(agentContext.payload.harness.acceptanceReports.length, 1);
  assert.equal(agentContext.payload.harness.logs.acceptance.some((log) => log.event === "forced_acceptance_triggered"), true);
  assert.equal(agentContext.payload.harness.logs.planning.some((log) => log.event === "forced_acceptance_triggered"), false);
});

