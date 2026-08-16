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
import { HOOK_POINT } from "@noobot/hook-protocol";

import { DEFAULT_WORKFLOW_DENY_TOOL_NAMES, normalizeOptions } from "../../src/core/options.js";
import { createWorkflowRegistration } from "../../src/core/plugin.js";
import { createRegisterWorkflowHooks } from "../../src/core/hooks.js";
import { PLUGIN_NAME, WORKFLOW_PLUGIN_DEFAULTS } from "../../src/core/constants.js";
import { getWorkflowDefaultSemanticPrompt } from "../../src/core/i18n.js";
import { parseWorkflowDslText } from "../../src/protocol/text-protocol.js";
import { installTurnMessageEventRuntimeFixture } from "../helpers/workflow-hook-session-strategy-helper.js";

test("default semantic prompt documents closed state-node constructs", () => {
  const zh = getWorkflowDefaultSemanticPrompt("zh-CN");
  assert.match(zh, /结构约束/);
  assert.match(zh, /流程边界与并发控制状态节点必须形成闭合结构/);
  assert.match(zh, /stateType=start 与 stateType=end 作为起止边界/);
  assert.match(zh, /stateType=branch 并发分叉/);
  assert.match(zh, /stateType=merge 汇聚/);
  assert.match(zh, /branch -> actions -> merge 的闭合并发段/);
  assert.match(zh, /避免悬空 branch 或 merge/);
  assert.match(zh, /工具名、参数值、调用次数、顺序和禁止条件必须逐字保留/);

  const en = getWorkflowDefaultSemanticPrompt("en-US");
  assert.match(en, /Structural constraints/);
  assert.match(en, /must form closed constructs/);
  assert.match(en, /stateType=start and stateType=end as start\/end boundaries/);
  assert.match(en, /stateType=branch parallel split/);
  assert.match(en, /stateType=merge/);
  assert.match(en, /closed branch -> actions -> merge segment/);
  assert.match(en, /dangling branch or merge/);
  assert.match(en, /tool names, argument values, call counts, ordering, and prohibitions/);
  assert.match(en, /preserved verbatim/);
});

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
        return { outcomes: [], failures: [] };
      }
      const result = await record.handler(payload || {});
      return { outcomes: [{ status: "ok", value: result }], failures: [] };
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

test("normalizeOptions keeps workflow extension hooks", () => {
  const workflowExtensionMounter = () => undefined;
  const extensionA = () => undefined;
  const extensionB = () => undefined;
  const options = normalizeOptions({
    enabled: true,
    mode: "on",
    workflowExtensionMounter,
    workflowExtensions: [extensionA, null, "x", extensionB],
  });
  assert.equal(options.workflowExtensionMounter, workflowExtensionMounter);
  assert.deepEqual(options.workflowExtensions, [extensionA, extensionB]);
});

test("normalizeOptions applies workflow execution defaults", () => {
  const options = normalizeOptions({
    enabled: true,
    mode: "on",
  });
  assert.equal(options.timeoutMs, WORKFLOW_PLUGIN_DEFAULTS.DEFAULT_TIMEOUT_MS);
  assert.equal(options.maxAutoTransitions, WORKFLOW_PLUGIN_DEFAULTS.DEFAULT_MAX_AUTO_TRANSITIONS);
  assert.equal(
    options.maxParallelNodeAgents,
    WORKFLOW_PLUGIN_DEFAULTS.DEFAULT_MAX_PARALLEL_NODE_AGENTS,
  );
  assert.equal(options.miniRunnerMaxTurns, WORKFLOW_PLUGIN_DEFAULTS.DEFAULT_MINI_RUNNER_MAX_TURNS);
});

test("normalizeOptions keeps valid workflow execution overrides", () => {
  const options = normalizeOptions({
    enabled: true,
    mode: "on",
    timeoutMs: 12345,
    maxAutoTransitions: 6,
    maxParallelNodeAgents: 2,
    miniRunnerMaxTurns: 1,
  });
  assert.equal(options.timeoutMs, 12345);
  assert.equal(options.maxAutoTransitions, 6);
  assert.equal(options.maxParallelNodeAgents, 2);
  assert.equal(options.miniRunnerMaxTurns, 1);
});

