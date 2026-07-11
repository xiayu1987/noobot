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

test("guidance summary checkpoint marks matching messageBlocks instead of flat block prefix", async () => {
  const oldToolCall = {
    role: "assistant",
    content: "",
    tool_calls: [{ id: "old_call", function: { name: "write_file" } }],
  };
  const oldToolResult = {
    role: "tool",
    toolName: "write_file",
    tool_call_id: "old_call",
    content: '{"toolName":"write_file","ok":true}',
  };
  const nextToolCall = {
    role: "assistant",
    content: "",
    tool_calls: [{ id: "next_call", function: { name: "read_file" } }],
  };
  const nextToolResult = {
    role: "tool",
    toolName: "read_file",
    tool_call_id: "next_call",
    content: '{"toolName":"read_file","ok":true}',
  };
  const summaryRelay = {
    role: "user",
    content: "[来自harness外部模型输出/summary]\nsummary",
    additional_kwargs: {
      injectedMessageType: "separate_model_relay:summary",
      dialogProcessId: "dp-1",
    },
  };
  const messages = [
    { role: "system", content: "policy" },
    { role: "user", content: "task" },
    oldToolCall,
    oldToolResult,
    nextToolCall,
    nextToolResult,
    summaryRelay,
  ];
  const blockOldToolCall = structuredClone(oldToolCall);
  const blockOldToolResult = structuredClone(oldToolResult);
  const blockNextToolCall = structuredClone(nextToolCall);
  const blockNextToolResult = structuredClone(nextToolResult);
  const ctx = {
    messages,
    messageBlocks: {
      system: [
        { role: "system", content: "base system 1" },
        { role: "system", content: "base system 2" },
      ],
      history: [],
      incremental: [
        { role: "user", content: "task" },
        blockOldToolCall,
        blockOldToolResult,
        blockNextToolCall,
        blockNextToolResult,
      ],
    },
    agentContext: {
      payload: {
        harness: {
          state: {
            counters: {},
            flags: {},
            signals: {},
            pending: {
              summaryCheckpointMessageCount: 6,
            },
          },
          taskChecklist: [],
          acceptanceReports: [],
          reviewReports: [],
          planningRawOutputs: [],
          logs: { planning: [], guidance: [], acceptance: [], review: [] },
        },
        messages: {
          history: [],
        },
      },
    },
  };

  normalizeHookContextProtocol("before_llm_call", ctx);
  assert.equal(ctx.messageBlocks.incremental[1], oldToolCall);
  assert.equal(ctx.messageBlocks.incremental[2], oldToolResult);
  assert.equal(ctx.messageBlocks.incremental[3], nextToolCall);
  assert.equal(ctx.messageBlocks.incremental[4], nextToolResult);

  const markedCount = await markGuidanceSummarizedMessages(ctx, {});

  assert.equal(markedCount, 8);
  assert.equal(oldToolCall.summarized, true);
  assert.equal(oldToolResult.summarized, true);
  assert.equal(nextToolCall.summarized, true);
  assert.equal(nextToolResult.summarized, true);
  assert.equal(ctx.messageBlocks.incremental[1].summarized, true);
  assert.equal(ctx.messageBlocks.incremental[2].summarized, true);
  assert.equal(ctx.messageBlocks.incremental[3].summarized, true);
  assert.equal(ctx.messageBlocks.incremental[4].summarized, true);
  assert.equal(ctx.messageBlocks.system.some((message) => message.summarized === true), false);
  assert.equal(summaryRelay.summarized, undefined);
});

test("guidance summary checkpoint prefers message ids over checkpoint count", async () => {
  const oldToolCall = {
    role: "assistant",
    content: "",
    tool_calls: [{ id: "old_call", function: { name: "write_file" } }],
  };
  const oldToolResult = {
    role: "tool",
    toolName: "write_file",
    tool_call_id: "old_call",
    content: '{"toolName":"write_file","ok":true}',
  };
  const newToolCall = {
    role: "assistant",
    content: "",
    tool_calls: [{ id: "new_call", function: { name: "read_file" } }],
  };
  const newToolResult = {
    role: "tool",
    toolName: "read_file",
    tool_call_id: "new_call",
    content: '{"toolName":"read_file","ok":true}',
  };
  const ctx = {
    messages: [
      { role: "user", content: "task" },
      oldToolCall,
      oldToolResult,
      newToolCall,
      newToolResult,
    ],
    messageBlocks: {
      system: [],
      history: [],
      incremental: [
        { role: "user", content: "task" },
        structuredClone(oldToolCall),
        structuredClone(oldToolResult),
        structuredClone(newToolCall),
        structuredClone(newToolResult),
      ],
    },
    agentContext: {
      payload: {
        harness: {
          state: {
            counters: {},
            flags: {},
            signals: {},
            pending: {
              summaryCheckpointMessageCount: 5,
              summaryCheckpointMessageIds: [],
            },
          },
          taskChecklist: [],
          acceptanceReports: [],
          reviewReports: [],
          planningRawOutputs: [],
          logs: { planning: [], guidance: [], acceptance: [], review: [] },
        },
        messages: {
          history: [],
        },
      },
    },
  };
  normalizeHookContextProtocol("before_llm_call", ctx);
  ctx.agentContext.payload.harness.state.pending.summaryCheckpointMessageIds = [
    oldToolCall.additional_kwargs.noobotMessageId,
    oldToolResult.additional_kwargs.noobotMessageId,
  ];

  const markedCount = await markGuidanceSummarizedMessages(ctx, {});

  assert.equal(markedCount, 4);
  assert.equal(oldToolCall.summarized, true);
  assert.equal(oldToolResult.summarized, true);
  assert.equal(newToolCall.summarized, undefined);
  assert.equal(newToolResult.summarized, undefined);
  assert.equal(ctx.messageBlocks.incremental[1].summarized, true);
  assert.equal(ctx.messageBlocks.incremental[2].summarized, true);
  assert.equal(ctx.messageBlocks.incremental[3].summarized, undefined);
  assert.equal(ctx.messageBlocks.incremental[4].summarized, undefined);
  assert.equal(ctx.agentContext.payload.harness.state.pending.summaryCheckpointMessageIds, null);
});


