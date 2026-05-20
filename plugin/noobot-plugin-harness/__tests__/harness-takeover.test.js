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

import { createHookManager } from "../../../agent/src/system-core/hook/index.js";
import { registerNoobotPlugin } from "../src/index.js";
import { exists, waitForFile, readJsonl } from "./test-helpers.js";

test("harness capability hook can take over tool calls", async () => {
  const hookManager = createHookManager();
  registerNoobotPlugin(
    { hookManager },
    {
      trace: false,
      promptPolicy: false,
      capabilityHandlers: {
        acceptance: async ({ point }) => {
          if (point !== "before_tool_calls") return null;
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

  const ctx = {
    userId: "u4",
    sessionId: "s4",
    dialogProcessId: "dp4",
    phase: "tool_calls",
    status: "start",
    calls: [
      { name: "web_search", args: { q: "abc" } },
      { name: "request_help", args: {} },
    ],
  };

  await hookManager.emit("before_tool_calls", ctx);
  assert.equal(ctx.calls.length, 1);
  assert.equal(ctx.calls[0]?.name, "wait");
  assert.equal(ctx.calls[0]?.args?.seconds, 1);
});

test("harness capability hook can force inject system message in mid hooks", async () => {
  const hookManager = createHookManager();
  registerNoobotPlugin(
    { hookManager },
    {
      trace: false,
      promptPolicy: false,
      capabilityHandlers: {
        acceptance: async ({ point }) => {
          if (point !== "before_tool_calls") return null;
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

  const ctx = {
    userId: "u5",
    sessionId: "s5",
    dialogProcessId: "dp5",
    calls: [{ name: "wait", args: { seconds: 1 } }],
    agentContext: {
      payload: {
        messages: {
          system: [{ role: "system", content: "existing system message" }],
        },
      },
    },
  };

  await hookManager.emit("before_tool_calls", ctx);
  assert.equal(ctx.agentContext.payload.messages.system.length, 2);
  assert.match(
    String(ctx.agentContext.payload.messages.system[0]?.content || ""),
    /harness-mid-hook-guard/,
  );
});

test("harness capability hook can take over and remove agent internal forced messages", async () => {
  const hookManager = createHookManager();
  registerNoobotPlugin(
    { hookManager },
    {
      trace: false,
      promptPolicy: false,
      capabilityHandlers: {
        guidance: async ({ point }) => {
          if (point !== "before_llm_call") return null;
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

  const ctx = {
    userId: "u6",
    sessionId: "s6",
    dialogProcessId: "dp6",
    messages: [
      {
        role: "user",
        content: "internal retry prompt",
        additional_kwargs: {
          noobotInternalMessageType: "tool_choice_required_retry_prompt",
        },
      },
      { role: "user", content: "real user message" },
    ],
  };

  await hookManager.emit("before_llm_call", ctx);
  assert.equal(ctx.messages.length, 2);
  assert.match(String(ctx.messages[0]?.content || ""), /harness-replace-retry-prompt/);
  assert.equal(
    ctx.messages.some(
      (msg) => msg?.additional_kwargs?.noobotInternalMessageType === "tool_choice_required_retry_prompt",
    ),
    false,
  );
});

