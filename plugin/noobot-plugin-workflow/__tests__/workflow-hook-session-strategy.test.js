/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";

import { createRegisterWorkflowHooks } from "../src/core/hooks.js";
import { WORKFLOW_BOT_HOOK_POINTS } from "../src/core/constants.js";

function createMockBotHookManager() {
  const listeners = new Map();
  const emits = [];
  return {
    listeners,
    emits,
    on(point, handler, options = {}) {
      listeners.set(String(point || "").trim(), { handler, options });
      return () => listeners.delete(String(point || "").trim());
    },
    async emit(point, payload) {
      emits.push({ point: String(point || "").trim(), payload });
      if (String(point || "").trim() === WORKFLOW_BOT_HOOK_POINTS.NODE_AGENT_EXECUTE) {
        return {
          results: [
            {
              ok: true,
              result: { action: { type: "submit", stepIndex: 0 } },
            },
          ],
        };
      }
      const record = listeners.get(String(point || "").trim());
      if (!record || typeof record.handler !== "function") {
        return { results: [], errors: [] };
      }
      const result = await record.handler(payload || {});
      return { results: [{ ok: true, result }], errors: [] };
    },
  };
}

test("workflow hook uses injected sub-session strategy and marks workflow message", async () => {
  const hookManager = createMockBotHookManager();
  const registerWorkflowHooks = createRegisterWorkflowHooks();
  const subSessionCalls = [];
  const generatedArtifactCalls = [];
  const planningPersistCalls = [];
  const eventLogCalls = [];

  const disposers = registerWorkflowHooks({
    hookManager,
    options: {
      enabled: true,
      mode: "on",
      semanticModel: "qwen3_6_plus",
      semanticPrompt: "emit workflow dsl",
      capabilityModelInvoker: async () => ({
        output: [
          "WORKFLOW_DSL/1",
          'NODE id=start type=state stateType=start name="开始"',
          'NODE id=act type=action name="节点A" task="请输出：节点A执行完成"',
          'NODE id=end type=state stateType=end name="结束"',
          'EDGE from=start to=act',
          'EDGE from=act to=end',
          "END",
        ].join("\n"),
        traces: [{ id: "semantic_trace_1" }],
      }),
      subSessionRunner: async (payload = {}) => {
        subSessionCalls.push(payload);
        return {
          sessionId: "wf-node-session-1",
          dialogProcessId: "wf_node_dialog_1",
          persisted: { outputDir: "/tmp/noobot/workflow/s1/node1" },
          result: {
            answer: "answer-node-done\n\n[Harness-Review]\n{\"status\":\"pass\"}",
            messages: [
              { role: "assistant", content: "message-node-done", type: "message" },
            ],
          },
        };
      },
      generatedArtifactPersister: async (payload = {}) => {
        generatedArtifactCalls.push(payload);
        return [
          {
            attachmentId: "wf-node-result-1",
            name: String(payload?.artifacts?.[0]?.name || "workflow-node-1-result.md"),
            mimeType: "text/markdown",
            path: "/attachments/s1/workflow-node-1-result.md",
          },
        ];
      },
      workflowDialogPersister: async (payload = {}) => {
        planningPersistCalls.push(payload);
        return {
          outputDir: "/tmp/noobot/workflow/s1/d1",
          outputFile: "/tmp/noobot/workflow/s1/d1/planning.json",
        };
      },
      workflowEventLogger: async (payload = {}) => {
        eventLogCalls.push(payload);
        return {
          outputDir: String(payload?.relativeDir || ""),
          outputFile: "events.jsonl",
        };
      },
    },
  });
  assert.equal(Array.isArray(disposers), true);
  assert.equal(disposers.length > 0, true);

  const beforeDispatch = hookManager.listeners.get(WORKFLOW_BOT_HOOK_POINTS.BEFORE_AGENT_DISPATCH);
  assert.ok(beforeDispatch?.handler);

  const beforeContext = {
    userId: "u1",
    sessionId: "s1",
    parentSessionId: "",
    dialogProcessId: "d1",
    userMessage: "请给我一个审批工作流",
    runConfig: {
      locale: "zh-CN",
      streaming: false,
    },
    agentContext: {
      execution: {
        controllers: {
          runtime: {
            sharedTools: {
              resolveAttachmentDisplayPath({ meta = {} } = {}) {
                const normalized = String(meta?.path || "").trim();
                if (!normalized) return "";
                return `/injected${normalized.startsWith("/") ? normalized : `/${normalized}`}`;
              },
              resolveSandboxPath({ hostPath = "" } = {}) {
                const normalized = String(hostPath || "").trim();
                if (!normalized) return "";
                return `/workspace${normalized.startsWith("/") ? normalized : `/${normalized}`}`;
              },
            },
          },
        },
      },
    },
    eventListener: {
      onEvent() {},
    },
  };
  await beforeDispatch.handler(beforeContext);
  const agentResult = beforeContext.overrideAgentResult;
  assert.equal(beforeContext.skipAgentDispatch, true);
  assert.ok(agentResult);

  assert.equal(subSessionCalls.length, 1);
  assert.equal(generatedArtifactCalls.length, 1);
  assert.equal(generatedArtifactCalls[0]?.sessionId, "s1");
  assert.equal(generatedArtifactCalls[0]?.generationSource, "workflow_node_agent_result");
  const savedArtifactText = Buffer.from(
    String(generatedArtifactCalls[0]?.artifacts?.[0]?.contentBase64 || ""),
    "base64",
  ).toString("utf8");
  assert.match(savedArtifactText, /message-node-done/);
  assert.equal(savedArtifactText.includes("answer-node-done"), false);
  assert.equal(savedArtifactText.includes("[Harness-Review]"), false);
  assert.equal(planningPersistCalls.length, 1);
  assert.equal(eventLogCalls.length > 0, true);
  assert.equal(planningPersistCalls[0]?.relativeDir, "runtime/workflow/planning/s1/d1");
  assert.equal(planningPersistCalls[0]?.fileName, "planning.json");

  const subCall = subSessionCalls[0] || {};
  assert.equal(Array.isArray(subCall?.strategy?.disabledPlugins), true);
  assert.equal(subCall.strategy.disabledPlugins.includes("workflow"), true);
  assert.equal(subCall.strategy.disabledPlugins.includes("harness"), false);
  assert.match(String(subCall?.strategy?.dialogProcessId || ""), /^wf_node_/);
  assert.equal(
    Array.isArray(subCall?.runConfigPatch?.selectedPlugins) &&
      subCall.runConfigPatch.selectedPlugins.includes("harness"),
    false,
  );
  assert.equal(String(subCall?.message || "").trim(), "请输出：节点A执行完成");
  assert.equal(subCall?.runConfigPatch?.streaming, false);
  assert.equal(typeof subCall?.eventListener?.onEvent, "function");
  assert.match(
    String(subCall?.strategy?.relativeDir || ""),
    /^runtime\/workflow\/session\/s1\/wf_node_/,
  );

  assert.ok(agentResult.workflow);
  assert.equal(agentResult.workflow?.planningDialog?.dialogId, "d1");
  assert.equal(
    String(agentResult.workflow?.planningDialog?.storageFile || "").endsWith("planning.json"),
    true,
  );
  assert.equal(Array.isArray(agentResult.workflow?.nodeSessions), true);
  assert.equal(agentResult.workflow.nodeSessions.length, 1);
  assert.equal(agentResult.workflow.nodeSessions[0]?.rootSessionId, "s1");
  assert.equal(agentResult.workflow.nodeSessions[0]?.sessionId, "wf-node-session-1");
  assert.equal(agentResult.workflow.nodeSessions[0]?.attachmentMetas?.[0]?.attachmentId, "wf-node-result-1");
  assert.equal(agentResult.workflow.attachmentMetas?.[0]?.attachmentId, "wf-node-result-1");

  const workflowTurn = (agentResult.turnMessages || []).find(
    (item) => item?.workflowMessage === true,
  );
  assert.ok(workflowTurn);
  assert.equal(workflowTurn?.type, "workflow");
  assert.equal(workflowTurn?.attachmentMetas?.[0]?.attachmentId, "wf-node-result-1");
  assert.match(
    String(workflowTurn?.content || ""),
    /\/injected\/attachments\/s1\/workflow-node-1-result\.md/,
  );
  assert.equal(String(workflowTurn?.content || "").includes("message-node-done"), false);
  assert.equal(String(workflowTurn?.content || "").includes("answer-node-done"), false);
  assert.equal(workflowTurn?.workflowMeta?.source, "workflow-plugin");
  assert.equal(
    workflowTurn?.workflowMeta?.payload?.execution?.nodeAgentRuns?.[0]?.nodeResultText,
    undefined,
  );
  const hasPayloadBuiltEvent = eventLogCalls.some(
    (item) => String(item?.event?.event || "").trim() === "workflow_payload_build_succeeded",
  );
  assert.equal(hasPayloadBuiltEvent, true);
});

