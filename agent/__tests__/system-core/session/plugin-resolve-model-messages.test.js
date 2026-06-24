import test from "node:test";
import assert from "node:assert/strict";

import { SessionExecutionEngine } from "../../../src/system-core/bot-manage/session/session-execution-engine.js";

test("_createPluginResolveModelMessages reads dialogProcessId from execution context", () => {
  const engine = new SessionExecutionEngine({ globalConfig: {} });
  const resolver = engine._createPluginResolveModelMessages({
    agentPluginOptions: { contextWindowRecentMessageLimit: 50 },
  });
  const resolved = resolver({
    messages: [
      {
        role: "user",
        content: "[agent-plugin-relay/planning]\\nold",
        injectedMessage: true,
        injectedBy: "agent-plugin",
        injectedMessageType: "planning_relay",
        dialogProcessId: "dlg_old",
      },
      {
        role: "user",
        content: "[agent-plugin-relay/planning]\\nnew",
        injectedMessage: true,
        injectedBy: "agent-plugin",
        injectedMessageType: "planning_relay",
        dialogProcessId: "dlg_new",
      },
      { role: "assistant", content: "normal" },
    ],
    ctx: {
      agentContext: {
        execution: {
          dialogProcessId: "dlg_new",
        },
      },
    },
  });
  assert.deepEqual(
    resolved.map((item = {}) => item.content),
    ["[agent-plugin-relay/planning]\\nnew", "normal"],
  );
});

test("_createPluginResolveModelMessages falls back to latest message dialogProcessId", () => {
  const engine = new SessionExecutionEngine({ globalConfig: {} });
  const resolver = engine._createPluginResolveModelMessages({
    agentPluginOptions: { contextWindowRecentMessageLimit: 50 },
  });
  const resolved = resolver({
    messages: [
      {
        role: "user",
        content: "[agent-plugin-relay/planning]\\nold",
        injectedMessage: true,
        injectedBy: "agent-plugin",
        injectedMessageType: "planning_relay",
        dialogProcessId: "dlg_old",
      },
      {
        role: "user",
        content: "[agent-plugin-relay/planning]\\nnew",
        injectedMessage: true,
        injectedBy: "agent-plugin",
        injectedMessageType: "planning_relay",
        dialogProcessId: "dlg_new",
      },
      { role: "assistant", content: "normal", dialogProcessId: "dlg_new" },
    ],
    ctx: {},
  });
  assert.deepEqual(
    resolved.map((item = {}) => item.content),
    ["[agent-plugin-relay/planning]\\nnew", "normal"],
  );
});

test("_createPluginResolveModelMessages accepts agentPluginOptions payload", () => {
  const engine = new SessionExecutionEngine({ globalConfig: {} });
  const resolver = engine._createPluginResolveModelMessages({
    agentPluginOptions: { contextWindowRecentMessageLimit: 1 },
  });

  const resolved = resolver({
    messages: [
      { role: "user", content: "legacy-compatible", dialogProcessId: "dlg_legacy" },
    ],
    ctx: {
      agentContext: {
        execution: {
          dialogProcessId: "dlg_legacy",
        },
      },
    },
  });

  assert.deepEqual(
    resolved.map((item = {}) => item.content),
    ["legacy-compatible"],
  );
});

test("_createPluginResolveModelMessages no longer clips agent context to plugin context window limit", () => {
  const engine = new SessionExecutionEngine({ globalConfig: {} });
  const resolver = engine._createPluginResolveModelMessages({
    agentPluginOptions: { contextWindowRecentMessageLimit: 2 },
  });
  const resolved = resolver({
    messages: [
      { role: "user", content: "u1", dialogProcessId: "dlg_new" },
      { role: "assistant", content: "a1", dialogProcessId: "dlg_new" },
      { role: "user", content: "u2", dialogProcessId: "dlg_new" },
      { role: "assistant", content: "a2", dialogProcessId: "dlg_new" },
    ],
    ctx: {
      agentContext: {
        execution: {
          dialogProcessId: "dlg_new",
        },
      },
    },
  });
  assert.deepEqual(
    resolved.map((item = {}) => item.content),
    ["u1", "a1", "u2", "a2"],
  );
});


test("_createPluginResolveModelMessages uses main-flow blocks when available", () => {
  const engine = new SessionExecutionEngine({ globalConfig: {} });
  const resolver = engine._createPluginResolveModelMessages({
    agentPluginOptions: { contextWindowRecentMessageLimit: 2 },
  });
  const resolved = resolver({
    messages: [],
    ctx: {
      messageBlocks: {
        system: [{ role: "system", content: "sys" }],
        history: [
          { role: "user", content: "u1-first", dialogProcessId: "d1" },
          { role: "user", content: "u1-second", dialogProcessId: "d1" },
          { role: "assistant", content: "a1-old", dialogProcessId: "d1" },
          { role: "assistant", content: "a1-latest", dialogProcessId: "d1" },
        ],
        incremental: [
          { role: "user", content: "inc1" },
          { role: "assistant", content: "drop", summarized: true },
          { role: "assistant", content: "inc2" },
        ],
      },
    },
  });

  assert.deepEqual(
    resolved.map((item = {}) => item.content),
    ["sys", "u1-first", "u1-second", "a1-old", "a1-latest", "inc1", "inc2"],
  );
});

test("_createPluginResolveModelMessages does not mutate source messages or messageBlocks when unsummarized", () => {
  const engine = new SessionExecutionEngine({ globalConfig: {} });
  const resolver = engine._createPluginResolveModelMessages({ agentPluginOptions: {} });
  const ctx = {
    messages: [
      { role: "system", content: "ctx-sys" },
      { role: "user", content: "ctx-u" },
    ],
    messageBlocks: {
      system: [{ role: "system", content: "sys" }],
      history: [
        { role: "user", content: "u1", dialogProcessId: "d1" },
        { role: "assistant", content: "a1", dialogProcessId: "d1" },
        { role: "user", content: "u2", dialogProcessId: "d2" },
        { role: "assistant", content: "a2", dialogProcessId: "d2" },
      ],
      incremental: [
        { role: "user", content: "current", dialogProcessId: "d3" },
        { role: "assistant", content: "current-a", dialogProcessId: "d3" },
      ],
    },
  };
  const before = JSON.stringify(ctx);

  const resolved = resolver({ ctx });

  assert.deepEqual(
    resolved.map((item = {}) => item.content),
    ["sys", "u1", "a1", "u2", "a2", "current", "current-a"],
  );
  assert.equal(JSON.stringify(ctx), before);
  assert.deepEqual(ctx.messageBlocks.history.map((item) => item.content), ["u1", "a1", "u2", "a2"]);
  assert.equal(ctx.messageBlocks.history.length, 4);
  assert.deepEqual(ctx.messageBlocks.incremental.map((item) => item.content), ["current", "current-a"]);
  assert.equal(ctx.messageBlocks.incremental.length, 2);
});
