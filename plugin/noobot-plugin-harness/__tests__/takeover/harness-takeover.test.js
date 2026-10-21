/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";

import { createTestHookManager as createAgentHookManager } from "../helpers/public-runtime-fixtures.js";
import { registerHarnessCore } from "../../src/index.js";
import { createModelContext } from "@noobot/context-protocol";
import { canonicalizeTestMessageBlocks } from "../helpers/context-message.js";
import { isHarnessPromptMessage } from "../../src/capabilities/handlers/shared/message/injected-message-utils.js";

function withModelContext(ctx, { messageBlocks }) {
  return {
    ...ctx,
    contextProtocolVersion: 3,
    modelContext: createModelContext({
      messageBlocks: canonicalizeTestMessageBlocks(messageBlocks),
    }),
  };
}

test("harness capability hook can take over tool calls", async () => {
  const hookManager = createAgentHookManager();
  registerHarnessCore(
    { hookManager },
    {
      planningGuidanceMode: "inject",
      trace: false,
      promptPolicy: false,
      capabilityHandlers: {
        acceptance: async ({ point }) => {
          if (point !== "agent.before_tool_calls") return null;
          return {
            capability: "acceptance",
            status: "active",
            toolTakeover: {
              allowToolNames: ["wait"],
              forceCall: { name: "wait", args: { seconds: 1 } },
              mode: "replace",
            },
          };
        },
      },
    },
  );

  const ctx = withModelContext(
    {
      userId: "u4",
      sessionId: "s4",
      dialogProcessId: "dp4",
      phase: "tool_calls",
      status: "start",
      calls: [
        { name: "do_search_web", args: { q: "abc" } },
        { name: "help", args: {} },
      ],
    },
    { messageBlocks: { system: [], history: [], incremental: [] } },
  );

  await hookManager.emit("agent.before_tool_calls", ctx);
  assert.equal(ctx.calls.length, 1);
  assert.equal(ctx.calls[0]?.name, "wait");
  assert.equal(ctx.calls[0]?.args?.seconds, 1);
});

test("harness capability hook can force inject system message in mid hooks", async () => {
  const hookManager = createAgentHookManager();
  registerHarnessCore(
    { hookManager },
    {
      planningGuidanceMode: "inject",
      trace: false,
      promptPolicy: false,
      capabilityHandlers: {
        acceptance: async ({ point }) => {
          if (point !== "agent.before_tool_calls") return null;
          return {
            systemMessageTakeover: {
              id: "harness-mid-hook-guard",
              content: "中途工具阶段触发：请先执行安全检查再继续。",
              mode: "prepend",
              target: "agent_system",
            },
          };
        },
      },
    },
  );

  const ctx = withModelContext(
    {
      userId: "u5",
      sessionId: "s5",
      dialogProcessId: "dp5",
      calls: [{ name: "wait", args: { seconds: 1 } }],
    },
    {
      messageBlocks: {
        system: [{ role: "system", content: "existing system message" }],
        history: [],
        incremental: [],
      },
    },
  );

  await hookManager.emit("agent.before_tool_calls", ctx);
  assert.equal(ctx.modelContext.messageBlocks.system.length, 2);
  assert.match(
    String(ctx.modelContext.messageBlocks.system[0]?.content || ""),
    /harness-mid-hook-guard/,
  );
});

test("harness capability hook can take over and remove agent internal forced messages", async () => {
  const hookManager = createAgentHookManager();
  registerHarnessCore(
    { hookManager },
    {
      planningGuidanceMode: "inject",
      trace: false,
      promptPolicy: false,
      capabilityHandlers: {
        guidance: async ({ point }) => {
          if (point !== "agent.before_llm_call") return null;
          return {
            messageTakeover: {
              removeInternalMessageTypes: ["tool_choice_required_retry_prompt"],
              id: "harness-replace-retry-prompt",
              content: "工具重试提示由 harness 接管。",
              mode: "prepend",
              target: "ctx_messages",
            },
          };
        },
      },
    },
  );

  const ctx = withModelContext(
    {
      userId: "u6",
      sessionId: "s6",
      dialogProcessId: "dp6",
      agentContext: {
        bindings: {
          extensions: {
            harness: {
              planText: "1. 已有主计划",
              state: {
                flags: { planningCaptured: true, planningPromptInjected: true },
              },
            },
          },
        },
      },
    },
    {
      messageBlocks: {
        system: [],
        history: [],
        incremental: [
          {
            role: "user",
            content: "internal retry prompt",
            additional_kwargs: {
              noobotInternalMessageType: "tool_choice_required_retry_prompt",
            },
          },
          { role: "user", content: "real user message" },
        ],
      },
    },
  );

  await hookManager.emit("agent.before_llm_call", ctx);
  assert.equal(ctx.modelContext.messages.length, 2);
  assert.match(String(ctx.modelContext.messages[0]?.content || ""), /harness-replace-retry-prompt/);
  assert.equal(
    ctx.modelContext.messages.some(
      (msg) =>
        msg?.additional_kwargs?.noobotInternalMessageType === "tool_choice_required_retry_prompt",
    ),
    false,
  );
});

