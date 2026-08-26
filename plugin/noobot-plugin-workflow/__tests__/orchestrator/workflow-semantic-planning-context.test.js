/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import { createModelContext } from "@noobot/context-protocol";
import { HOOK_POINT } from "@noobot/hook-protocol";
import { resolveWorkflowSemanticContextMessages } from "../../src/core/hooks/messages.js";

import {
  createMockBotHookManager,
  workflowDsl,
  simpleActionWorkflowDsl,
  createCapabilityModelInvoker,
  createNodeResult,
  createRecordingSubSessionRunner,
  createAttachmentPersister,
  createSemanticTransferTool,
  createBaseContext,
  createContextWithSharedTools,
  getBeforeDispatch,
  runWorkflowHook,
  callsByNodeName,
  workflowTurn,
  createRegisterWorkflowHooks,
  WORKFLOW_PLUGIN_DEFAULTS,
  resolveWorkflowNodeDialogProcessId,
  collectWorkflowDialogProcessIds,
  resolveWorkflowDialogProcessId,
} from "../helpers/workflow-hook-session-strategy-helper.js";

function assertSystemBlockPrecedesConversation(messages = []) {
  const roles = messages.map((message = {}) => String(message?.role || "").trim());
  const firstConversationIndex = roles.findIndex((role) => role !== "system");
  const lastSystemIndex = roles.lastIndexOf("system");
  assert.equal(lastSystemIndex >= 0, true);
  assert.equal(firstConversationIndex > lastSystemIndex, true);
}

function resolveTestModelMessages({ ctx = {} } = {}) {
  const blocks = ctx?.modelContext?.messageBlocks || {};
  return [
    ...(Array.isArray(blocks.system) ? blocks.system : []),
    ...(Array.isArray(blocks.history) ? blocks.history : []),
    ...(Array.isArray(blocks.incremental) ? blocks.incremental : []),
  ];
}

test("workflow semantic context projects canonical tool evidence for the observer", () => {
  const messages = resolveWorkflowSemanticContextMessages({
    options: {
      resolveModelMessages: () => [
        {
          role: "assistant",
          content: "",
          tool_calls: [{ id: "call-workflow", function: { name: "read_file", arguments: "{}" } }],
        },
        {
          role: "tool",
          tool_call_id: "call-workflow",
          content: '{"ok":true}',
        },
      ],
    },
    ctx: {},
  });
  assert.equal(messages[0].role, "user");
  assert.equal(messages[0].content, "Tool call: read_file({})");
  assert.equal(messages[1].role, "assistant");
  assert.equal(messages[1].content, '{"ok":true}');
});

test("workflow semantic planning passes conversation context before current user task", async () => {
  const hookManager = createMockBotHookManager();
  const registerWorkflowHooks = createRegisterWorkflowHooks();
  const invokerCalls = [];

  registerWorkflowHooks({
    hookManager,
    options: {
      enabled: true,
      mode: "on",
      semanticModel: "semantic-model",
      semanticPrompt: "emit workflow dsl",
      resolveModelMessages: (payload = {}) => resolveTestModelMessages(payload).slice(0, 2),
      capabilityModelInvoker: async (payload = {}) => {
        invokerCalls.push(payload);
        return {
          output: {
            text: [
              "WORKFLOW_DSL/1",
              'NODE id=start type=state stateType=start name="开始"',
              'NODE id=act type=action name="节点A" task="执行当前请求"',
              'NODE id=end type=state stateType=end name="结束"',
              "EDGE from=start to=act",
              "EDGE from=act to=end",
              "END",
            ].join("\n"),
          },
        };
      },
      subSessionRunner: async (payload = {}) => ({
        lifecycle: {
          executionId: payload?.strategy?.executionId || payload?.metadata?.executionId,
          executionKind: "agent",
          state: "completed",
          revision: 4,
          sequence: 4,
        },
        sessionId: "wf-node-session-context",
        dialogProcessId: "wf_node_dialog_context",
        result: { answer: "done", messages: [{ role: "assistant", content: "done" }] },
      }),
      generatedArtifactPersister: async () => [],
      workflowDialogPersister: async () => null,
    },
  });

  const beforeDispatch = getBeforeDispatch(hookManager);
  await beforeDispatch.handler({
    userId: "u1",
    sessionId: "s1",
    dialogProcessId: "d1",
    userMessage: "请基于前文生成工作流",
    runConfig: { locale: "zh-CN" },
    modelContext: createModelContext({
      messages: [
        { role: "user", content: "前文：我要处理报销审批" },
        { role: "assistant", content: "已记录报销审批背景" },
        {
          role: "user",
          content: "请基于前文生成工作流",
          messageOrigin: "natural",
          userMetaMaterialized: true,
        },
      ],
    }),
  });

  assert.equal(invokerCalls.length, 1);
  assert.equal(invokerCalls[0]?.prompt, "");
  const semanticMessages = invokerCalls[0]?.messages || [];
  assertSystemBlockPrecedesConversation(semanticMessages);
  assert.equal(semanticMessages[0]?.role, "system");
  assert.equal(semanticMessages[0]?.content, "emit workflow dsl");
  assert.equal(
    semanticMessages.filter((message = {}) => message?.content === "emit workflow dsl").length,
    1,
  );
  const historyUserIndex = semanticMessages.findIndex(
    (message = {}) => message?.content === "前文：我要处理报销审批",
  );
  assert.equal(semanticMessages[historyUserIndex]?.role, "user");
  assert.equal(semanticMessages[historyUserIndex + 1]?.role, "assistant");
  assert.equal(semanticMessages[historyUserIndex + 1]?.content, "已记录报销审批背景");
  assert.equal(semanticMessages.at(-1)?.role, "user");
  assert.match(semanticMessages.at(-1)?.content || "", /当前用户消息:\n请基于前文生成工作流/);
});

