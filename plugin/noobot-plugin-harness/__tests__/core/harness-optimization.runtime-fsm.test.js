/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  createTestHookContext,
  ensureTestAgentExecutionScope,
} from "../helpers/public-runtime-fixtures.js";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { DEFAULT_HARNESS_DENY_TOOL_NAMES, normalizeOptions } from "../../src/core/options.js";
import { appendJsonlBuffered, flushAllJsonlBuffers } from "../../src/store/store.js";
import { createCapabilityRuntime } from "../../src/capabilities/runtime.js";
import { HOOK_POINT } from "@noobot/hook-protocol";
import { inferFsmTarget, HARNESS_FSM_STATES } from "../../src/fsm/transitions.js";
import { buildEvent } from "../../src/data/record-builders.js";
import {
  createGuidanceHandler,
  createPlanningHandler,
} from "../helpers/context-aware-handler-fixtures.js";
import { markGuidanceSummarizedMessages } from "../../src/capabilities/handlers/guidance/signal-tracker.js";
import { invokeWithReasoningRetry } from "../../src/capabilities/handlers/shared/model/invocation-utils.js";
import { relaySeparateModelOutputAsUserMessage } from "../../src/capabilities/handlers/shared.js";

test("pending states are auto-cleaned by hook turns without timers", async () => {
  const runtime = createCapabilityRuntime({
    handlers: {},
  });
  const ctx = {
    agentContext: {
      execution: {
        controllers: {
          runtime: {
            runConfig: { scenario: "programming" },
          },
        },
      },
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
              planRevisionContext: { targetMainStepIndexes: [] },
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
  ensureTestAgentExecutionScope(ctx);

  await runtime.runHook(HOOK_POINT.AGENT.BEFORE_LLM_CALL, ctx, meta);
  assert.equal(ctx.agentContext.payload.harness.state.pending.planRevision, true);
  assert.equal(ctx.agentContext.payload.harness.state.flags.planUpdateCapturePending, true);
  assert.equal(ctx.agentContext.payload.harness.state.counters.hookTurns, 1);

  await runtime.runHook(HOOK_POINT.AGENT.BEFORE_TURN, ctx, meta);
  assert.equal(ctx.agentContext.payload.harness.state.counters.hookTurns, 1);
  assert.equal(ctx.agentContext.payload.harness.state.pending.planRevision, true);
  assert.equal(ctx.agentContext.payload.harness.state.flags.planUpdateCapturePending, true);

  await runtime.runHook(HOOK_POINT.AGENT.BEFORE_LLM_CALL, ctx, meta);
  assert.equal(ctx.agentContext.payload.harness.state.pending.planRevision, true);
  assert.equal(ctx.agentContext.payload.harness.state.flags.planUpdateCapturePending, true);
  assert.equal(ctx.agentContext.payload.harness.state.counters.hookTurns, 2);

  await runtime.runHook(HOOK_POINT.AGENT.BEFORE_LLM_CALL, ctx, meta);
  assert.equal(ctx.agentContext.payload.harness.state.pending.planRevision, false);
  assert.equal(ctx.agentContext.payload.harness.state.flags.planUpdateCapturePending, false);
  assert.equal(ctx.agentContext.payload.harness.state.counters.hookTurns, 3);

  await runtime.runHook(HOOK_POINT.AGENT.BEFORE_LLM_CALL, ctx, meta);
  assert.equal(ctx.agentContext.payload.harness.state.pending.guidance, null);
  assert.equal(ctx.agentContext.payload.harness.state.pending.summary, false);
  assert.equal(ctx.agentContext.payload.harness.state.pending.planRevision, false);
  assert.equal(ctx.agentContext.payload.harness.state.pending.acceptanceSemanticValidation, null);
  assert.equal(ctx.agentContext.payload.harness.state.flags.planUpdateCapturePending, false);
  assert.equal(
    ctx.agentContext.payload.harness.state.flags.acceptanceSemanticValidationCapturePending,
    false,
  );
  assert.equal(
    "acceptanceSemanticValidationCaptureReportIndex" in
      ctx.agentContext.payload.harness.state.flags,
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
        point === HOOK_POINT.AGENT.BEFORE_FINAL_OUTPUT
          ? {
              messageTakeover: {
                content: "planning",
                id: "planning",
                mode: "prepend",
                priority: 5,
              },
            }
          : null,
      guidance: async ({ point }) =>
        point === HOOK_POINT.AGENT.BEFORE_FINAL_OUTPUT
          ? {
              messageTakeover: {
                content: "guidance",
                id: "guidance",
                mode: "prepend",
                priority: 20,
              },
            }
          : null,
    },
  });

  const ctx = createTestHookContext({}, { messages: [{ role: "user", content: "hello" }] });
  await runtime.runHook(HOOK_POINT.AGENT.BEFORE_FINAL_OUTPUT, ctx, {});

  assert.match(String(ctx.modelContext.messages[0]?.content || ""), /guidance/);
  assert.match(String(ctx.modelContext.messages[1]?.content || ""), /planning/);
});

