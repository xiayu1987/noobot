/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import { createModelContext } from "@noobot/context-protocol";

import { SessionExecutionEngine } from "../../src/bot/session/session-execution-engine.js";

test("_createPluginResolveModelMessages uses authoritative modelContext blocks", () => {
  const engine = new SessionExecutionEngine({ globalConfig: {} });
  const resolver = engine._createPluginResolveModelMessages();
  const resolved = resolver({
    ctx: { modelContext: createModelContext({ messageBlocks: {
      system: [],
      history: [],
      incremental: [
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
    } }) },
  });
  assert.deepEqual(
    resolved.map((item = {}) => item.content),
    ["[agent-plugin-relay/planning]\\nold", "[agent-plugin-relay/planning]\\nnew", "normal"],
  );
});

test("_createPluginResolveModelMessages keeps unsummarized injected blocks append-only", () => {
  const engine = new SessionExecutionEngine({ globalConfig: {} });
  const resolver = engine._createPluginResolveModelMessages();
  const resolved = resolver({
    ctx: { modelContext: createModelContext({ messageBlocks: {
      system: [], history: [], incremental: [
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
    } }) },
  });
  assert.deepEqual(
    resolved.map((item = {}) => item.content),
    ["[agent-plugin-relay/planning]\\nold", "[agent-plugin-relay/planning]\\nnew", "normal"],
  );
});

test("_createPluginResolveModelMessages accepts a versioned modelContext", () => {
  const engine = new SessionExecutionEngine({ globalConfig: {} });
  const resolver = engine._createPluginResolveModelMessages();

  const resolved = resolver({
    ctx: { modelContext: createModelContext({ messageBlocks: {
      system: [], history: [],
      incremental: [{ role: "user", content: "protocol-compatible", dialogProcessId: "dlg" }],
    } }) },
  });

  assert.deepEqual(
    resolved.map((item = {}) => item.content),
    ["protocol-compatible"],
  );
});

test("_createPluginResolveModelMessages no longer clips agent context to plugin context window limit", () => {
  const engine = new SessionExecutionEngine({ globalConfig: {} });
  const resolver = engine._createPluginResolveModelMessages();
  const resolved = resolver({
    ctx: { modelContext: createModelContext({ messageBlocks: {
      system: [], history: [], incremental: [
      { role: "user", content: "u1", dialogProcessId: "dlg_new" },
      { role: "assistant", content: "a1", dialogProcessId: "dlg_new" },
      { role: "user", content: "u2", dialogProcessId: "dlg_new" },
      { role: "assistant", content: "a2", dialogProcessId: "dlg_new" },
      ],
    } }) },
  });
  assert.deepEqual(
    resolved.map((item = {}) => item.content),
    ["u1", "a1", "u2", "a2"],
  );
});


test("_createPluginResolveModelMessages uses main-flow blocks when available", () => {
  const engine = new SessionExecutionEngine({ globalConfig: {} });
  const resolver = engine._createPluginResolveModelMessages();
  const resolved = resolver({
    ctx: {
      modelContext: createModelContext({ messageBlocks: {
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
      } }),
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
    modelContext: createModelContext({ messageBlocks: {
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
    } }),
  };
  const before = JSON.stringify(ctx);

  const resolved = resolver({ ctx });

  assert.deepEqual(
    resolved.map((item = {}) => item.content),
    ["sys", "u1", "a1", "u2", "a2", "current", "current-a"],
  );
  assert.equal(JSON.stringify(ctx), before);
  assert.deepEqual(ctx.modelContext.messageBlocks.history.map((item) => item.content), ["u1", "a1", "u2", "a2"]);
  assert.equal(ctx.modelContext.messageBlocks.history.length, 4);
  assert.deepEqual(ctx.modelContext.messageBlocks.incremental.map((item) => item.content), ["current", "current-a"]);
  assert.equal(ctx.modelContext.messageBlocks.incremental.length, 2);
});