test("workflow semantic planning uses the authoritative resolver when the flat projection is empty", async () => {
  const hookManager = createMockBotHookManager();
  const registerWorkflowHooks = createRegisterWorkflowHooks();
  const invokerCalls = [];

  registerWorkflowHooks({
    hookManager,
    options: {
      enabled: true,
      mode: "on",
      semanticModel: "semantic-model",
      semanticPrompt: "emit workflow dsl",
      resolveModelMessages: resolveTestModelMessages,
      capabilityModelInvoker: async (payload = {}) => {
        invokerCalls.push(payload);
        return {
          output: {
            text: [
              "WORKFLOW_DSL/1",
              'NODE id=start type=state stateType=start name="开始"',
              'NODE id=act type=action name="节点A" task="执行当前请求"',
              'NODE id=end type=state stateType=end name="结束"',
              "EDGE from=start to=act",
              "EDGE from=act to=end",
              "END",
            ].join("\n"),
          },
        };
      },
      subSessionRunner: async (payload = {}) => ({
        lifecycle: {
          executionId: payload?.strategy?.executionId || payload?.metadata?.executionId,
          executionKind: "agent",
          state: "completed",
          revision: 4,
          sequence: 4,
        },
        sessionId: "wf-node-session-context-blocks",
        dialogProcessId: "wf_node_dialog_context_blocks",
        result: { answer: "done", messages: [{ role: "assistant", content: "done" }] },
      }),
      generatedArtifactPersister: async () => [],
      workflowDialogPersister: async () => null,
    },
  });

  const beforeDispatch = getBeforeDispatch(hookManager);
  await beforeDispatch.handler({
    userId: "u1",
    sessionId: "s1",
    dialogProcessId: "d1",
    userMessage: "请根据上下文继续生成工作流",
    runConfig: { locale: "zh-CN" },
    modelContext: createModelContext({
      messages: [],
      messageBlocks: {
        system: [{ role: "system", content: "你是流程专家" }],
        history: [
          { role: "user", content: "背景：这是采购审批流程" },
          { role: "assistant", content: "收到采购审批背景" },
        ],
        incremental: [{ role: "user", content: "请继续" }],
      },
    }),
  });

  assert.equal(invokerCalls.length, 1);
  const semanticMessages = invokerCalls[0]?.messages || [];
  assertSystemBlockPrecedesConversation(semanticMessages);
  assert.equal(semanticMessages[0]?.role, "system");
  assert.equal(semanticMessages[0]?.content, "你是流程专家");
  const historyUserIndex = semanticMessages.findIndex(
    (message = {}) => message?.content === "背景：这是采购审批流程",
  );
  assert.equal(semanticMessages[historyUserIndex]?.role, "user");
  assert.equal(semanticMessages[historyUserIndex + 1]?.role, "assistant");
  assert.equal(semanticMessages[historyUserIndex + 1]?.content, "收到采购审批背景");
  assert.equal(semanticMessages.at(-1)?.role, "user");
  assert.match(semanticMessages.at(-1)?.content || "", /当前用户消息:\n请根据上下文继续生成工作流/);
});

