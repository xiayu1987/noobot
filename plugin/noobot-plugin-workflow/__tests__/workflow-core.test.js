/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";

import { normalizeOptions } from "../src/core/options.js";
import { createRegisterNoobotPlugin } from "../src/core/plugin.js";
import { createRegisterWorkflowHooks } from "../src/core/hooks.js";
import { PLUGIN_NAME, WORKFLOW_BOT_HOOK_POINTS } from "../src/core/constants.js";
import { parseWorkflowDslText } from "../src/protocol/text-protocol.js";

function createMockBotHookManager() {
  const listeners = new Map();
  return {
    listeners,
    on(point, handler, options = {}) {
      listeners.set(String(point || "").trim(), { handler, options });
      return () => listeners.delete(String(point || "").trim());
    },
    async emit(point, payload) {
      const record = listeners.get(String(point || "").trim());
      if (!record || typeof record.handler !== "function") {
        return { results: [], errors: [] };
      }
      const result = await record.handler(payload || {});
      return { results: [{ ok: true, result }], errors: [] };
    },
  };
}

test("normalizeOptions keeps injected strategy functions", () => {
  const subSessionRunner = async () => null;
  const workflowDialogPersister = async () => null;
  const workflowEventLogger = async () => null;
  const options = normalizeOptions({
    enabled: true,
    mode: "on",
    subSessionRunner,
    workflowDialogPersister,
    workflowEventLogger,
  });
  assert.equal(options.enabled, true);
  assert.equal(options.mode, "on");
  assert.equal(options.subSessionRunner, subSessionRunner);
  assert.equal(options.workflowDialogPersister, workflowDialogPersister);
  assert.equal(options.workflowEventLogger, workflowEventLogger);
});

test("parseWorkflowDslText keeps action node task field", () => {
  const semantic = parseWorkflowDslText(
    [
      "WORKFLOW_DSL/1",
      'NODE id=start type=state stateType=start name="开始"',
      'NODE id=act type=action name="节点A" task="请输出节点A完成"',
      'NODE id=end type=state stateType=end name="结束"',
      "EDGE from=start to=act when=\"always\"",
      "EDGE from=act to=end when=\"always\"",
      "END",
    ].join("\n"),
  );
  const actionNode = (semantic?.nodes || []).find((item) => String(item?.id || "") === "act");
  assert.equal(actionNode?.task, "请输出节点A完成");
});

test("createRegisterNoobotPlugin returns empty disposers when workflow disabled", () => {
  const registerNoobotPlugin = createRegisterNoobotPlugin({
    createPluginRuntimeContext: () => ({
      options: { enabled: false, mode: "off" },
      hookManager: { on() {} },
    }),
  });
  const result = registerNoobotPlugin({}, {});
  assert.equal(result?.name, PLUGIN_NAME);
  assert.deepEqual(result?.disposers || [], []);
});

test("workflow hook skips when source text is empty", async () => {
  const hookManager = createMockBotHookManager();
  const registerWorkflowHooks = createRegisterWorkflowHooks();
  registerWorkflowHooks({
    hookManager,
    options: {
      enabled: true,
      mode: "on",
    },
  });
  const listener = hookManager.listeners.get(WORKFLOW_BOT_HOOK_POINTS.BEFORE_AGENT_DISPATCH);
  assert.ok(listener?.handler);
  const agentResult = { output: "", traces: [] };
  await listener.handler({
    userId: "u1",
    sessionId: "s1",
    dialogProcessId: "d1",
    userMessage: "",
    agentResult,
  });
  assert.equal(agentResult.workflow, undefined);
  assert.equal(Array.isArray(agentResult.traces), true);
  assert.equal(agentResult.traces.length, 0);
});

test("workflow hook falls back to main agent when semantic resolution throws in before-dispatch", async () => {
  const hookManager = createMockBotHookManager();
  const registerWorkflowHooks = createRegisterWorkflowHooks();
  registerWorkflowHooks({
    hookManager,
    options: {
      enabled: true,
      mode: "on",
      capabilityModelInvoker: async () => {
        throw new Error("semantic explode");
      },
    },
  });
  const listener = hookManager.listeners.get(WORKFLOW_BOT_HOOK_POINTS.BEFORE_AGENT_DISPATCH);
  assert.ok(listener?.handler);
  const beforeContext = {
    userId: "u1",
    sessionId: "s1",
    dialogProcessId: "d1",
    userMessage: "main output",
    runConfig: { locale: "zh-CN" },
  };
  await listener.handler(beforeContext);
  assert.equal(beforeContext.skipAgentDispatch, false);
  assert.equal(beforeContext.overrideAgentResult, null);
  assert.equal(beforeContext.workflowFallbackToMainAgent, true);
});

test("workflow hook in before_agent_dispatch mode can request skipping main agent dispatch", async () => {
  const hookManager = createMockBotHookManager();
  const registerWorkflowHooks = createRegisterWorkflowHooks();
  registerWorkflowHooks({
    hookManager,
    options: {
      enabled: true,
      mode: "on",
      capabilityModelInvoker: async () => ({
        output: [
          "WORKFLOW_DSL/1",
          'NODE id=start type=state stateType=start name="开始"',
          'NODE id=act type=action name="节点A"',
          'NODE id=end type=state stateType=end name="结束"',
          'EDGE from=start to=act when="always"',
          'EDGE from=act to=end when="always"',
          "END",
        ].join("\n"),
      }),
    },
  });
  const listener = hookManager.listeners.get(WORKFLOW_BOT_HOOK_POINTS.BEFORE_AGENT_DISPATCH);
  assert.ok(listener?.handler);
  const beforeContext = {
    userId: "u1",
    sessionId: "s1",
    dialogProcessId: "d1",
    userMessage: "请规划一个流程",
    agentResult: null,
  };
  await listener.handler(beforeContext);
  assert.equal(beforeContext.skipAgentDispatch, true);
  assert.ok(beforeContext.overrideAgentResult);
  assert.equal(Array.isArray(beforeContext.overrideAgentResult?.turnMessages), true);
  assert.equal(
    beforeContext.overrideAgentResult.turnMessages.some(
      (item) => item?.workflowMessage === true,
    ),
    true,
  );
});
