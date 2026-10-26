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

import { normalizeOptions } from "../../src/core/options.js";
import {
  registerWorkflowAgentHooks,
  registerWorkflowServiceHooks,
} from "../../src/core/orchestrator.js";
import { WORKFLOW_PLUGIN_DEFAULTS } from "../../src/core/constants.js";
import { getWorkflowDefaultSemanticPrompt } from "../../src/core/i18n.js";
import { parseWorkflowDslText } from "../../src/protocol/text-protocol.js";
import {
  installTurnMessageEventRuntimeFixture,
  createTestHookInvocation,
} from "../helpers/workflow-hook-session-strategy-helper.js";

test("default semantic prompt documents closed state-node constructs", () => {
  const zh = getWorkflowDefaultSemanticPrompt("zh-CN");
  assert.match(zh, /结构约束/);
  assert.match(zh, /流程边界与并发控制状态节点必须形成闭合结构/);
  assert.match(zh, /stateType=start 与 stateType=end 作为起止边界/);
  assert.match(zh, /stateType=branch 并发分叉/);
  assert.match(zh, /stateType=merge 汇聚/);
  assert.match(zh, /branch -> actions -> merge 的闭合并发段/);
  assert.match(zh, /避免悬空 branch 或 merge/);
  assert.match(zh, /用户明确要求一个 action\/child\/node 完成多步/);
  assert.match(zh, /不得按步骤拆成多个 action/);
  assert.match(zh, /工具名、参数值、调用次数、顺序和禁止条件必须逐字保留/);

  const en = getWorkflowDefaultSemanticPrompt("en-US");
  assert.match(en, /Structural constraints/);
  assert.match(en, /must form closed constructs/);
  assert.match(en, /stateType=start and stateType=end as start\/end boundaries/);
  assert.match(en, /stateType=branch parallel split/);
  assert.match(en, /stateType=merge/);
  assert.match(en, /closed branch -> actions -> merge segment/);
  assert.match(en, /dangling branch or merge/);
  assert.match(en, /Preserve user-defined node boundaries/);
  assert.match(en, /keep every step in one action task/);
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
    async emit(point, payload, invocation) {
      const record = listeners.get(String(point || "").trim());
      if (!record || typeof record.handler !== "function") {
        return { outcomes: [], failures: [] };
      }
      const result = await record.handler(payload || {}, invocation);
      return { outcomes: [{ status: "ok", value: result }], failures: [] };
    },
  };
}