test("workflow semantic planning includes current available tools like harness planning", async () => {
  const hookManager = createMockBotHookManager();
  const registerWorkflowHooks = createRegisterWorkflowHooks();
  const invokerCalls = [];

  registerWorkflowHooks({
    hookManager,
    options: {
      enabled: true,
      mode: "on",
      semanticModel: "semantic-model",
      semanticPrompt: "emit workflow dsl",
      resolveModelMessages: () => [],
      capabilityModelInvoker: async (payload = {}) => {
        invokerCalls.push(payload);
        return {
          output: {
            text: [
              "WORKFLOW_DSL/1",
              'NODE id=start type=state stateType=start name="开始"',
              'NODE id=act type=action name="生成报告" task="使用 search_docs 查询资料后生成报告"',
              'NODE id=end type=state stateType=end name="结束"',
              "EDGE from=start to=act",
              "EDGE from=act to=end",
              "END",
            ].join("\n"),
          },
        };
      },
      subSessionRunner: async (payload = {}) => ({
        lifecycle: {
          executionId: payload?.strategy?.executionId || payload?.metadata?.executionId,
          executionKind: "agent",
          state: "completed",
          revision: 4,
          sequence: 4,
        },
        sessionId: "wf-node-session-tools",
        dialogProcessId: "wf_node_dialog_tools",
        result: { answer: "done", messages: [{ role: "assistant", content: "done" }] },
      }),
      generatedArtifactPersister: async () => [],
      workflowDialogPersister: async () => null,
    },
  });

  const beforeDispatch = getBeforeDispatch(hookManager);
  await beforeDispatch.handler({
    userId: "u1",
    sessionId: "s1",
    dialogProcessId: "d1",
    userMessage: "查资料并生成报告",
    runConfig: { locale: "zh-CN" },
    agentContext: {
      payload: {
        tools: {
          registry: [
            { name: "search_docs", description: "检索项目文档和知识库" },
            { name: "write_file", description: "写入文件到工作区" },
          ],
        },
      },
    },
  });

  assert.equal(invokerCalls.length, 1);
  assert.deepEqual(invokerCalls[0]?.toolAllowlist, ["search_docs", "write_file"]);
  const semanticMessages = invokerCalls[0]?.messages || [];
  assertSystemBlockPrecedesConversation(semanticMessages);
  const availableToolsMessage = semanticMessages.find((item = {}) =>
    String(item?.content || "").includes("当前可用工具"),
  );
  assert.equal(availableToolsMessage?.role, "system");
  assert.match(String(availableToolsMessage?.content || ""), /search_docs/);
  assert.match(String(availableToolsMessage?.content || ""), /检索项目文档和知识库/);
  assert.match(String(availableToolsMessage?.content || ""), /write_file/);
  assert.match(String(availableToolsMessage?.content || ""), /不要臆造工具名/);
  const semanticTask = String(semanticMessages.at(-1)?.content || "");
  assert.doesNotMatch(semanticTask, /当前可用工具/);
});

test("workflow semantic planning reads available tools from the canonical agentContext", async () => {
  const hookManager = createMockBotHookManager();
  const registerWorkflowHooks = createRegisterWorkflowHooks();
  const invokerCalls = [];

  registerWorkflowHooks({
    hookManager,
    options: {
      enabled: true,
      mode: "on",
      semanticModel: "semantic-model",
      semanticPrompt: "emit workflow dsl",
      resolveModelMessages: () => [],
      capabilityModelInvoker: async (payload = {}) => {
        invokerCalls.push(payload);
        return {
          output: {
            text: [
              "WORKFLOW_DSL/1",
              'NODE id=start type=state stateType=start name="开始"',
              'NODE id=act type=action name="生成报告" task="使用 search_docs 查询资料后生成报告"',
              'NODE id=end type=state stateType=end name="结束"',
              "EDGE from=start to=act",
              "EDGE from=act to=end",
              "END",
            ].join("\n"),
          },
        };
      },
      subSessionRunner: async (payload = {}) => ({
        lifecycle: {
          executionId: payload?.strategy?.executionId || payload?.metadata?.executionId,
          executionKind: "agent",
          state: "completed",
          revision: 4,
          sequence: 4,
        },
        sessionId: "wf-node-session-runtime-tools",
        dialogProcessId: "wf_node_dialog_runtime_tools",
        result: { answer: "done", messages: [{ role: "assistant", content: "done" }] },
      }),
      generatedArtifactPersister: async () => [],
      workflowDialogPersister: async () => null,
    },
  });

  const beforeDispatch = getBeforeDispatch(hookManager);
  await beforeDispatch.handler({
    userId: "u1",
    sessionId: "s1",
    dialogProcessId: "d1",
    userMessage: "查资料并生成报告",
    runConfig: { locale: "zh-CN" },
    agentContext: {
      payload: {
        tools: {
          registry: [
            { name: "search_docs", description: "检索项目文档和知识库" },
            { name: "write_file", description: "写入文件到工作区" },
          ],
        },
      },
    },
  });

  assert.equal(invokerCalls.length, 1);
  assert.deepEqual(invokerCalls[0]?.toolAllowlist, ["search_docs", "write_file"]);
  const semanticMessages = invokerCalls[0]?.messages || [];
  const availableToolsMessage = semanticMessages.find((item = {}) =>
    String(item?.content || "").includes("当前可用工具"),
  );
  assert.equal(availableToolsMessage?.role, "system");
  assert.match(String(availableToolsMessage?.content || ""), /search_docs/);
  assert.match(String(availableToolsMessage?.content || ""), /write_file/);
});

