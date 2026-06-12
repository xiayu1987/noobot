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

import { DEFAULT_HARNESS_DENY_TOOL_NAMES, normalizeOptions } from "../src/core/options.js";
import { appendJsonlBuffered, flushAllJsonlBuffers } from "../src/store/store.js";
import { createCapabilityRuntime } from "../src/capabilities/runtime.js";
import { HARNESS_HOOK_POINTS } from "../src/core/constants.js";
import { inferFsmTarget, HARNESS_FSM_STATES } from "../src/fsm/transitions.js";
import { buildEvent } from "../src/data/record-builders.js";
import { createGuidanceHandler } from "../src/capabilities/handlers/guidance.js";
import { createPlanningHandler } from "../src/capabilities/handlers/planning.js";
import { markGuidanceSummarizedMessages } from "../src/capabilities/handlers/guidance/signal-tracker.js";
import { invokeWithReasoningRetry } from "../src/capabilities/handlers/shared/model/invocation-utils.js";
import {
  markMessagesSummarized,
  relaySeparateModelOutputAsUserMessage,
} from "../src/capabilities/handlers/shared.js";

test("normalizeOptions applies schema defaults and coercion", () => {
  const options = normalizeOptions({
    miniRunnerMaxTurns: "15",
    manifestDebounceMs: "0",
    incrementalRecentMessageLimit: "11",
    jsonlFlushStrategy: { maxSize: "100", maxTime: "5000", onTerminal: false },
    fsmEnabled: false,
  });

  assert.equal(options.miniRunnerMaxTurns, 15);
  assert.equal(options.manifestDebounceMs, 0);
  assert.equal(options.jsonlFlushStrategy.maxSize, 100);
  assert.equal(options.jsonlFlushStrategy.maxTime, 5000);
  assert.equal(options.jsonlFlushStrategy.onTerminal, false);
  assert.equal(options.jsonlFlushStrategy.onError, true);
  assert.equal(options.incrementalRecentMessageLimit, 11);
  assert.equal(options.fsmEnabled, false);
  assert.equal(options.summaryOnToolBurstThreshold, false);
  assert.deepEqual(options.denyToolNames, [...DEFAULT_HARNESS_DENY_TOOL_NAMES]);
});

test("normalizeOptions enables optional tool-burst summary trigger", () => {
  const options = normalizeOptions({ enableToolBurstSummary: true });
  assert.equal(options.summaryOnToolBurstThreshold, true);
});

test("normalizeOptions keeps custom harness denyToolNames", () => {
  const options = normalizeOptions({
    denyToolNames: ["plan_multi_task_collaboration", "", "plan_multi_task_collaboration"],
  });
  assert.deepEqual(options.denyToolNames, ["plan_multi_task_collaboration"]);
});

test("appendJsonlBuffered supports adaptive flush by reason", async () => {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), "noobot-harness-jsonl-"));
  const filePath = path.join(base, "events.jsonl");
  const strategy = { maxSize: 100, maxTime: 60000, onTerminal: true, onError: true };

  await appendJsonlBuffered(filePath, { id: 1 }, strategy, 0, { reason: "terminal" });
  const first = await fs.readFile(filePath, "utf8");
  assert.match(first, /"id":1/);

  await appendJsonlBuffered(filePath, { id: 2 }, strategy, 0, { reason: "error" });
  const second = await fs.readFile(filePath, "utf8");
  assert.match(second, /"id":2/);

  await flushAllJsonlBuffers();
});