test("workflow hook injects upstream node result attachments into downstream sub-session system messages", async () => {
  const hookManager = createMockBotHookManager();
  const registerWorkflowHooks = createRegisterWorkflowHooks();
  const subSessionCalls = [];
  let artifactCounter = 0;

  registerWorkflowHooks({
    hookManager,
    options: {
      enabled: true,
      mode: "on",
      parallelNodeExecution: true,
      maxParallelNodeAgents: 4,
      capabilityModelInvoker: async () => ({
        output: [
          "WORKFLOW_DSL/1",
          'NODE id=start type=state stateType=start name="开始"',
          'NODE id=a type=action name="节点A" task="执行A"',
          'NODE id=branch type=state stateType=branch name="并发分叉"',
          'NODE id=b type=action name="节点B" task="执行B"',
          'NODE id=c type=action name="节点C" task="执行C"',
          'NODE id=merge type=state stateType=merge name="汇聚"',
          'NODE id=branch2 type=state stateType=branch name="汇聚后并发分叉"',
          'NODE id=d type=action name="节点D" task="执行D"',
          'NODE id=e type=action name="节点E" task="执行E"',
          'NODE id=end type=state stateType=end name="结束"',
          "EDGE from=start to=a",
          "EDGE from=a to=branch",
          "EDGE from=branch to=b",
          "EDGE from=branch to=c",
          "EDGE from=b to=merge",
          "EDGE from=c to=merge",
          "EDGE from=merge to=branch2",
          "EDGE from=branch2 to=d",
          "EDGE from=branch2 to=e",
          "EDGE from=d to=end",
          "EDGE from=e to=end",
          "END",
        ].join("\n"),
      }),
      subSessionRunner: async (payload = {}) => {
        subSessionCalls.push(payload);
        const nodeName = String(payload?.metadata?.nodeName || payload?.message || "").trim();
        return {
          sessionId: `session-${nodeName}`,
          dialogProcessId: `dialog-${nodeName}`,
          result: {
            answer: `answer-${nodeName}`,
            messages: [{ role: "assistant", content: `result-${nodeName}` }],
          },
        };
      },
      generatedArtifactPersister: async (payload = {}) => {
        artifactCounter += 1;
        const artifactName = String(payload?.artifacts?.[0]?.name || `result-${artifactCounter}.md`);
        return [
          {
            attachmentId: `att-${artifactCounter}`,
            name: artifactName,
            mimeType: "text/markdown",
            path: `/attachments/${artifactName}`,
          },
        ];
      },
    },
  });

  const beforeDispatch = hookManager.listeners.get(WORKFLOW_BOT_HOOK_POINTS.BEFORE_AGENT_DISPATCH);
  assert.ok(beforeDispatch?.handler);
  await beforeDispatch.handler({
    userId: "u1",
    sessionId: "s-upstream",
    dialogProcessId: "d-upstream",
    userMessage: "请运行带并发和汇聚的流程",
    runConfig: { locale: "zh-CN" },
  });

  const callByNodeName = new Map(
    subSessionCalls.map((call) => [String(call?.metadata?.nodeName || "").trim(), call]),
  );
  assert.equal(subSessionCalls.length, 5);
  assert.deepEqual(callByNodeName.get("节点A")?.systemMessages || [], []);

  const nodeBSystem = String(callByNodeName.get("节点B")?.systemMessages?.[0] || "");
  const nodeCSystem = String(callByNodeName.get("节点C")?.systemMessages?.[0] || "");
  assert.match(nodeBSystem, /上游工作流节点结果附件/);
  assert.match(nodeBSystem, /节点A/);
  assert.match(nodeBSystem, /att-1|workflow-node-1-节点A-result\.md/);
  assert.match(nodeCSystem, /节点A/);

  const nodeDSystem = String(callByNodeName.get("节点D")?.systemMessages?.[0] || "");
  assert.match(nodeDSystem, /节点B/);
  assert.match(nodeDSystem, /节点C/);
  assert.doesNotMatch(nodeDSystem, /节点A \/ workflow-node-1-节点A-result\.md/);

  const nodeESystem = String(callByNodeName.get("节点E")?.systemMessages?.[0] || "");
  assert.match(nodeESystem, /节点B/);
  assert.match(nodeESystem, /节点C/);
  assert.doesNotMatch(nodeESystem, /节点A \/ workflow-node-1-节点A-result\.md/);
});