test("normalizeOptions provides default workflow denyToolNames", () => {
  const options = normalizeOptions({
    enabled: true,
    mode: "on",
  });
  assert.deepEqual(options.denyToolNames, [...DEFAULT_WORKFLOW_DENY_TOOL_NAMES]);
});

test("normalizeOptions keeps custom denyToolNames from workflow plugin config", () => {
  const options = normalizeOptions({
    enabled: true,
    mode: "on",
    denyToolNames: ["request_help", "", "request_help"],
  });
  assert.deepEqual(options.denyToolNames, ["request_help"]);
});

test("parseWorkflowDslText keeps action node task field", () => {
  const semantic = parseWorkflowDslText(
    [
      "WORKFLOW_DSL/1",
      'NODE id=start type=state stateType=start name="开始"',
      'NODE id=act type=action name="节点A" task="请输出节点A完成"',
      'NODE id=end type=state stateType=end name="结束"',
      "EDGE from=start to=act",
      "EDGE from=act to=end",
      "END",
    ].join("\n"),
  );
  const actionNode = (semantic?.nodes || []).find((item) => String(item?.id || "") === "act");
  assert.equal(actionNode?.task, "请输出节点A完成");
});

test("parseWorkflowDslText keeps quoted task when value contains spaces", () => {
  const semantic = parseWorkflowDslText(
    [
      "WORKFLOW_DSL/1",
      'NODE id=start type=state stateType=start name="开始"',
      'NODE id=act type=action name="节点A" task="编写新增表单页面组件，使用Element Plus的表单组件实现表单新增功能，并配置登录成功后的路由跳转"',
      'NODE id=end type=state stateType=end name="结束"',
      "EDGE from=start to=act",
      "EDGE from=act to=end",
      "END",
    ].join("\n"),
  );
  const actionNode = (semantic?.nodes || []).find((item) => String(item?.id || "") === "act");
  assert.equal(
    actionNode?.task,
    "编写新增表单页面组件，使用Element Plus的表单组件实现表单新增功能，并配置登录成功后的路由跳转",
  );
});

test("parseWorkflowDslText keeps action node attachment refs", () => {
  const semantic = parseWorkflowDslText(
    [
      "WORKFLOW_DSL/1",
      'NODE id=start type=state stateType=start name="开始"',
      'NODE id=act type=action name="节点A" task="请分析附件" attachments="attachment:v1:session-1/user/att-1"',
      'NODE id=end type=state stateType=end name="结束"',
      "EDGE from=start to=act",
      "EDGE from=act to=end",
      "END",
    ].join("\n"),
  );
  const actionNode = (semantic?.nodes || []).find((item) => String(item?.id || "") === "act");
  assert.deepEqual(actionNode?.attachments, ["attachment:v1:session-1/user/att-1"]);
  assert.equal(semantic?.attachments, undefined);
  assert.equal(semantic?.attachmentMap, undefined);
});

test("parseWorkflowDslText rejects removed attachment declarations", () => {
  assert.throws(
    () =>
      parseWorkflowDslText(
        [
          "WORKFLOW_DSL/1",
          'ATTACHMENT id="local-contract" attachmentId="att-1" sessionId="session-1" attachmentSource="user"',
          'NODE id=start type=state stateType=start name="开始"',
          'NODE id=end type=state stateType=end name="结束"',
          "EDGE from=start to=end",
          "END",
        ].join("\n"),
      ),
    /unknown command: ATTACHMENT/,
  );
});