test("pending states are auto-cleaned by hook turns without timers", async () => {
  const runtime = createCapabilityRuntime({
    handlers: {},
  });
  const ctx = {
    agentContext: {
      payload: {
        harness: {
          state: {
            counters: {},
            flags: {
              planUpdateCapturePending: true,
              acceptanceSemanticValidationCapturePending: true,
              acceptanceSemanticValidationCaptureReportIndex: 3,
            },
            signals: {},
            pending: {
              guidance: "consecutive_failures",
              summary: true,
              planRevision: true,
              planRevisionContext: { summaryText: "pending-summary", targetMainStepIndexes: [] },
              acceptanceSemanticValidation: { reportIndex: 3 },
            },
          },
          taskChecklist: [],
          acceptanceReports: [],
          reviewReports: [],
          planningRawOutputs: [],
          lastPlanningRawOutput: null,
          logs: { planning: [], guidance: [], acceptance: [], review: [] },
        },
      },
    },
  };
  const meta = { harness: { pendingTtlHookTurns: 1 } };

  await runtime.runHook(HARNESS_HOOK_POINTS.BEFORE_LLM_CALL, ctx, meta);
  assert.equal(ctx.agentContext.payload.harness.state.pending.planRevision, true);
  assert.equal(ctx.agentContext.payload.harness.state.flags.planUpdateCapturePending, true);
  assert.equal(ctx.agentContext.payload.harness.state.counters.hookTurns, 1);

  await runtime.runHook(HARNESS_HOOK_POINTS.BEFORE_TURN, ctx, meta);
  assert.equal(ctx.agentContext.payload.harness.state.counters.hookTurns, 1);
  assert.equal(ctx.agentContext.payload.harness.state.pending.planRevision, true);
  assert.equal(ctx.agentContext.payload.harness.state.flags.planUpdateCapturePending, true);

  await runtime.runHook(HARNESS_HOOK_POINTS.BEFORE_LLM_CALL, ctx, meta);
  assert.equal(ctx.agentContext.payload.harness.state.pending.planRevision, true);
  assert.equal(ctx.agentContext.payload.harness.state.flags.planUpdateCapturePending, true);
  assert.equal(ctx.agentContext.payload.harness.state.counters.hookTurns, 2);

  await runtime.runHook(HARNESS_HOOK_POINTS.BEFORE_LLM_CALL, ctx, meta);
  assert.equal(ctx.agentContext.payload.harness.state.pending.planRevision, true);
  assert.equal(ctx.agentContext.payload.harness.state.flags.planUpdateCapturePending, false);
  assert.equal(ctx.agentContext.payload.harness.state.counters.hookTurns, 3);

  await runtime.runHook(HARNESS_HOOK_POINTS.BEFORE_LLM_CALL, ctx, meta);
  assert.equal(ctx.agentContext.payload.harness.state.pending.guidance, null);
  assert.equal(ctx.agentContext.payload.harness.state.pending.summary, false);
  assert.equal(ctx.agentContext.payload.harness.state.pending.planRevision, true);
  assert.equal(ctx.agentContext.payload.harness.state.pending.acceptanceSemanticValidation, null);
  assert.equal(ctx.agentContext.payload.harness.state.flags.planUpdateCapturePending, false);
  assert.equal(ctx.agentContext.payload.harness.state.flags.acceptanceSemanticValidationCapturePending, false);
  assert.equal(
    "acceptanceSemanticValidationCaptureReportIndex" in ctx.agentContext.payload.harness.state.flags,
    false,
  );
  assert.equal(ctx.agentContext.payload.harness.state.counters.hookTurns, 4);
});

test("takeover priority pipeline keeps higher priority takeover effective", async () => {
  const runtime = createCapabilityRuntime({
    profile: {
      planning: { enabled: true, priority: 0 },
      guidance: { enabled: true, priority: 0 },
    },
    handlers: {
      planning: async ({ point }) =>
        point === HARNESS_HOOK_POINTS.BEFORE_FINAL_OUTPUT
          ? {
              messageTakeover: { content: "planning", id: "planning", mode: "prepend", priority: 5 },
            }
          : null,
      guidance: async ({ point }) =>
        point === HARNESS_HOOK_POINTS.BEFORE_FINAL_OUTPUT
          ? {
              messageTakeover: { content: "guidance", id: "guidance", mode: "prepend", priority: 20 },
            }
          : null,
    },
  });

  const ctx = { messages: [{ role: "user", content: "hello" }] };
  await runtime.runHook(HARNESS_HOOK_POINTS.BEFORE_FINAL_OUTPUT, ctx, {});

  assert.match(String(ctx.messages[0]?.content || ""), /guidance/);
  assert.match(String(ctx.messages[1]?.content || ""), /planning/);
});

