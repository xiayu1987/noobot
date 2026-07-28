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
import { normalizeHookContextProtocol } from "../src/core/context.js";
import { injectPrompt, resolvePolicyPromptSelection } from "../src/tracing/buffer-manager.js";
import { buildDefaultPolicyPrompt } from "../src/tracing/policy-prompt-matrix.js";
import {
  applyDynamicPolicyPromptFromText,
  buildDynamicPolicyPromptProtocolInstruction,
} from "../src/capabilities/handlers/shared/workflow/dynamic-policy-prompt.js";
import { ensureHarnessBucket } from "../src/capabilities/handlers/shared.js";
import { HARNESS_PROMPT_INJECTION_ID_FIELD } from "../src/capabilities/handlers/shared/constants.js";
import { exists, waitForFile, readJsonl } from "./test-helpers.js";

test("ensureHarnessBucket fast-path keeps initialized references stable", async () => {
  const ctx = {
    agentContext: {
      payload: {
        harness: {
          state: {
            counters: { llmTurns: 9 },
            flags: { planningCaptured: true },
            signals: { successfulToolCount: 3 },
            pending: { guidance: null, summary: false },
          },
          taskChecklist: [{ index: 1, task: "t1" }],
          acceptanceReports: [],
          reviewReports: [],
          planningRawOutputs: [],
          lastPlanningRawOutput: null,
          logs: { planning: [], guidance: [], acceptance: [], review: [] },
          __harnessBucketVersion: 1,
        },
      },
    },
  };
  ctx.agentContext.payload.harness.state.__harnessBucketVersion = 1;

  const first = ensureHarnessBucket(ctx);
  assert.ok(first);
  const refs = {
    bucket: first.bucket,
    state: first.state,
    counters: first.state.counters,
    flags: first.state.flags,
    signals: first.state.signals,
    pending: first.state.pending,
    logs: first.bucket.logs,
    taskChecklist: first.bucket.taskChecklist,
  };

  const second = ensureHarnessBucket(ctx);
  assert.ok(second);
  assert.equal(second.bucket, refs.bucket);
  assert.equal(second.state, refs.state);
  assert.equal(second.state.counters, refs.counters);
  assert.equal(second.state.flags, refs.flags);
  assert.equal(second.state.signals, refs.signals);
  assert.equal(second.state.pending, refs.pending);
  assert.equal(second.bucket.logs, refs.logs);
  assert.equal(second.bucket.taskChecklist, refs.taskChecklist);
  assert.equal(second.state.counters.llmTurns, 9);
  assert.equal(second.state.flags.planningCaptured, true);
  assert.equal(second.state.signals.successfulToolCount, 3);
});


test("normalizeHookContextProtocol exposes agentContext payload messages for before_final_output", () => {
  const ctx = {
    agentContext: {
      payload: {
        messages: {
          system: [{ role: "system", content: "system ctx" }],
          history: [{ role: "user", content: "history ctx" }],
          incremental: [{ role: "assistant", content: "incremental ctx" }],
        },
      },
    },
  };

  normalizeHookContextProtocol("before_final_output", ctx);

  assert.equal(ctx.point, "before_final_output");
  assert.deepEqual(ctx.messageBlocks.system.map(({ role, content }) => ({ role, content })), [
    { role: "system", content: "system ctx" },
  ]);
  assert.deepEqual(ctx.messageBlocks.history.map(({ role, content }) => ({ role, content })), [
    { role: "user", content: "history ctx" },
  ]);
  assert.deepEqual(ctx.messageBlocks.incremental.map(({ role, content }) => ({ role, content })), [
    { role: "assistant", content: "incremental ctx" },
  ]);
  assert.ok(ctx.messageBlocks.system[0].additional_kwargs?.noobotMessageId);
  assert.deepEqual(ctx.messages.map((item = {}) => item.content), [
    "system ctx",
    "history ctx",
    "incremental ctx",
  ]);
});

test("normalizeHookContextProtocol canonicalizes messages and messageBlocks through one store", () => {
  const ctxMessage = {
    role: "assistant",
    content: "",
    tool_calls: [{ id: "call_1", function: { name: "write_file" } }],
  };
  const blockCopy = {
    role: "assistant",
    content: "",
    tool_calls: [{ id: "call_1", function: { name: "write_file" } }],
  };
  const ctx = {
    messages: [
      { role: "user", content: "task" },
      ctxMessage,
    ],
    messageBlocks: {
      system: [],
      history: [],
      incremental: [
        { role: "user", content: "task" },
        blockCopy,
      ],
    },
  };

  normalizeHookContextProtocol("before_llm_call", ctx);

  assert.equal(ctx.messages[1], ctx.messageBlocks.incremental[1]);
  assert.ok(ctx.messages[1].additional_kwargs?.noobotMessageId);
  assert.equal(
    ctx.messages[1].additional_kwargs.noobotMessageId,
    ctx.messageBlocks.incremental[1].additional_kwargs.noobotMessageId,
  );
  assert.equal(ctx.messageBlocks.incrementalIds, undefined);
  ctx.messages[1].summarized = true;
  assert.equal(ctx.messageBlocks.incremental[1].summarized, true);
});