test("parseWorkflowDslText rejects composite nodes", () => {
  assert.throws(
    () =>
      parseWorkflowDslText(
        [
          "WORKFLOW_DSL/1",
          'NODE id=start type=state stateType=start name="开始"',
          'NODE id=sub type=composite name="子流程"',
          'NODE id=end type=state stateType=end name="结束"',
          "EDGE from=start to=sub",
          "EDGE from=sub to=end",
          "END",
        ].join("\n"),
      ),
    /NODE type must be state\/action/,
  );
});

test("parseWorkflowDslText rejects edge conditions", () => {
  assert.throws(
    () =>
      parseWorkflowDslText(
        [
          "WORKFLOW_DSL/1",
          'NODE id=start type=state stateType=start name="开始"',
          'NODE id=act type=action name="节点A" task="执行A"',
          'NODE id=end type=state stateType=end name="结束"',
          'EDGE from=start to=act when="always"',
          "EDGE from=act to=end",
          "END",
        ].join("\n"),
      ),
    /EDGE condition is not supported/,
  );
});

test("parseWorkflowDslText returns zh-CN error message when locale is zh-CN", () => {
  assert.throws(
    () =>
      parseWorkflowDslText(
        [
          "WORKFLOW_DSL/1",
          'NODE id=start type=state stateType=start name="开始"',
          'NODE id=sub type=composite name="子流程"',
          'NODE id=end type=state stateType=end name="结束"',
          "EDGE from=start to=sub",
          "EDGE from=sub to=end",
          "END",
        ].join("\n"),
        { locale: "zh-CN" },
      ),
    /NODE type 必须是 state\/action/,
  );
});

test("parseWorkflowDslText returns en-US error message by default", () => {
  assert.throws(
    () =>
      parseWorkflowDslText(
        [
          "WORKFLOW_DSL/1",
          'NODE id=start type=state stateType=start name="开始"',
          'NODE id=sub type=composite name="子流程"',
          'NODE id=end type=state stateType=end name="结束"',
          "EDGE from=start to=sub",
          "EDGE from=sub to=end",
          "END",
        ].join("\n"),
      ),
    /NODE type must be state\/action/,
  );
});

test("parseWorkflowDslText normalizes multi-outgoing start as branch", () => {
  const semantic = parseWorkflowDslText(
    [
      "WORKFLOW_DSL/1",
      'NODE id=start type=state stateType=start name="开始"',
      'NODE id=a type=action name="节点A" task="执行A"',
      'NODE id=b type=action name="节点B" task="执行B"',
      'NODE id=merge type=state stateType=merge name="汇聚"',
      "EDGE from=start to=a",
      "EDGE from=start to=b",
      "EDGE from=a to=merge",
      "EDGE from=b to=merge",
      "END",
    ].join("\n"),
  );
  const start = (semantic?.nodes || []).find((item) => String(item?.id || "") === "start");
  assert.equal(start?.stateType, 2);
});

test("parseWorkflowDslText injects locale-aware default start/end names", () => {
  const semantic = parseWorkflowDslText(
    [
      "WORKFLOW_DSL/1",
      'NODE id=act_a type=action name="TaskA" task="do task A"',
      'NODE id=act_b type=action name="TaskB" task="do task B"',
      "EDGE from=act_a to=act_b",
      "END",
    ].join("\n"),
    { locale: "en-US" },
  );
  const start = (semantic?.nodes || []).find((item) => String(item?.id || "") === "start");
  const end = (semantic?.nodes || []).find((item) => String(item?.id || "") === "end");
  assert.equal(start?.name, "Start");
  assert.equal(end?.name, "End");
});

test("createWorkflowRegistration returns empty disposers when workflow disabled", () => {
  const registerWorkflowCore = createWorkflowRegistration({
    createPluginRuntimeContext: () => ({
      options: { enabled: false, mode: "off" },
      hookManager: { on() {} },
    }),
  });
  const result = registerWorkflowCore({}, {});
  assert.equal(result?.name, PLUGIN_NAME);
  assert.deepEqual(result?.disposers || [], []);
});