test("inferFsmTarget uses rule table consistently", () => {
  const toPlanning = inferFsmTarget(HARNESS_HOOK_POINTS.BEFORE_TURN, {}, HARNESS_FSM_STATES.IDLE);
  const toPlanned = inferFsmTarget(
    HARNESS_HOOK_POINTS.AFTER_LLM_CALL,
    { agentContext: { payload: { harness: { taskChecklist: [{ task: "x" }] } } } },
    HARNESS_FSM_STATES.PLANNING,
  );
  const toFailed = inferFsmTarget(HARNESS_HOOK_POINTS.ON_ERROR, {}, HARNESS_FSM_STATES.EXECUTING);

  assert.equal(toPlanning, HARNESS_FSM_STATES.PLANNING);
  assert.equal(toPlanned, HARNESS_FSM_STATES.PLANNED);
  assert.equal(toFailed, HARNESS_FSM_STATES.FAILED);
});

test("buildEvent promotes mini-runner tool turn limit flag to top level", () => {
  const event = buildEvent({
    point: "before_llm_call",
    ctx: {
      harnessCapabilityLogs: [
        {
          domain: "planning",
          event: "capability_model_trace",
          detail: {
            purpose: "planning",
            toolTurnLimitReached: true,
            traces: [{ turn: 5, toolTurnLimitReached: true }],
          },
        },
      ],
    },
    pluginName: "noobot-plugin-harness",
    pluginVersion: "0.1.0",
  });

  assert.equal(event.toolTurnLimitReached, true);
});

test("planning separate_model avoids duplicate invoker calls while one run is in-flight", async () => {
  const handler = createPlanningHandler();
  const ctx = {
    messages: [{ role: "user", content: "analyze harness token spikes" }],
    agentContext: { payload: {} },
  };
  let invokerCalls = 0;
  const meta = {
    harness: {
      planningGuidanceMode: "separate_model",
      capabilityModelInvoker: async () => {
        invokerCalls += 1;
        await new Promise((resolve) => setTimeout(resolve, 80));
        return {
          content: JSON.stringify({
            taskOwner: "admin",
            taskChecklist: [{ index: 1, task: "inspect planning path", owner: "admin" }],
          }),
        };
      },
    },
  };

  const first = handler({ capability: "planning", point: "before_llm_call", ctx, meta });
  await new Promise((resolve) => setTimeout(resolve, 10));
  const second = handler({ capability: "planning", point: "before_llm_call", ctx, meta });
  await Promise.all([first, second]);

  assert.equal(invokerCalls, 1);
  assert.equal(
    ctx.messages.filter((item = {}) =>
      String(item?.content || "").includes("[来自harness外部模型输出/planning]"),
    ).length,
    1,
  );
  assert.equal(ctx.agentContext.payload.harness.state.flags.planningSeparateModelInFlight, false);
});

test("relaySeparateModelOutputAsUserMessage dedupes repeated planning relay when enabled", () => {
  const ctx = { messages: [] };
  const payload = {
    purpose: "planning",
    content: '{"taskOwner":"admin","taskChecklist":[{"index":1,"task":"x","owner":"admin"}]}',
    dedupe: true,
  };

  const first = relaySeparateModelOutputAsUserMessage(ctx, payload);
  const second = relaySeparateModelOutputAsUserMessage(ctx, payload);

  assert.equal(first, true);
  assert.equal(second, false);
  assert.equal(ctx.messages.length, 1);
  assert.equal(ctx.messages[0]?.role, "system");
  assert.match(String(ctx.messages[0]?.content || ""), /\[来自harness外部模型输出\/planning\]/);
});

test("relaySeparateModelOutputAsUserMessage truncates oversized relay content when transfer refs exist", () => {
  const ctx = { messages: [] };
  const content = `HEAD-${"x".repeat(2400)}-TAIL`;
  const relayed = relaySeparateModelOutputAsUserMessage(ctx, {
    purpose: "planning_refinement",
    content,
    dedupe: true,
    attachmentMetas: [
      {
        attachmentId: "att-1",
        name: "detail.md",
        path: "/workspace/detail.md",
        relativePath: "detail.md",
      },
    ],
  });

  assert.equal(relayed, true);
  assert.equal(ctx.messages.length, 1);
  const message = ctx.messages[0] || {};
  assert.equal(message.role, "system");
  const relayContent = String(message?.content || "");
  assert.match(relayContent, /transferEnvelope\(s\)/);
  assert.match(relayContent, /已截断/);
  assert.equal(relayContent.includes("-TAIL"), false);
  assert.equal(typeof message?.transferEnvelope, "object");
  assert.equal(Array.isArray(message?.transferEnvelopes), true);
  assert.equal(message.transferEnvelopes.length > 0, true);
});