test("workflow hook injects one upstream action attachments into multiple direct downstream action nodes", async () => {
  const hookManager = createMockBotHookManager();
  const registerWorkflowHooks = createRegisterWorkflowHooks();
  const subSessionCalls = [];
  let artifactCounter = 0;

  registerWorkflowHooks({
    hookManager,
    options: {
      enabled: true,
      mode: "on",
      parallelNodeExecution: true,
      maxParallelNodeAgents: 4,
      capabilityModelInvoker: async () => ({
        output: [
          "WORKFLOW_DSL/1",
          'NODE id=start type=state stateType=start name="开始"',
          'NODE id=a type=action name="节点A" task="执行A"',
          'NODE id=b type=action name="节点B" task="执行B"',
          'NODE id=c type=action name="节点C" task="执行C"',
          'NODE id=end type=state stateType=end name="结束"',
          "EDGE from=start to=a",
          "EDGE from=a to=b",
          "EDGE from=a to=c",
          "EDGE from=b to=end",
          "EDGE from=c to=end",
          "END",
        ].join("\n"),
      }),
      subSessionRunner: async (payload = {}) => {
        subSessionCalls.push(payload);
        const nodeName = String(payload?.metadata?.nodeName || payload?.message || "").trim();
        return {
          sessionId: `session-${nodeName}`,
          dialogProcessId: `dialog-${nodeName}`,
          result: {
            answer: `answer-${nodeName}`,
            messages: [{ role: "assistant", content: `result-${nodeName}` }],
          },
        };
      },
      generatedArtifactPersister: async (payload = {}) => {
        artifactCounter += 1;
        const artifactName = String(payload?.artifacts?.[0]?.name || `result-${artifactCounter}.md`);
        return [
          {
            attachmentId: `fanout-att-${artifactCounter}`,
            name: artifactName,
            mimeType: "text/markdown",
            path: `/attachments/${artifactName}`,
          },
        ];
      },
    },
  });

  const beforeDispatch = hookManager.listeners.get(WORKFLOW_BOT_HOOK_POINTS.BEFORE_AGENT_DISPATCH);
  assert.ok(beforeDispatch?.handler);
  await beforeDispatch.handler({
    userId: "u1",
    sessionId: "s-fanout",
    dialogProcessId: "d-fanout",
    userMessage: "请运行直接多下游流程",
    runConfig: { locale: "zh-CN" },
  });

  const callByNodeName = new Map(
    subSessionCalls.map((call) => [String(call?.metadata?.nodeName || "").trim(), call]),
  );
  assert.equal(subSessionCalls.length, 3);
  assert.deepEqual(callByNodeName.get("节点A")?.systemMessages || [], []);

  const nodeBSystem = String(callByNodeName.get("节点B")?.systemMessages?.[0] || "");
  const nodeCSystem = String(callByNodeName.get("节点C")?.systemMessages?.[0] || "");
  assert.match(nodeBSystem, /节点A/);
  assert.match(nodeBSystem, /fanout-att-1|workflow-node-1-节点A-result\.md/);
  assert.match(nodeCSystem, /节点A/);
  assert.match(nodeCSystem, /fanout-att-1|workflow-node-1-节点A-result\.md/);
});