test("createWorkflowRegistration declares denyToolNames through policy.patch", () => {
  const registerWorkflowCore = createWorkflowRegistration({
    createPluginRuntimeContext: () => ({
      options: {
        enabled: true,
        mode: "on",
        denyToolNames: ["delegate_task_async"],
      },
      hookManager: createMockBotHookManager(),
    }),
    assertHookManager: () => {},
    registerWorkflowHooks: () => [],
  });
  const calls = [];
  const result = registerWorkflowCore({
    policy: {
      patch: (policy = {}) => calls.push(policy),
    },
  });

  assert.equal(result?.name, PLUGIN_NAME);
  assert.deepEqual(calls, [{ denyToolNames: ["delegate_task_async"] }]);
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
  const listener = hookManager.listeners.get(HOOK_POINT.BOT.BEFORE_AGENT_DISPATCH);
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

test("workflow hook owns the turn and never falls back to main agent when semantic resolution fails", async () => {
  const hookManager = createMockBotHookManager();
  const registerWorkflowHooks = createRegisterWorkflowHooks();
  registerWorkflowHooks({
    hookManager,
    options: {
      enabled: true,
      mode: "on",
      resolveModelMessages: () => [],
      capabilityModelInvoker: async () => {
        throw new Error("semantic explode");
      },
    },
  });
  const listener = hookManager.listeners.get(HOOK_POINT.BOT.BEFORE_AGENT_DISPATCH);
  assert.ok(listener?.handler);
  const dispatchClaims = [];
  const beforeContext = {
    userId: "u1",
    sessionId: "s1",
    dialogProcessId: "d1",
    userMessage: "main output",
    runConfig: { locale: "zh-CN" },
    claimAgentDispatch: (claim = {}) => dispatchClaims.push(claim),
  };
  const dispatchOutcome = await listener.handler(
    installTurnMessageEventRuntimeFixture(beforeContext),
  );
  assert.equal(dispatchClaims.length, 1);
  assert.equal(dispatchOutcome?.kind, "noobot.bot_dispatch_outcome");
  assert.equal(dispatchOutcome?.disposition, "handled");
  assert.equal(dispatchOutcome?.owner, "workflow");
  assert.equal(dispatchOutcome?.failure?.code, "WORKFLOW_EXECUTION_FAILED");
  assert.equal(dispatchClaims[0].owner, "workflow");
  assert.equal(dispatchClaims[0].source, "workflow_before_agent_dispatch");
  assert.equal(Object.hasOwn(dispatchOutcome || {}, "result"), false);
  assert.match(String(dispatchOutcome?.failure?.message || ""), /semantic explode/);
});

test("workflow hook in before_agent_dispatch mode can request skipping main agent dispatch", async () => {
  const hookManager = createMockBotHookManager();
  const registerWorkflowHooks = createRegisterWorkflowHooks();
  let childRunPayload = null;
  registerWorkflowHooks({
    hookManager,
    options: {
      enabled: true,
      mode: "on",
      resolveModelMessages: () => [],
      capabilityModelInvoker: async () => ({
        output: {
          text: [
            "WORKFLOW_DSL/1",
            'NODE id=start type=state stateType=start name="开始"',
            'NODE id=act type=action name="节点A"',
            'NODE id=end type=state stateType=end name="结束"',
            "EDGE from=start to=act",
            "EDGE from=act to=end",
            "END",
          ].join("\n"),
        },
      }),
      subSessionRunner: async (payload = {}) => {
        childRunPayload = payload;
        return {
          sessionId: "workflow-core-child",
          lifecycle: {
            executionId: payload?.strategy?.executionId,
            executionKind: "agent",
            state: "completed",
            revision: 4,
            sequence: 4,
          },
          result: { messages: [{ role: "assistant", content: "done" }] },
        };
      },
    },
  });
  const listener = hookManager.listeners.get(HOOK_POINT.BOT.BEFORE_AGENT_DISPATCH);
  assert.ok(listener?.handler);
  const dispatchClaims = [];
  const beforeContext = {
    userId: "u1",
    sessionId: "s1",
    dialogProcessId: "d1",
    userMessage: "请规划一个流程",
    agentResult: null,
    claimAgentDispatch: (claim = {}) => dispatchClaims.push(claim),
  };
  const dispatchOutcome = await listener.handler(
    installTurnMessageEventRuntimeFixture(beforeContext),
  );
  assert.equal(dispatchClaims.length, 1);
  assert.equal(dispatchOutcome?.kind, "noobot.bot_dispatch_outcome");
  assert.equal(dispatchOutcome?.disposition, "handled");
  assert.equal(dispatchOutcome?.owner, "workflow");
  assert.equal(dispatchOutcome?.failure, null);
  assert.equal(dispatchClaims[0].owner, "workflow");
  assert.equal(dispatchClaims[0].source, "workflow_before_agent_dispatch");
  assert.equal(
    dispatchClaims[0].executionId,
    `workflow:${dispatchClaims[0].origin?.workflowRunId}`,
  );
  assert.equal(dispatchClaims[0].rootExecutionId, dispatchClaims[0].executionId);
  assert.equal(childRunPayload?.strategy?.parentExecutionId, dispatchClaims[0].executionId);
  assert.equal(childRunPayload?.strategy?.rootExecutionId, dispatchClaims[0].rootExecutionId);
  assert.equal(dispatchClaims[0].executionKind, "workflow");
  assert.equal(dispatchClaims[0].stage, "planning");
  assert.equal(dispatchClaims[0].origin?.type, "workflow");
  assert.equal(
    dispatchClaims[0].origin?.workflowRunId,
    dispatchClaims[0].origin?.workflowRunId?.trim(),
  );
  assert.ok(dispatchClaims[0].origin?.workflowRunId);
  assert.ok(dispatchOutcome?.result);
  assert.equal(Array.isArray(dispatchOutcome?.result?.turnMessages), true);
  assert.equal(
    dispatchOutcome.result.turnMessages.some(
      (item) => item?.pluginMessage === true && item?.pluginMeta?.kind === "workflow",
    ),
    true,
  );
});

test("workflow plugin cleans workflow runtime dirs when session is deleted", async () => {
  const hookManager = createMockBotHookManager();
  const registerWorkflowHooks = createRegisterWorkflowHooks();
  registerWorkflowHooks({
    hookManager,
    options: {
      enabled: true,
      mode: "on",
    },
  });
  const cleanupHook = hookManager.listeners.get(HOOK_POINT.SERVICE.AFTER_SESSION_DELETE);
  assert.ok(cleanupHook?.handler);

  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "workflow-plugin-cleanup-"));
  const planningDir = path.join(tempRoot, "runtime/workflow/planning/s-delete/dialog-1");
  const sessionDir = path.join(tempRoot, "runtime/workflow/session/s-delete/wf_node_1");
  const untouchedDir = path.join(tempRoot, "runtime/workflow/planning/s-keep/dialog-2");
  await fs.mkdir(planningDir, { recursive: true });
  await fs.mkdir(sessionDir, { recursive: true });
  await fs.mkdir(untouchedDir, { recursive: true });
  await fs.writeFile(path.join(planningDir, "planning.json"), '{"ok":true}\n', "utf8");
  await fs.writeFile(path.join(sessionDir, "events.jsonl"), '{"event":"ok"}\n', "utf8");
  await fs.writeFile(path.join(untouchedDir, "planning.json"), '{"keep":true}\n', "utf8");

  try {
    await cleanupHook.handler({
      sessionId: "s-delete",
      deletedSessionIds: ["s-delete"],
      basePath: tempRoot,
    });

    await assert.rejects(fs.stat(path.join(tempRoot, "runtime/workflow/planning/s-delete")));
    await assert.rejects(fs.stat(path.join(tempRoot, "runtime/workflow/session/s-delete")));
    await fs.stat(path.join(tempRoot, "runtime/workflow/planning/s-keep"));
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});