test("relaySeparateModelOutputAsUserMessage is blocked after agent turn ended", async () => {
  const runtime = createCapabilityRuntime({ handlers: {} });
  const ctx = {
    dialogProcessId: "dialog-old",
    messages: [],
    agentContext: { payload: {} },
  };

  await runtime.runHook(HARNESS_HOOK_POINTS.BEFORE_TURN, ctx, {});
  await runtime.runHook(HARNESS_HOOK_POINTS.AFTER_TURN, ctx, {});

  const relayed = relaySeparateModelOutputAsUserMessage(ctx, {
    purpose: "planning",
    content: '{"taskOwner":"admin","taskChecklist":[{"index":1,"task":"x","owner":"admin"}]}',
    dedupe: true,
  });

  assert.equal(relayed, false);
  assert.equal(ctx.messages.length, 0);
});

test("planning separate_model uses injected resolveModelMessages from harness meta", async () => {
  const handler = createPlanningHandler();
  const ctx = {
    messages: [
      { role: "user", content: "keep-me" },
      { role: "assistant", content: "drop-me" },
    ],
    agentContext: { payload: {} },
  };
  let capturedMessages = null;
  const meta = {
    harness: {
      planningGuidanceMode: "separate_model",
      resolveModelMessages: ({ messages = [] } = {}) =>
        (Array.isArray(messages) ? messages : []).filter((item) =>
          String(item?.content || "").includes("keep-me"),
        ),
      capabilityModelInvoker: async ({ messages = [] } = {}) => {
        capturedMessages = messages;
        return {
          content: JSON.stringify({
            taskOwner: "admin",
            taskChecklist: [{ index: 1, task: "ok", owner: "admin" }],
          }),
        };
      },
    },
  };

  await handler({ capability: "planning", point: "before_llm_call", ctx, meta });

  assert.equal(Array.isArray(capturedMessages), true);
  assert.equal(capturedMessages.some((item = {}) => String(item?.content || "") === "drop-me"), false);
  assert.equal(capturedMessages.some((item = {}) => String(item?.content || "") === "keep-me"), true);
});

test("markMessagesSummarized keeps user/system messages unsummarized", () => {
  const messages = [
    { role: "system", content: "policy" },
    { role: "user", content: "analyze harness plugin" },
    { role: "assistant", content: "", tool_calls: [{ id: "c1", function: { name: "execute_script" } }] },
    { role: "tool", toolName: "execute_script", content: '{"toolName":"execute_script","ok":true}' },
  ];

  const marked = markMessagesSummarized(messages);
  assert.equal(marked, 2);
  assert.equal(messages[0].summarized, undefined);
  assert.equal(messages[1].summarized, undefined);
  assert.equal(messages[2].summarized, true);
  assert.equal(messages[3].summarized, true);
});

test("markMessagesSummarized marks older injected messages but preserves latest per type", () => {
  const messages = [
    { role: "user", content: "old summary", injectedMessage: true, injectedBy: "harness-plugin", injectedMessageType: "guidance_summary_prompt" },
    { role: "user", content: "planning", injectedMessage: true, injectedBy: "harness-plugin", injectedMessageType: "planning_task" },
    { role: "user", content: "new summary", injectedMessage: true, injectedBy: "harness-plugin", injectedMessageType: "guidance_summary_prompt" },
  ];

  const marked = markMessagesSummarized(messages);
  assert.equal(marked, 1);
  assert.equal(messages[0].summarized, true);
  assert.equal(messages[1].summarized, undefined);
  assert.equal(messages[2].summarized, undefined);
});


test("markMessagesSummarized follows task_summary exclusions", () => {
  const messages = [
    { role: "assistant", content: "", tool_calls: [{ id: "c1", function: { name: "task_summary" } }] },
    { role: "assistant", content: "normal assistant text" },
    { role: "tool", content: '{"toolName":"task_summary","ok":true}' },
  ];

  const marked = markMessagesSummarized(messages);
  assert.equal(marked, 0);
  assert.equal(messages[0].summarized, undefined);
  assert.equal(messages[1].summarized, undefined);
  assert.equal(messages[2].summarized, undefined);
});