test("workflow semantic planning reads authoritative modelContext history", async () => {
  const hookManager = createMockBotHookManager();
  const registerWorkflowHooks = createRegisterWorkflowHooks();
  const invokerCalls = [];

  registerWorkflowHooks({
    hookManager,
    options: {
      enabled: true,
      mode: "on",
      semanticModel: "semantic-model",
      semanticPrompt: "emit workflow dsl",
      resolveModelMessages: resolveTestModelMessages,
      capabilityModelInvoker: async (payload = {}) => {
        invokerCalls.push(payload);
        return {
          output: {
            text: [
              "WORKFLOW_DSL/1",
              'NODE id=start type=state stateType=start name="开始"',
              'NODE id=act type=action name="节点A" task="执行当前请求"',
              'NODE id=end type=state stateType=end name="结束"',
              "EDGE from=start to=act",
              "EDGE from=act to=end",
              "END",
            ].join("\n"),
          },
        };
      },
      subSessionRunner: async (payload = {}) => ({
        lifecycle: {
          executionId: payload?.strategy?.executionId || payload?.metadata?.executionId,
          executionKind: "agent",
          state: "completed",
          revision: 4,
          sequence: 4,
        },
        sessionId: "wf-node-session-runtime-history",
        dialogProcessId: "wf_node_dialog_runtime_history",
        result: { answer: "done", messages: [{ role: "assistant", content: "done" }] },
      }),
      generatedArtifactPersister: async () => [],
      workflowDialogPersister: async () => null,
    },
  });

  const beforeDispatch = getBeforeDispatch(hookManager);
  await beforeDispatch.handler({
    userId: "u1",
    sessionId: "s1",
    dialogProcessId: "d1",
    userMessage: "请结合上下文生成工作流",
    runConfig: { locale: "zh-CN" },
    contextProtocolVersion: 3,
    modelContext: {
      protocolVersion: 3,
      messages: [
        { role: "user", content: "历史背景：审批流程包含财务复核" },
        { role: "assistant", content: "已记录财务复核约束" },
      ],
      messageBlocks: {
        system: [],
        history: [
          { role: "user", content: "历史背景：审批流程包含财务复核" },
          { role: "assistant", content: "已记录财务复核约束" },
        ],
        incremental: [],
      },
    },
    agentContext: {
      payload: {
        messages: {
          history: [
            { role: "user", content: "历史背景：审批流程包含财务复核" },
            { role: "assistant", content: "已记录财务复核约束" },
          ],
        },
      },
    },
  });

  assert.equal(invokerCalls.length, 1);
  const semanticMessages = invokerCalls[0]?.messages || [];
  assertSystemBlockPrecedesConversation(semanticMessages);
  const historyUserIndex = semanticMessages.findIndex(
    (message = {}) => message?.content === "历史背景：审批流程包含财务复核",
  );
  assert.equal(semanticMessages[historyUserIndex]?.role, "user");
  assert.equal(semanticMessages[historyUserIndex + 1]?.role, "assistant");
  assert.equal(semanticMessages[historyUserIndex + 1]?.content, "已记录财务复核约束");
  assert.match(
    String(semanticMessages.at(-1)?.content || ""),
    /当前用户消息:\n请结合上下文生成工作流/,
  );
});