test("harness message takeover keeps system context before injected ctx messages", async () => {
  const hookManager = createAgentHookManager();
  registerHarnessCore(
    { hookManager },
    {
      planningGuidanceMode: "inject",
      trace: false,
      promptPolicy: false,
      capabilityHandlers: {
        guidance: async ({ point }) => {
          if (point !== "agent.before_llm_call") return null;
          return {
            messageTakeover: {
              id: "harness-current-turn-note",
              content: "当前轮补充提示。",
              mode: "prepend",
              target: "ctx_messages",
            },
          };
        },
      },
    },
  );

  const ctx = withModelContext(
    {
      userId: "u7",
      sessionId: "s7",
      dialogProcessId: "dp7",
      agentContext: {
        bindings: {
          extensions: {
            harness: {
              planText: "1. 已有主计划",
              state: {
                flags: { planningCaptured: true, planningPromptInjected: true },
              },
            },
          },
        },
      },
    },
    {
      messageBlocks: {
        system: [{ role: "system", content: "system context" }],
        history: [],
        incremental: [{ role: "user", content: "real user message" }],
      },
    },
  );

  await hookManager.emit("agent.before_llm_call", ctx);
  assert.equal(ctx.modelContext.messages[0]?.content, "system context");
  assert.match(String(ctx.modelContext.messages[1]?.content || ""), /harness-current-turn-note/);
  assert.equal(ctx.modelContext.messages[2]?.content, "real user message");
});

test("harness ctx message takeover writes through message store views", async () => {
  const hookManager = createAgentHookManager();
  registerHarnessCore(
    { hookManager },
    {
      planningGuidanceMode: "inject",
      trace: false,
      promptPolicy: false,
      capabilityHandlers: {
        guidance: async ({ point }) => {
          if (point !== "agent.before_llm_call") return null;
          return {
            messageTakeover: {
              id: "harness-store-note",
              content: "store-backed takeover note",
              mode: "append",
              target: "ctx_messages",
            },
          };
        },
      },
    },
  );

  const ctx = withModelContext(
    {
      userId: "u8",
      sessionId: "s8",
      dialogProcessId: "dp8",
      agentContext: {
        bindings: {
          extensions: {
            harness: {
              planText: "1. 已有主计划",
              state: {
                flags: { planningCaptured: true, planningPromptInjected: true },
              },
            },
          },
        },
      },
    },
    {
      messageBlocks: {
        system: [],
        history: [],
        incremental: [{ role: "user", content: "real user message" }],
      },
    },
  );

  await hookManager.emit("agent.before_llm_call", ctx);

  assert.equal(ctx.modelContext.messages.length, 2);
  assert.match(String(ctx.modelContext.messages[0]?.content || ""), /harness-store-note/);
  assert.equal(ctx.modelContext.messageBlocks.system[0], ctx.modelContext.messages[0]);
  assert.equal(ctx.modelContext.messageBlocks.incremental[0], ctx.modelContext.messages[1]);
  assert.ok(ctx.modelContext.messages[0]?.additional_kwargs?.messageUid);
  assert.ok(ctx.modelContext.messages[1]?.additional_kwargs?.messageUid);
  assert.equal(ctx.modelContext.messageBlocks.systemIds, undefined);
  assert.equal(ctx.modelContext.messageBlocks.incrementalIds, undefined);
});