test("capability runtime skips disabled planning guidance and acceptance handlers", async () => {
  const calls = [];
  const runtime = createCapabilityRuntime({
    profile: {
      planning: { enabled: false },
      guidance: { enabled: false },
      acceptance: { enabled: false },
      review: { enabled: true },
    },
    handlers: {
      planning: async () => {
        calls.push("planning");
        return { messageTakeover: { content: "planning", mode: "prepend" } };
      },
      guidance: async () => {
        calls.push("guidance");
        return { messageTakeover: { content: "guidance", mode: "prepend" } };
      },
      acceptance: async () => {
        calls.push("acceptance");
        return { toolTakeover: { denyToolNames: ["task_summary"] } };
      },
      review: async () => {
        calls.push("review");
        return null;
      },
    },
  });

  const ctx = createTestHookContext(
    { toolPolicy: {} },
    {
      messages: [{ role: "user", content: "hello" }],
    },
  );
  const hooksWithDisabledCapabilities = [
    HOOK_POINT.AGENT.BEFORE_TURN,
    HOOK_POINT.AGENT.BEFORE_LLM_CALL,
    HOOK_POINT.AGENT.AFTER_LLM_CALL,
    HOOK_POINT.AGENT.BEFORE_TOOL_CALLS,
    HOOK_POINT.AGENT.BEFORE_TOOL_CALL,
    HOOK_POINT.AGENT.AFTER_TOOL_CALL,
    HOOK_POINT.AGENT.TOOL_CALL_ERROR,
    HOOK_POINT.AGENT.AFTER_TOOL_CALLS,
    HOOK_POINT.AGENT.BEFORE_FINAL_OUTPUT,
  ];

  for (const hook of hooksWithDisabledCapabilities) {
    const capabilities = runtime.resolveByHook(hook);
    assert.equal(
      capabilities.includes("planning"),
      false,
      `${hook} should not include disabled planning`,
    );
    assert.equal(
      capabilities.includes("guidance"),
      false,
      `${hook} should not include disabled guidance`,
    );
    assert.equal(
      capabilities.includes("acceptance"),
      false,
      `${hook} should not include disabled acceptance`,
    );
  }
  assert.deepEqual(runtime.resolveByHook(HOOK_POINT.AGENT.BEFORE_FINAL_OUTPUT), ["review"]);

  await runtime.runHook(HOOK_POINT.AGENT.BEFORE_LLM_CALL, ctx, {});
  await runtime.runHook(HOOK_POINT.AGENT.BEFORE_FINAL_OUTPUT, ctx, {});

  assert.deepEqual(calls, ["review"]);
  assert.equal(calls.includes("planning"), false);
  assert.equal(calls.includes("guidance"), false);
  assert.equal(calls.includes("acceptance"), false);
  assert.equal(String(ctx.modelContext.messages[0]?.content || "").includes("planning"), false);
  assert.equal(String(ctx.modelContext.messages[0]?.content || "").includes("guidance"), false);
  assert.deepEqual(ctx.toolPolicy, {});
});

test("inferFsmTarget uses rule table consistently", () => {
  const toPlanning = inferFsmTarget(HOOK_POINT.AGENT.BEFORE_TURN, {}, HARNESS_FSM_STATES.IDLE);
  const toPlanned = inferFsmTarget(
    HOOK_POINT.AGENT.AFTER_LLM_CALL,
    {
      agentContext: {
        bindings: {
          runtime: {},
          tools: [],
          extensions: { harness: { taskChecklist: [{ task: "x" }] } },
        },
      },
    },
    HARNESS_FSM_STATES.PLANNING,
  );
  const toolCallsToPlanned = inferFsmTarget(
    HOOK_POINT.AGENT.AFTER_LLM_CALL,
    { hasToolCalls: true, calls: [{ name: "read_file" }] },
    HARNESS_FSM_STATES.PLANNING,
  );
  const toFailed = inferFsmTarget(HOOK_POINT.AGENT.ON_ERROR, {}, HARNESS_FSM_STATES.EXECUTING);

  assert.equal(toPlanning, HARNESS_FSM_STATES.PLANNING);
  assert.equal(toPlanned, HARNESS_FSM_STATES.PLANNED);
  assert.equal(toolCallsToPlanned, HARNESS_FSM_STATES.PLANNED);
  assert.equal(toFailed, HARNESS_FSM_STATES.FAILED);
});

test("buildEvent promotes mini-runner tool turn limit flag to top level", () => {
  const event = buildEvent({
    point: "agent.before_llm_call",
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
