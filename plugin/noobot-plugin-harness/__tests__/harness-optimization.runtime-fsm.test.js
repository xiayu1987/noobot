// Tests split by responsibility from harness-optimization.test.js.
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
import { normalizeHookContextProtocol } from "../src/core/context.js";
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
  assert.equal(ctx.agentContext.payload.harness.state.pending.planRevision, false);
  assert.equal(ctx.agentContext.payload.harness.state.flags.planUpdateCapturePending, false);
  assert.equal(ctx.agentContext.payload.harness.state.counters.hookTurns, 3);

  await runtime.runHook(HARNESS_HOOK_POINTS.BEFORE_LLM_CALL, ctx, meta);
  assert.equal(ctx.agentContext.payload.harness.state.pending.guidance, null);
  assert.equal(ctx.agentContext.payload.harness.state.pending.summary, false);
  assert.equal(ctx.agentContext.payload.harness.state.pending.planRevision, false);
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

  const ctx = { messages: [{ role: "user", content: "hello" }], toolPolicy: {} };
  const hooksWithDisabledCapabilities = [
    HARNESS_HOOK_POINTS.BEFORE_TURN,
    HARNESS_HOOK_POINTS.BEFORE_LLM_CALL,
    HARNESS_HOOK_POINTS.AFTER_LLM_CALL,
    HARNESS_HOOK_POINTS.BEFORE_TOOL_CALLS,
    HARNESS_HOOK_POINTS.BEFORE_TOOL_CALL,
    HARNESS_HOOK_POINTS.AFTER_TOOL_CALL,
    HARNESS_HOOK_POINTS.TOOL_CALL_ERROR,
    HARNESS_HOOK_POINTS.AFTER_TOOL_CALLS,
    HARNESS_HOOK_POINTS.BEFORE_FINAL_OUTPUT,
  ];

  for (const hook of hooksWithDisabledCapabilities) {
    const capabilities = runtime.resolveByHook(hook);
    assert.equal(capabilities.includes("planning"), false, `${hook} should not include disabled planning`);
    assert.equal(capabilities.includes("guidance"), false, `${hook} should not include disabled guidance`);
    assert.equal(capabilities.includes("acceptance"), false, `${hook} should not include disabled acceptance`);
  }
  assert.deepEqual(runtime.resolveByHook(HARNESS_HOOK_POINTS.BEFORE_FINAL_OUTPUT), ["review"]);

  await runtime.runHook(HARNESS_HOOK_POINTS.BEFORE_LLM_CALL, ctx, {});
  await runtime.runHook(HARNESS_HOOK_POINTS.BEFORE_FINAL_OUTPUT, ctx, {});

  assert.deepEqual(calls, ["review"]);
  assert.equal(calls.includes("planning"), false);
  assert.equal(calls.includes("guidance"), false);
  assert.equal(calls.includes("acceptance"), false);
  assert.equal(String(ctx.messages[0]?.content || "").includes("planning"), false);
  assert.equal(String(ctx.messages[0]?.content || "").includes("guidance"), false);
  assert.deepEqual(ctx.toolPolicy, {});
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



























