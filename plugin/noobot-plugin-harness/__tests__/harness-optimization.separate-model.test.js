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
  assert.equal(ctx.messages[0]?.role, "user");
  assert.match(String(ctx.messages[0]?.content || ""), /\[来自harness外部模型输出\/planning\]/);
});

test("relaySeparateModelOutputAsUserMessage preserves oversized relay content when transfer refs exist", () => {
  const ctx = { messages: [] };
  const content = `HEAD-${"x".repeat(2400)}-TAIL`;
  const relayed = relaySeparateModelOutputAsUserMessage(ctx, {
    purpose: "planning_refinement",
    content,
    dedupe: true,
    attachments: [
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
  assert.equal(message.role, "user");
  const relayContent = String(message?.content || "");
  assert.equal(relayContent, `[来自harness外部模型输出/planning_refinement]\n${content}`);
  assert.equal(relayContent.includes("-TAIL"), true);
  assert.equal(typeof message?.transferEnvelopes, "object");
  assert.equal(Array.isArray(message?.transferEnvelopes), true);
  assert.equal(message.transferEnvelopes.length > 0, true);
  assert.equal(message?.attachments, undefined);
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
    messageBlocks: {
      system: [],
      history: [{ role: "assistant", content: "drop-me" }],
      incremental: [{ role: "user", content: "keep-me" }],
    },
    agentContext: { payload: {} },
  };
  let capturedMessages = null;
  const meta = {
    harness: {
      planningGuidanceMode: "separate_model",
      resolveModelMessages: ({ ctx: resolverCtx = {}, messages = [] } = {}) => {
        const source = Array.isArray(messages) && messages.length
          ? messages
          : [
              ...(resolverCtx.messageBlocks?.history || []),
              ...(resolverCtx.messageBlocks?.incremental || []),
            ];
        return source.filter((item) =>
          String(item?.content || "").includes("keep-me"),
        );
      },
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
