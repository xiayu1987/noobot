import test from "node:test";
import assert from "node:assert/strict";

import { SessionExecutionEngine } from "../../../src/system-core/bot-manage/session/session-execution-engine.js";

test("_createHarnessResolveModelMessages reads dialogProcessId from execution context", () => {
  const engine = new SessionExecutionEngine({ globalConfig: {} });
  const resolver = engine._createHarnessResolveModelMessages({
    harnessOptions: { contextWindowRecentMessageLimit: 50 },
  });
  const resolved = resolver({
    messages: [
      {
        role: "user",
        content: "[来自harness外部模型输出/planning]\\nold",
        injectedMessage: true,
        injectedBy: "harness-plugin",
        dialogProcessId: "dlg_old",
      },
      {
        role: "user",
        content: "[来自harness外部模型输出/planning]\\nnew",
        injectedMessage: true,
        injectedBy: "harness-plugin",
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
    ["[来自harness外部模型输出/planning]\\nnew", "normal"],
  );
});

test("_createHarnessResolveModelMessages falls back to latest message dialogProcessId", () => {
  const engine = new SessionExecutionEngine({ globalConfig: {} });
  const resolver = engine._createHarnessResolveModelMessages({
    harnessOptions: { contextWindowRecentMessageLimit: 50 },
  });
  const resolved = resolver({
    messages: [
      {
        role: "user",
        content: "[来自harness外部模型输出/planning]\\nold",
        injectedMessage: true,
        injectedBy: "harness-plugin",
        dialogProcessId: "dlg_old",
      },
      {
        role: "user",
        content: "[来自harness外部模型输出/planning]\\nnew",
        injectedMessage: true,
        injectedBy: "harness-plugin",
        dialogProcessId: "dlg_new",
      },
      { role: "assistant", content: "normal", dialogProcessId: "dlg_new" },
    ],
    ctx: {},
  });
  assert.deepEqual(
    resolved.map((item = {}) => item.content),
    ["[来自harness外部模型输出/planning]\\nnew", "normal"],
  );
});

test("_createHarnessResolveModelMessages no longer clips agent context to harness context window limit", () => {
  const engine = new SessionExecutionEngine({ globalConfig: {} });
  const resolver = engine._createHarnessResolveModelMessages({
    harnessOptions: { contextWindowRecentMessageLimit: 2 },
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


test("_createHarnessResolveModelMessages uses main-flow blocks when available", () => {
  const engine = new SessionExecutionEngine({ globalConfig: {} });
  const resolver = engine._createHarnessResolveModelMessages({
    harnessOptions: { contextWindowRecentMessageLimit: 2 },
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
    ["sys", "u1-first", "a1-latest", "inc1", "inc2"],
  );
});

test("_createHarnessResolveModelMessages does not mutate source messages or messageBlocks when unsummarized", () => {
  const engine = new SessionExecutionEngine({ globalConfig: {} });
  const resolver = engine._createHarnessResolveModelMessages({ harnessOptions: {} });
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