test("normalizeOptions does not carry host capabilities", () => {
  const options = normalizeOptions({
    enabled: true,
    mode: "on",
    subSessionRunner: async () => null,
  });
  assert.equal(options.mode, "on");
  assert.equal(Object.hasOwn(options, "subSessionRunner"), false);
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

test("normalizeOptions defaults workflow denyToolNames to empty", () => {
  const options = normalizeOptions({
    enabled: true,
    mode: "on",
  });
  assert.deepEqual(options.denyToolNames, []);
});

test("normalizeOptions keeps custom denyToolNames from workflow plugin config", () => {
  const options = normalizeOptions({
    enabled: true,
    mode: "on",
    denyToolNames: ["help", "", "help"],
  });
  assert.deepEqual(options.denyToolNames, ["help"]);
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

test("parseWorkflowDslText reads only task and stateType attributes", () => {
  const semantic = parseWorkflowDslText(
    [
      "WORKFLOW_DSL/1",
      'NODE id=start type=state stateType=start name="开始"',
      'NODE id=split type=state stateType=branch name="分叉"',
      'NODE id=act type=action name="节点A" taskText="别名" instruction="别名" mission="别名"',
      'NODE id=end type=state stateType=end name="结束"',
      "EDGE from=start to=split",
      "EDGE from=split to=act",
      "EDGE from=act to=end",
      "END",
    ].join("\n"),
  );
  const nodes = semantic?.nodes || [];
  const splitNode = nodes.find((item) => item?.id === "split");
  const actionNode = nodes.find((item) => item?.id === "act");
  assert.equal(Object.hasOwn(actionNode, "task"), false);
  assert.equal(Object.hasOwn(actionNode, "stateType"), false);
  assert.equal(splitNode?.stateType, "branch");
});

test("parseWorkflowDslText rejects missing or non-protocol type, stateType and name", () => {
  const build = (line) =>
    [
      "WORKFLOW_DSL/1",
      'NODE id=start type=state stateType=start name="开始"',
      line,
      'NODE id=end type=state stateType=end name="结束"',
      "EDGE from=start to=x",
      "EDGE from=x to=end",
      "END",
    ].join("\n");
  for (const line of [
    'NODE id=x type=state state=branch name="别名"',
    'NODE id=x type=state stateType=normal name="普通"',
    'NODE id=x type=state stateType=0 name="数字"',
    'NODE id=x type=action stateType=start name="动作"',
  ]) {
    assert.throws(() => parseWorkflowDslText(build(line)), /stateType/);
  }
  assert.throws(() => parseWorkflowDslText(build('NODE id=x name="缺类型"')), /type/);
  assert.throws(() => parseWorkflowDslText(build('NODE id=x type=Action name="大写"')), /type/);
  assert.throws(() => parseWorkflowDslText(build("NODE id=x type=action")), /name/);
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

test("parseWorkflowDslText keeps declared stateType without topology promotion", () => {
  const semantic = parseWorkflowDslText(
    [
      "WORKFLOW_DSL/1",
      'NODE id=start type=state stateType=start name="开始"',
      'NODE id=a type=action name="节点A" task="执行A"',
      'NODE id=b type=action name="节点B" task="执行B"',
      'NODE id=merge type=state stateType=merge name="汇聚"',
      'NODE id=end type=state stateType=end name="结束"',
      "EDGE from=start to=a",
      "EDGE from=start to=b",
      "EDGE from=a to=merge",
      "EDGE from=b to=merge",
      "EDGE from=merge to=end",
      "END",
    ].join("\n"),
  );
  const start = (semantic?.nodes || []).find((item) => String(item?.id || "") === "start");
  assert.equal(start?.stateType, "start");
});

test("parseWorkflowDslText rejects undeclared or duplicated start boundary", () => {
  const parse = (lines) =>
    parseWorkflowDslText(["WORKFLOW_DSL/1", ...lines, "END"].join("\n"), { locale: "en-US" });
  assert.throws(
    () =>
      parse([
        'NODE id=act_a type=action name="TaskA" task="do task A"',
        'NODE id=act_b type=action name="TaskB" task="do task B"',
        "EDGE from=act_a to=act_b",
      ]),
    /exactly one stateType=start/,
  );
  assert.throws(
    () =>
      parse([
        'NODE id=s1 type=state stateType=start name="S1"',
        'NODE id=s2 type=state stateType=start name="S2"',
        'NODE id=end type=state stateType=end name="End"',
        "EDGE from=s1 to=end",
        "EDGE from=s2 to=end",
      ]),
    /exactly one stateType=start/,
  );
});

const hostCapabilities = Object.freeze({
  resolveModelMessages: () => [],
  capabilityModelInvoker: async () => ({ output: { text: "" } }),
  subSessionRunner: async () => ({}),
});

test("registerWorkflowAgentHooks registers nothing when workflow is off", () => {
  const hookManager = createMockBotHookManager();
  const patches = [];
  const disposers = registerWorkflowAgentHooks({
    hookManager,
    policy: { patch: (policy) => patches.push(policy) },
    config: { enabled: true, mode: "off", denyToolNames: ["help"] },
  });
  assert.deepEqual(disposers, []);
  assert.deepEqual(patches, []);
  assert.equal(hookManager.listeners.size, 0);
});

test("registerWorkflowAgentHooks declares denyToolNames through policy.patch", () => {
  const patches = [];
  registerWorkflowAgentHooks({
    hookManager: createMockBotHookManager(),
    policy: { patch: (policy) => patches.push(policy) },
    config: { enabled: true, mode: "on", denyToolNames: ["help"], ...hostCapabilities },
  });
  assert.deepEqual(patches, [{ denyToolNames: ["help"] }]);
});

test("registerWorkflowAgentHooks requires every agent host capability", () => {
  for (const name of Object.keys(hostCapabilities)) {
    const config = { enabled: true, mode: "on", ...hostCapabilities, [name]: undefined };
    assert.throws(
      () => registerWorkflowAgentHooks({ hookManager: createMockBotHookManager(), config }),
      new RegExp(`requires host capability: ${name}`),
    );
  }
});

test("workflow hook skips when source text is empty", async () => {
  const hookManager = createMockBotHookManager();
  registerWorkflowAgentHooks({
    hookManager,
    config: { enabled: true, mode: "on", ...hostCapabilities },
  });
  const listener = hookManager.listeners.get(HOOK_POINT.BOT.BEFORE_AGENT_DISPATCH);
  assert.ok(listener?.handler);
  const outcome = await listener.handler(
    {
      userId: "u1",
      sessionId: "s1",
      dialogProcessId: "d1",
      userMessage: "",
    },
    createTestHookInvocation(),
  );
  assert.equal(outcome.disposition, "pass");
  assert.equal(outcome.owner, "workflow");
});

test("workflow hook owns the turn and never falls back to main agent when semantic resolution fails", async () => {
  const hookManager = createMockBotHookManager();
  registerWorkflowAgentHooks({
    hookManager,
    config: {
      enabled: true,
      mode: "on",
      ...hostCapabilities,
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
    createTestHookInvocation(),
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
  let childRunPayload = null;
  registerWorkflowAgentHooks({
    hookManager,
    config: {
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
    claimAgentDispatch: (claim = {}) => dispatchClaims.push(claim),
  };
  const dispatchOutcome = await listener.handler(
    installTurnMessageEventRuntimeFixture(beforeContext),
    createTestHookInvocation(),
  );
  assert.equal(dispatchClaims.length, 1);
  assert.equal(dispatchOutcome?.kind, "noobot.bot_dispatch_outcome");
  assert.equal(dispatchOutcome?.disposition, "handled");
  assert.equal(dispatchOutcome?.owner, "workflow");
  assert.equal(dispatchOutcome?.failure, null);
  assert.equal(dispatchClaims[0].owner, "workflow");
  assert.equal(dispatchClaims[0].source, "workflow_before_agent_dispatch");
  assert.deepEqual(Object.keys(dispatchClaims[0]).sort(), ["owner", "source"]);
  assert.equal(childRunPayload?.strategy?.parentExecutionId, beforeContext.runConfig.executionId);
  assert.equal(childRunPayload?.strategy?.rootExecutionId, beforeContext.runConfig.rootExecutionId);
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
  registerWorkflowServiceHooks({ hookManager, config: { enabled: true, mode: "on" } });
  const cleanupHook = hookManager.listeners.get(HOOK_POINT.SERVICE.AFTER_SESSION_DELETE);
  assert.ok(cleanupHook?.handler);

  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "workflow-plugin-cleanup-"));
  const sessionDir = path.join(tempRoot, "runtime/plugin-data/workflow/session/s-delete/wf_node_1");
  const retainedSessionDir = path.join(
    tempRoot,
    "runtime/plugin-data/workflow/session/s-keep/wf_node_2",
  );
  await fs.mkdir(sessionDir, { recursive: true });
  await fs.mkdir(retainedSessionDir, { recursive: true });
  await fs.writeFile(path.join(sessionDir, "events.jsonl"), '{"event":"ok"}\n', "utf8");
  await fs.writeFile(
    path.join(sessionDir, "meta.json"),
    JSON.stringify({ sessionId: "workflow-node-session" }),
    "utf8",
  );
  await fs.writeFile(
    path.join(retainedSessionDir, "meta.json"),
    JSON.stringify({ sessionId: "retained-workflow-node-session" }),
    "utf8",
  );
  try {
    const cleanupResult = await cleanupHook.handler({
      sessionId: "s-delete",
      deletedSessionIds: ["s-delete"],
      remainingSessionIds: ["s-keep"],
      basePath: tempRoot,
    });

    assert.deepEqual(cleanupResult.deletedRelatedSessionIds, ["workflow-node-session"]);
    assert.deepEqual(cleanupResult.retainedRelatedSessionIds, ["retained-workflow-node-session"]);
    await assert.rejects(
      fs.stat(path.join(tempRoot, "runtime/plugin-data/workflow/session/s-delete")),
    );
    await fs.stat(retainedSessionDir);
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});