test("workflow hook marks failed sub-agent step and continues downstream", async () => {
  const hookManager = createMockBotHookManager();
  const registerWorkflowHooks = createRegisterWorkflowHooks();
  const subSessionCalls = [];

  registerWorkflowHooks({
    hookManager,
    options: {
      enabled: true,
      mode: "on",
      capabilityModelInvoker: async () => ({
        output: [
          "WORKFLOW_DSL/1",
          'NODE id=start type=state stateType=start name="开始"',
          'NODE id=a type=action name="节点A" task="执行A"',
          'NODE id=b type=action name="节点B" task="执行B"',
          'NODE id=end type=state stateType=end name="结束"',
          "EDGE from=start to=a",
          "EDGE from=a to=b",
          "EDGE from=b to=end",
          "END",
        ].join("\n"),
      }),
      subSessionRunner: async (payload = {}) => {
        subSessionCalls.push(payload);
        const nodeName = String(payload?.metadata?.nodeName || "").trim();
        if (nodeName === "节点A") {
          throw new Error("节点A子agent失败");
        }
        return {
          sessionId: `session-${nodeName}`,
          dialogProcessId: `dialog-${nodeName}`,
          result: {
            answer: `answer-${nodeName}`,
            messages: [{ role: "assistant", content: `result-${nodeName}` }],
          },
        };
      },
      generatedArtifactPersister: async (payload = {}) => [
        {
          attachmentId: `att-${String(payload?.artifacts?.[0]?.name || "x")}`,
          name: String(payload?.artifacts?.[0]?.name || "result.md"),
          mimeType: "text/markdown",
          path: `/attachments/${String(payload?.artifacts?.[0]?.name || "result.md")}`,
        },
      ],
    },
  });

  const beforeDispatch = hookManager.listeners.get(WORKFLOW_BOT_HOOK_POINTS.BEFORE_AGENT_DISPATCH);
  assert.ok(beforeDispatch?.handler);
  const beforeContext = {
    userId: "u1",
    sessionId: "s-failed-step",
    dialogProcessId: "d-failed-step",
    userMessage: "请运行失败继续流程",
    runConfig: { locale: "zh-CN" },
  };
  await beforeDispatch.handler(beforeContext);

  assert.equal(beforeContext.skipAgentDispatch, true);
  assert.equal(subSessionCalls.length, 2);
  const callByNodeName = new Map(
    subSessionCalls.map((call) => [String(call?.metadata?.nodeName || "").trim(), call]),
  );
  const nodeBSystem = String(callByNodeName.get("节点B")?.systemMessages?.[0] || "");
  assert.match(nodeBSystem, /上游失败节点/);
  assert.match(nodeBSystem, /节点A子agent失败/);

  const nodeRuns = beforeContext.overrideAgentResult?.workflow?.execution?.nodeAgentRuns || [];
  const nodeARun = nodeRuns.find((item) => String(item?.step?.nodeName || "") === "节点A");
  assert.equal(nodeARun?.stepStatus, "failed");
  assert.match(String(nodeARun?.stepFailure?.message || ""), /节点A子agent失败/);
  const nodeSessionA = beforeContext.overrideAgentResult?.workflow?.nodeSessions?.find(
    (item) => String(item?.nodeName || "") === "节点A",
  );
  assert.equal(nodeSessionA?.stepStatus, "failed");
});

