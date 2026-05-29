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

test("_createHarnessResolveModelMessages uses harness context window limit", () => {
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
    ["u2", "a2"],
  );
});