test("guidance summary prefers injected markMessagesSummarized from harness meta", async () => {
  const handler = createGuidanceHandler({
    shouldProcessPrimaryToolHooks: () => true,
  });
  let injectedCalled = 0;
  const ctx = {
    messages: [{ role: "assistant", content: "", tool_calls: [{ id: "c1", function: { name: "execute_script" } }] }],
    ai: { content: "小结完成" },
    agentContext: {
      payload: {
        harness: {
          state: {
            flags: { guidanceSummaryMarkPending: true },
            counters: {},
            signals: {},
            pending: {},
          },
          logs: { planning: [], guidance: [], acceptance: [], review: [] },
        },
      },
    },
  };
  const meta = {
    harness: {
      markMessagesSummarized: ({ messages = [] } = {}) => {
        injectedCalled += 1;
        for (const item of messages) item.summarized = true;
        return Array.isArray(messages) ? messages.length : 0;
      },
    },
  };

  await handler({ capability: "guidance", point: "after_llm_call", ctx, meta });
  assert.ok(injectedCalled >= 1);
});

test("guidance summary checkpoint marks only messages before checkpoint", async () => {
  let injectedCalled = 0;
  const oldToolCall = {
    role: "assistant",
    content: "",
    tool_calls: [{ id: "old_call", function: { name: "execute_script" } }],
  };
  const oldToolResult = {
    role: "tool",
    toolName: "execute_script",
    tool_call_id: "old_call",
    content: '{"toolName":"execute_script","ok":true}',
  };
  const newToolCall = {
    role: "assistant",
    content: "",
    tool_calls: [{ id: "new_call", function: { name: "execute_script" } }],
  };
  const newToolResult = {
    role: "tool",
    toolName: "execute_script",
    tool_call_id: "new_call",
    content: '{"toolName":"execute_script","ok":true}',
  };
  const messages = [oldToolCall, oldToolResult, newToolCall, newToolResult];
  const ctx = {
    messages,
    agentContext: {
      payload: {
        harness: {
          state: {
            counters: {},
            flags: {},
            signals: {},
            pending: {
              summaryCheckpointMessageCount: 2,
            },
          },
          taskChecklist: [],
          acceptanceReports: [],
          reviewReports: [],
          planningRawOutputs: [],
          logs: { planning: [], guidance: [], acceptance: [], review: [] },
        },
        messages: {
          history: messages,
        },
      },
    },
  };
  const meta = {
    harness: {
      markMessagesSummarized: ({ messages: scoped = [], summaryScope = {} } = {}) => {
        injectedCalled += 1;
        assert.equal(Array.isArray(scoped), true);
        assert.equal(scoped.length, 2);
        assert.equal(summaryScope?.maxMessages, 2);
        assert.equal(summaryScope?.limitToProvidedMessagesOnly, true);
        for (const item of scoped) {
          item.summarized = true;
        }
        return scoped.length;
      },
    },
  };

  const markedCount = await markGuidanceSummarizedMessages(ctx, meta);
  assert.equal(markedCount >= 2, true);
  assert.equal(oldToolCall.summarized, true);
  assert.equal(oldToolResult.summarized, true);
  assert.equal(newToolCall.summarized, undefined);
  assert.equal(newToolResult.summarized, undefined);
  assert.equal(injectedCalled >= 1, true);
  assert.equal(ctx.agentContext.payload.harness.state.pending.summaryCheckpointMessageCount, null);
});

test("invokeWithReasoningRetry throws error when reasoning-only persists after one retry", async () => {
  let calls = 0;
  const ctx = {
    agentContext: {
      payload: {
        harness: {
          state: { counters: {}, flags: {}, signals: {}, pending: {} },
          taskChecklist: [],
          acceptanceReports: [],
          reviewReports: [],
          planningRawOutputs: [],
          logs: { planning: [], guidance: [], acceptance: [], review: [] },
        },
      },
    },
  };

  await assert.rejects(
    () =>
      invokeWithReasoningRetry({
        invoker: async () => {
          calls += 1;
          return { content: "<think>only reasoning</think>" };
        },
        invokePayload: { messages: [{ role: "user", content: "x" }] },
        maxReasoningRetries: 1,
        purpose: "planning",
        domain: "planning",
        ctx,
      }),
    (error) => error?.code === "CAPABILITY_REASONING_RETRY_EXHAUSTED",
  );
  assert.equal(calls, 2);
});