test("workflow hook passes planned user attachments to node sub-session", async () => {
  const hookManager = createMockBotHookManager();
  const registerWorkflowHooks = createRegisterWorkflowHooks();
  const subSessionCalls = [];
  const semanticRequestMessages = [];

  registerWorkflowHooks({
    hookManager,
    options: {
      enabled: true,
      mode: "on",
      capabilityModelInvoker: async (payload = {}) => {
        semanticRequestMessages.push(...(Array.isArray(payload?.messages) ? payload.messages : []));
        return {
          output: [
            "WORKFLOW_DSL/1",
            'ATTACHMENT id="node-file" name="合同.pdf" path="/workspace/attachments/s-input-att/contract.pdf" mimeType="application/pdf"',
            'NODE id=start type=state stateType=start name="开始"',
            'NODE id=read type=action name="读取附件" task="请读取并总结用户附件" attachments="node-file"',
            'NODE id=end type=state stateType=end name="结束"',
            "EDGE from=start to=read",
            "EDGE from=read to=end",
            "END",
          ].join("\n"),
        };
      },
      subSessionRunner: async (payload = {}) => {
        subSessionCalls.push(payload);
        return {
          sessionId: "node-session-read",
          dialogProcessId: "node-dialog-read",
          result: {
            answer: "done",
            messages: [{ role: "assistant", content: "done" }],
          },
        };
      },
      generatedArtifactPersister: async () => [],
    },
  });

  const beforeDispatch = hookManager.listeners.get(WORKFLOW_BOT_HOOK_POINTS.BEFORE_AGENT_DISPATCH);
  assert.ok(beforeDispatch?.handler);
  await beforeDispatch.handler({
    userId: "u1",
    sessionId: "s-input-att",
    dialogProcessId: "d-input-att",
    userMessage: "请基于附件规划并执行",
    attachmentMetas: [
      {
        attachmentId: "att-user-1",
        name: "合同.pdf",
        mimeType: "application/pdf",
        path: "/attachments/s-input-att/contract.pdf",
      },
    ],
    runConfig: { locale: "zh-CN" },
    agentContext: {
      execution: {
        controllers: {
          runtime: {
            sharedTools: {
              resolveSandboxPath({ hostPath = "" } = {}) {
                return `/workspace${String(hostPath || "")}`;
              },
            },
          },
        },
      },
    },
  });

  assert.equal(subSessionCalls.length, 1);
  assert.equal(subSessionCalls[0]?.attachmentMetas?.[0]?.attachmentId, "att-user-1");
  assert.equal(subSessionCalls[0]?.metadata?.inputAttachmentRefs?.[0], "node-file");
  const nodeSystemMessages = String((subSessionCalls[0]?.systemMessages || []).join("\n\n"));
  assert.match(nodeSystemMessages, /用户原始附件/);
  assert.match(nodeSystemMessages, /合同\.pdf/);
  assert.match(nodeSystemMessages, /\/workspace\/attachments\/s-input-att\/contract\.pdf/);

  const semanticPrompt = String(semanticRequestMessages[0]?.content || "");
  assert.match(semanticPrompt, /用户附件/);
  assert.match(semanticPrompt, /attachmentId=att-user-1/);
  assert.match(semanticPrompt, /ATTACHMENT id=/);
  assert.match(semanticPrompt, /attachments="user:\*"/);
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
      resolveModelMessages: ({ messages = [] } = {}) => messages.slice(0, 2),
      capabilityModelInvoker: async (payload = {}) => {
        invokerCalls.push(payload);
        return {
          output: [
            "WORKFLOW_DSL/1",
            'NODE id=start type=state stateType=start name="开始"',
            'NODE id=act type=action name="节点A" task="执行当前请求"',
            'NODE id=end type=state stateType=end name="结束"',
            'EDGE from=start to=act',
            'EDGE from=act to=end',
            "END",
          ].join("\n"),
        };
      },
      subSessionRunner: async () => ({
        sessionId: "wf-node-session-context",
        dialogProcessId: "wf_node_dialog_context",
        result: { answer: "done", messages: [{ role: "assistant", content: "done" }] },
      }),
      generatedArtifactPersister: async () => [],
      workflowDialogPersister: async () => null,
      workflowEventLogger: async () => null,
    },
  });

  const beforeDispatch = hookManager.listeners.get(WORKFLOW_BOT_HOOK_POINTS.BEFORE_AGENT_DISPATCH);
  await beforeDispatch.handler({
    userId: "u1",
    sessionId: "s1",
    dialogProcessId: "d1",
    userMessage: "请基于前文生成工作流",
    runConfig: { locale: "zh-CN" },
    messages: [
      { role: "user", content: "前文：我要处理报销审批" },
      { role: "assistant", content: "已记录报销审批背景" },
      { role: "user", content: "请基于前文生成工作流", frontendUserMessage: true },
    ],
  });

  assert.equal(invokerCalls.length, 1);
  const semanticMessages = invokerCalls[0]?.messages || [];
  assert.equal(semanticMessages[0]?.role, "user");
  assert.equal(semanticMessages[0]?.content, "前文：我要处理报销审批");
  assert.equal(semanticMessages[1]?.role, "assistant");
  assert.equal(semanticMessages[1]?.content, "已记录报销审批背景");
  assert.equal(semanticMessages.at(-1)?.role, "user");
  assert.match(semanticMessages.at(-1)?.content || "", /当前用户消息:\n请基于前文生成工作流/);
});