test("harness agent system takeover does not write ctx message store", async () => {
  const hookManager = createAgentHookManager();
  registerHarnessCore(
    { hookManager },
    {
      planningGuidanceMode: "inject",
      trace: false,
      promptPolicy: false,
      capabilityHandlers: {
        acceptance: async ({ point }) => {
          if (point !== "agent.before_tool_calls") return null;
          return {
            systemMessageTakeover: {
              id: "harness-agent-system-only",
              content: "agent system only note",
              mode: "append",
              target: "agent_system",
            },
          };
        },
      },
    },
  );

  const ctx = withModelContext(
    {
      userId: "u9",
      sessionId: "s9",
      dialogProcessId: "dp9",
      agentContext: { payload: {} },
    },
    {
      messageBlocks: {
        system: [{ role: "system", content: "existing system message" }],
        history: [],
        incremental: [{ role: "user", content: "real user message" }],
      },
    },
  );

  await hookManager.emit("agent.before_tool_calls", ctx);

  assert.equal(ctx.modelContext.messages.length, 3);
  assert.equal(ctx.modelContext.messageBlocks.incremental.length, 1);
  assert.equal(ctx.modelContext.messageBlocks.system.length, 2);
  assert.match(
    String(ctx.modelContext.messageBlocks.system[1]?.content || ""),
    /harness-agent-system-only/,
  );
});

test("harness ctx message takeover syncs store when removal dedupes injection", async () => {
  const hookManager = createAgentHookManager();
  registerHarnessCore(
    { hookManager },
    {
      planningGuidanceMode: "inject",
      trace: false,
      promptPolicy: false,
      capabilityHandlers: {
        guidance: async ({ point }) => {
          if (point !== "agent.before_llm_call") return null;
          return {
            messageTakeover: {
              removeInternalMessageTypes: ["tool_choice_required_retry_prompt"],
              id: "harness-existing-note",
              content: "existing takeover note",
              mode: "append",
              target: "ctx_messages",
            },
          };
        },
      },
    },
  );

  const existingInjected = {
    role: "user",
    content: "<!-- harness-existing-note -->\nexisting takeover note",
    injectedMessage: true,
    injectedBy: "harness-plugin",
    injectedMessageType: "harness_prompt:harness-existing-note",
  };
  const ctx = withModelContext(
    {
      userId: "u10",
      sessionId: "s10",
      dialogProcessId: "dp10",
    },
    {
      messageBlocks: {
        system: [],
        history: [],
        incremental: [
          {
            role: "user",
            content: "internal retry prompt",
            additional_kwargs: {
              noobotInternalMessageType: "tool_choice_required_retry_prompt",
            },
          },
          existingInjected,
        ],
      },
    },
  );

  await hookManager.emit("agent.before_llm_call", ctx);

  assert.equal(ctx.modelContext.messages.length, 1);
  assert.equal(ctx.modelContext.messages[0], existingInjected);
  assert.ok(ctx.modelContext.messages[0]?.additional_kwargs?.messageUid);
  assert.equal(
    ctx.modelContext.messages.some(
      (msg) =>
        msg?.additional_kwargs?.noobotInternalMessageType === "tool_choice_required_retry_prompt",
    ),
    false,
  );
});

test("harness ctx message takeover ignores id markers echoed in tool results", async () => {
  const hookManager = createAgentHookManager();
  registerHarnessCore(
    { hookManager },
    {
      planningGuidanceMode: "inject",
      trace: false,
      promptPolicy: false,
      capabilityHandlers: {
        guidance: async ({ point }) => {
          if (point !== "agent.before_llm_call") return null;
          return {
            messageTakeover: {
              id: "harness-echo-note",
              content: "echo takeover note",
              mode: "append",
              target: "ctx_messages",
            },
          };
        },
      },
    },
  );

  const toolCallMessage = {
    role: "assistant",
    content: "",
    tool_calls: [{ id: "call_echo", name: "read_file", args: {} }],
  };
  const toolResult = {
    role: "tool",
    tool_call_id: "call_echo",
    content: "file text: <!-- harness-echo-note -->",
  };
  const ctx = withModelContext(
    {
      userId: "u11",
      sessionId: "s11",
      dialogProcessId: "dp11",
      agentContext: {
        bindings: {
          extensions: {
            harness: {
              planText: "1. 已有主计划",
              state: { flags: { planningCaptured: true, planningPromptInjected: true } },
            },
          },
        },
      },
    },
    {
      messageBlocks: { system: [], history: [], incremental: [toolCallMessage, toolResult] },
    },
  );

  await hookManager.emit("agent.before_llm_call", ctx);

  const { system, incremental } = ctx.modelContext.messageBlocks;
  assert.equal(incremental.length, 2);
  assert.equal(
    system.filter((message) => isHarnessPromptMessage(message, "harness-echo-note")).length,
    1,
  );
});
