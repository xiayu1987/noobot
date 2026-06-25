/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";

import { createRegisterWorkflowHooks } from "../src/core/hooks.js";
import { WORKFLOW_BOT_HOOK_POINTS, WORKFLOW_PLUGIN_DEFAULTS } from "../src/core/constants.js";
import { resolveWorkflowNodeDialogProcessId } from "../src/core/dialog-process-compat.js";
import {
  collectWorkflowDialogProcessIds,
  resolveWorkflowDialogProcessId,
} from "../frontend/components/workflow-message-card/workflowDialogProcessIdCompat.js";

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


test("workflow dialog process compat helpers keep old dialog fields read-only", () => {
  assert.equal(resolveWorkflowDialogProcessId({ dialogProcessId: "new-dialog" }), "new-dialog");
  assert.equal(resolveWorkflowDialogProcessId({ dialogId: "legacy-dialog" }), "legacy-dialog");
  assert.equal(resolveWorkflowDialogProcessId({ nodeDialogId: "legacy-node-dialog" }), "legacy-node-dialog");
  assert.equal(
    resolveWorkflowDialogProcessId({}, { dialogId: "fallback-dialog" }),
    "fallback-dialog",
  );
  assert.deepEqual(
    collectWorkflowDialogProcessIds({ dialogProcessId: "new-dialog" }, { dialogId: "legacy-dialog" }),
    ["new-dialog", "legacy-dialog"],
  );
  assert.equal(resolveWorkflowNodeDialogProcessId({ nodeDialogProcessId: "new-node-dialog" }), "new-node-dialog");
  assert.equal(resolveWorkflowNodeDialogProcessId({ nodeDialogId: "legacy-node-dialog" }), "legacy-node-dialog");
});


function workflowDsl(lines = []) {
  return ["WORKFLOW_DSL/1", ...lines, "END"].join("\n");
}

function simpleActionWorkflowDsl({
  nodeId = "act",
  nodeName = "节点A",
  task = "执行当前请求",
} = {}) {
  return workflowDsl([
    'NODE id=start type=state stateType=start name="开始"',
    `NODE id=${nodeId} type=action name="${nodeName}" task="${task}"`,
    'NODE id=end type=state stateType=end name="结束"',
    `EDGE from=start to=${nodeId}`,
    `EDGE from=${nodeId} to=end`,
  ]);
}

function createCapabilityModelInvoker(output, calls = null) {
  return async (payload = {}) => {
    if (Array.isArray(calls)) calls.push(payload);
    return { output };
  };
}

function createNodeResult(nodeName, overrides = {}) {
  return {
    sessionId: `session-${nodeName}`,
    dialogProcessId: `dialog-${nodeName}`,
    result: {
      answer: `answer-${nodeName}`,
      messages: [{ role: "assistant", content: `result-${nodeName}` }],
    },
    ...overrides,
  };
}

function createRecordingSubSessionRunner(calls, { failNodeName = "", failMessage = "" } = {}) {
  return async (payload = {}) => {
    calls.push(payload);
    const nodeName = String(payload?.metadata?.nodeName || payload?.message || "").trim();
    if (failNodeName && nodeName === failNodeName) {
      throw new Error(failMessage || `${nodeName}失败`);
    }
    return createNodeResult(nodeName);
  };
}

function createAttachmentPersister({ prefix = "att", counterRef = { value: 0 } } = {}) {
  return async (payload = {}) => {
    counterRef.value += 1;
    const artifactName = String(payload?.artifacts?.[0]?.name || `result-${counterRef.value}.md`);
    return [
      {
        attachmentId: `${prefix}-${counterRef.value}`,
        name: artifactName,
        mimeType: "text/markdown",
        path: `/attachments/${artifactName}`,
      },
    ];
  };
}

function createSemanticTransferTool({ prefix = "att", counterRef = { value: 0 } } = {}) {
  return {
    async transferSemanticContent({ scenario = "", strategy = "", messages = [] } = {}) {
      if (String(scenario || "") !== "bot_plugin" || !String(strategy || "").startsWith("bot_plugin_")) {
        return { transferEnvelopes: [] };
      }
      counterRef.value += 1;
      const nodeName = String(messages?.[0]?.nodeName || `节点${counterRef.value}`).trim();
      const fileName = `workflow-node-${counterRef.value}-${nodeName}-result.md`;
      const envelope = {
        protocol: "noobot.semantic-transfer",
        version: 1,
        direction: "output",
        transport: "file",
        filePath: `/workspace/${fileName}`,
        files: [{
          role: "primary",
          filePath: `/workspace/${fileName}`,
          attachmentMeta: {
            attachmentId: `${prefix}-${counterRef.value}`,
            name: fileName,
            mimeType: "text/markdown",
            relativePath: `runtime/attach/${fileName}`,
          },
          pathView: { displayPath: `/workspace/${fileName}` },
        }],
      };
      return { transferEnvelopes: [envelope] };
    },
  };
}

function createBaseContext(overrides = {}) {
  return {
    userId: "u1",
    sessionId: "s1",
    dialogProcessId: "d1",
    userMessage: "请执行一个工作流",
    runConfig: { locale: "zh-CN" },
    ...overrides,
  };
}

function createContextWithSharedTools(sharedTools = {}, overrides = {}) {
  return createBaseContext({
    agentContext: {
      execution: { controllers: { runtime: { sharedTools } } },
    },
    ...overrides,
  });
}

function getBeforeDispatch(hookManager) {
  const beforeDispatch = hookManager.listeners.get(WORKFLOW_BOT_HOOK_POINTS.BEFORE_AGENT_DISPATCH);
  assert.ok(beforeDispatch?.handler);
  return beforeDispatch;
}

async function runWorkflowHook({ options = {}, context = {} } = {}) {
  const hookManager = createMockBotHookManager();
  createRegisterWorkflowHooks()({ hookManager, options: { enabled: true, mode: "on", ...options } });
  const ctx = createBaseContext(context);
  await getBeforeDispatch(hookManager).handler(ctx);
  return { hookManager, ctx, agentResult: ctx.overrideAgentResult };
}

function callsByNodeName(calls = []) {
  return new Map(calls.map((call) => [String(call?.metadata?.nodeName || "").trim(), call]));
}

function workflowTurn(agentResult) {
  return (agentResult?.turnMessages || []).find((item) => item?.pluginMessage === true && item?.pluginMeta?.kind === "workflow");
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

  const beforeDispatch = getBeforeDispatch(hookManager);

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
  assert.match(String(subCall?.runConfigPatch?.turnScopeId || ""), /^workflow-node:wf_node_/);
  assert.equal(subCall?.strategy?.turnScopeId, subCall?.runConfigPatch?.turnScopeId);
  assert.equal(subCall?.metadata?.turnScopeId, subCall?.runConfigPatch?.turnScopeId);
  assert.equal(typeof subCall?.eventListener?.onEvent, "function");
  assert.match(
    String(subCall?.strategy?.relativeDir || ""),
    /^runtime\/workflow\/session\/s1\/wf_node_/,
  );

  assert.ok(agentResult.workflow);
  assert.equal(agentResult.workflow?.planningDialog?.dialogProcessId, "d1");
  assert.equal(agentResult.workflow?.planningDialog?.dialogId, undefined);
  assert.match(String(agentResult.workflow.nodeSessions[0]?.dialogProcessId || ""), /^wf_node_/);
  assert.equal(agentResult.workflow.nodeSessions[0]?.dialogId, undefined);
  assert.match(String(agentResult.workflow?.execution?.nodeAgentRuns?.[0]?.nodeDialogProcessId || ""), /^wf_node_/);
  assert.equal(agentResult.workflow?.execution?.nodeAgentRuns?.[0]?.nodeDialogId, undefined);
  assert.equal(
    String(agentResult.workflow?.planningDialog?.storageFile || "").endsWith("planning.json"),
    true,
  );
  assert.equal(Array.isArray(agentResult.workflow?.nodeSessions), true);
  assert.equal(agentResult.workflow.nodeSessions.length, 1);
  assert.equal(agentResult.workflow.nodeSessions[0]?.rootSessionId, "s1");
  assert.equal(agentResult.workflow.nodeSessions[0]?.sessionId, "wf-node-session-1");
  assert.equal(agentResult.workflow.nodeSessions[0]?.stepStatus, "success");
  assert.equal(agentResult.workflow?.execution?.nodeAgentRuns?.[0]?.stepStatus, "success");
  assert.equal(agentResult.workflow?.attachmentMetas, undefined);
  assert.equal(agentResult.workflow.nodeSessions[0]?.attachmentMetas, undefined);

  const workflowTurnMessage = workflowTurn(agentResult);
  assert.ok(workflowTurnMessage);
  assert.equal(workflowTurnMessage?.type, "workflow");
  assert.equal(workflowTurnMessage?.attachmentMetas, undefined);
  assert.match(
    String(workflowTurnMessage?.content || ""),
    /\/injected\/attachments\/s1\/workflow-node-1-result\.md/,
  );
  assert.equal(String(workflowTurnMessage?.content || "").includes("message-node-done"), false);
  assert.equal(String(workflowTurnMessage?.content || "").includes("answer-node-done"), false);
  assert.equal(workflowTurnMessage?.pluginMeta?.source, "workflow-plugin");
  assert.equal(
    workflowTurnMessage?.pluginMeta?.payload?.execution?.nodeAgentRuns?.[0]?.nodeResultText,
    undefined,
  );
  assert.equal(
    workflowTurnMessage?.pluginMeta?.payload?.execution?.nodeAgentRuns?.[0]?.stepStatus,
    "success",
  );
  assert.equal(
    workflowTurnMessage?.pluginMeta?.payload?.nodeSessions?.[0]?.stepStatus,
    "success",
  );
  const hasPayloadBuiltEvent = eventLogCalls.some(
    (item) => String(item?.event?.event || "").trim() === "workflow_payload_build_succeeded",
  );
  assert.equal(hasPayloadBuiltEvent, true);
});

test("workflow hook propagates semantic transfer envelopes for node result artifacts", async () => {
  const hookManager = createMockBotHookManager();
  const registerWorkflowHooks = createRegisterWorkflowHooks();
  const fallbackArtifactCalls = [];
  const envelope = {
    protocol: "noobot.semantic-transfer",
    version: 1,
    direction: "output",
    transport: "file",
    filePath: "/workspace/s1/workflow-node-result.md",
    attachmentMeta: {
      attachmentId: "wf-semantic-result-1",
      name: "workflow-node-result.md",
      mimeType: "text/markdown",
      path: "/attachments/s1/workflow-node-result.md",
    },
    files: [
      {
        filePath: "/workspace/s1/workflow-node-result.md",
        attachmentMeta: {
          attachmentId: "wf-semantic-result-1",
          name: "workflow-node-result.md",
          mimeType: "text/markdown",
          path: "/attachments/s1/workflow-node-result.md",
        },
        role: "primary",
      },
    ],
  };

  registerWorkflowHooks({
    hookManager,
    options: {
      enabled: true,
      mode: "on",
      semanticModel: "qwen3_6_plus",
      capabilityModelInvoker: async () => ({
        output: [
          "WORKFLOW_DSL/1",
          'NODE id=start type=state stateType=start name="开始"',
          'NODE id=act type=action name="节点A" task="请输出节点结果"',
          'NODE id=end type=state stateType=end name="结束"',
          'EDGE from=start to=act',
          'EDGE from=act to=end',
          "END",
        ].join("\n"),
      }),
      subSessionRunner: async () => ({
        sessionId: "wf-semantic-node-session-1",
        dialogProcessId: "wf_semantic_node_dialog_1",
        result: {
          answer: "semantic-node-done",
          messages: [{ role: "assistant", content: "semantic-node-done", type: "message" }],
        },
      }),
      generatedArtifactPersister: async (payload = {}) => {
        fallbackArtifactCalls.push(payload);
        return [];
      },
    },
  });

  const beforeDispatch = getBeforeDispatch(hookManager);
  const ctx = {
    userId: "u1",
    sessionId: "s1",
    dialogProcessId: "d1",
    userMessage: "请给我一个语义传递工作流",
    runConfig: { locale: "zh-CN", streaming: false },
    agentContext: {
      execution: {
        controllers: {
          runtime: {
            sharedTools: {
              semanticTransfer: {
                async transferSemanticContent({ scenario = "", strategy = "" } = {}) {
                  if (String(scenario || "") !== "bot_plugin" || String(strategy || "") !== "bot_plugin_subagent_result") {
                    return { transferEnvelopes: [] };
                  }
                  return {
                    transferEnvelopes: [envelope],
                  };
                },
              },
            },
          },
        },
      },
    },
  };

  await beforeDispatch.handler(ctx);
  const agentResult = ctx.overrideAgentResult;
  assert.ok(agentResult?.workflow);
  assert.equal(fallbackArtifactCalls.length, 0);
  assert.equal(agentResult.workflow?.transferEnvelopes?.length, 1);
  assert.equal(agentResult.workflow?.transferEnvelopes?.[0]?.protocol, "noobot.semantic-transfer");
  assert.equal(agentResult.workflow?.nodeSessions?.[0]?.transferEnvelopes?.length, 1);
  assert.equal(agentResult.workflow?.nodeSessions?.[0]?.transferEnvelopes?.[0]?.protocol, "noobot.semantic-transfer");
  const workflowTurnMessage = workflowTurn(agentResult);
  assert.equal(workflowTurnMessage?.transferEnvelopes?.length, 1);
  assert.equal(workflowTurnMessage?.transferEnvelopes?.[0]?.protocol, "noobot.semantic-transfer");
  assert.equal(workflowTurnMessage?.transferEnvelopes?.[0]?.files?.[0]?.attachmentMeta?.attachmentId, "wf-semantic-result-1");
});

test("workflow hook routes final attachment summary composition through semantic-transfer", async () => {
  const hookManager = createMockBotHookManager();
  const registerWorkflowHooks = createRegisterWorkflowHooks();
  const semanticTransferCalls = [];

  registerWorkflowHooks({
    hookManager,
    options: {
      enabled: true,
      mode: "on",
      semanticModel: "qwen3_6_plus",
      capabilityModelInvoker: async () => ({
        output: [
          "WORKFLOW_DSL/1",
          'NODE id=start type=state stateType=start name="开始"',
          'NODE id=act type=action name="节点A" task="请输出节点结果"',
          'NODE id=end type=state stateType=end name="结束"',
          'EDGE from=start to=act',
          'EDGE from=act to=end',
          "END",
        ].join("\n"),
      }),
      subSessionRunner: async () => ({
        sessionId: "wf-summary-node-session-1",
        dialogProcessId: "wf_summary_node_dialog_1",
        result: {
          answer: "summary-node-done",
          messages: [{ role: "assistant", content: "summary-node-done", type: "message" }],
        },
      }),
      generatedArtifactPersister: async () => [],
    },
  });

  const beforeDispatch = getBeforeDispatch(hookManager);
  const ctx = {
    userId: "u1",
    sessionId: "s1",
    dialogProcessId: "d1",
    userMessage: "请给我一个语义传递工作流",
    runConfig: { locale: "zh-CN", streaming: false },
    agentContext: {
      execution: {
        controllers: {
          runtime: {
            sharedTools: {
              semanticTransfer: {
                async transferSemanticContent(payload = {}) {
                  semanticTransferCalls.push(payload);
                  const generationSource = String(payload?.generationSource || "").trim();
                  const suffix = generationSource === "workflow_planning_final_attachment_summary"
                    ? "final"
                    : "node";
                  const envelope = {
                    protocol: "noobot.semantic-transfer",
                    version: 1,
                    direction: "output",
                    transport: "file",
                    filePath: `/workspace/${suffix}-summary.md`,
                    files: [
                      {
                        role: "primary",
                        filePath: `/workspace/${suffix}-summary.md`,
                        attachmentMeta: {
                          attachmentId: `wf-semantic-${suffix}-1`,
                          name: `${suffix}-summary.md`,
                          mimeType: "text/markdown",
                          relativePath: `runtime/attach/${suffix}-summary.md`,
                        },
                      },
                    ],
                  };
                  return {
                    transferEnvelopes: [envelope],
                  };
                },
              },
            },
          },
        },
      },
    },
  };
  await beforeDispatch.handler(ctx);

  const hasFinalSummaryCall = semanticTransferCalls.some(
    (item = {}) =>
      String(item?.scenario || "").trim() === "bot_plugin" &&
      String(item?.strategy || "").trim() === "bot_plugin_final_return" &&
      String(item?.generationSource || "").trim() === "workflow_planning_final_attachment_summary",
  );
  assert.equal(hasFinalSummaryCall, true);
  const agentResult = ctx.overrideAgentResult;
  const workflowTurnMessage = workflowTurn(agentResult);
  assert.ok(workflowTurnMessage);
  const transferEnvelopes = Array.isArray(workflowTurnMessage?.transferEnvelopes)
    ? workflowTurnMessage.transferEnvelopes
    : [];
  const workflowPayloadTransferEnvelopes = Array.isArray(agentResult?.workflow?.transferEnvelopes)
    ? agentResult.workflow.transferEnvelopes
    : [];
  assert.equal(
    transferEnvelopes.some(
      (item = {}) => String(item?.files?.[0]?.attachmentMeta?.attachmentId || "").trim() === "wf-semantic-final-1",
    ),
    true,
  );
  assert.equal(
    workflowPayloadTransferEnvelopes.some(
      (item = {}) => String(item?.files?.[0]?.attachmentMeta?.attachmentId || "").trim() === "wf-semantic-final-1",
    ),
    true,
  );
  const workflowContent = String(workflowTurnMessage?.content || "");
  assert.match(workflowContent, /final-summary\.md/);
  assert.doesNotMatch(workflowContent, /node-summary\.md/);
});

test("workflow hook injects upstream node result attachments into downstream sub-session system messages", async () => {
  const hookManager = createMockBotHookManager();
  const registerWorkflowHooks = createRegisterWorkflowHooks();
  const subSessionCalls = [];
  const semanticTransferCalls = [];
  let artifactCounter = 0;

  registerWorkflowHooks({
    hookManager,
    options: {
      enabled: true,
      mode: "on",
      parallelNodeExecution: true,
      maxParallelNodeAgents: WORKFLOW_PLUGIN_DEFAULTS.DEFAULT_MAX_PARALLEL_NODE_AGENTS,
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

  const beforeDispatch = getBeforeDispatch(hookManager);
  await beforeDispatch.handler({
    userId: "u1",
    sessionId: "s-upstream",
    dialogProcessId: "d-upstream",
    userMessage: "请运行带并发和汇聚的流程",
    runConfig: { locale: "zh-CN" },
    agentContext: {
      execution: {
        controllers: {
          runtime: {
            sharedTools: {
              semanticTransfer: {
                async transferSemanticContent(payload = {}) {
                  semanticTransferCalls.push(payload);
                  const { scenario = "", strategy = "", messages = [] } = payload;
                  if (String(scenario || "") !== "bot_plugin" || !String(strategy || "").startsWith("bot_plugin_")) {
                    return {
                      transferEnvelopes: [],
                    };
                  }
                  artifactCounter += 1;
                  const nodeName = String(messages?.[0]?.nodeName || `节点${artifactCounter}`).trim();
                  const fileName = `workflow-node-${artifactCounter}-${nodeName}-result.md`;
                  const envelope = {
                    protocol: "noobot.semantic-transfer",
                    version: 1,
                    direction: "output",
                    transport: "file",
                    filePath: `/workspace/${fileName}`,
                    files: [
                      {
                        role: "primary",
                        filePath: `/workspace/${fileName}`,
                        attachmentMeta: {
                          attachmentId: `att-${artifactCounter}`,
                          name: fileName,
                          mimeType: "text/markdown",
                          relativePath: `runtime/attach/${fileName}`,
                        },
                        pathView: {
                          displayPath: `/workspace/${fileName}`,
                        },
                      },
                    ],
                  };
                  return {
                    transferEnvelopes: [envelope],
                    injectionMessage: String(payload?.content || ""),
                  };
                },
              },
            },
          },
        },
      },
    },
  });

  const callByNodeName = callsByNodeName(subSessionCalls);
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
  assert.equal(
    semanticTransferCalls.some(
      (item = {}) => String(item?.strategy || "") === "bot_plugin_upstream_injection",
    ),
    true,
  );
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
      maxParallelNodeAgents: WORKFLOW_PLUGIN_DEFAULTS.DEFAULT_MAX_PARALLEL_NODE_AGENTS,
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

  const beforeDispatch = getBeforeDispatch(hookManager);
  await beforeDispatch.handler({
    userId: "u1",
    sessionId: "s-fanout",
    dialogProcessId: "d-fanout",
    userMessage: "请运行直接多下游流程",
    runConfig: { locale: "zh-CN" },
    agentContext: {
      execution: {
        controllers: {
          runtime: {
            sharedTools: {
              semanticTransfer: {
                async transferSemanticContent({ scenario = "", strategy = "", messages = [] } = {}) {
                  if (String(scenario || "") !== "bot_plugin" || !String(strategy || "").startsWith("bot_plugin_")) {
                    return {
                      transferEnvelopes: [],
                    };
                  }
                  artifactCounter += 1;
                  const nodeName = String(messages?.[0]?.nodeName || `节点${artifactCounter}`).trim();
                  const fileName = `workflow-node-${artifactCounter}-${nodeName}-result.md`;
                  const envelope = {
                    protocol: "noobot.semantic-transfer",
                    version: 1,
                    direction: "output",
                    transport: "file",
                    filePath: `/workspace/${fileName}`,
                    files: [
                      {
                        role: "primary",
                        filePath: `/workspace/${fileName}`,
                        attachmentMeta: {
                          attachmentId: `fanout-att-${artifactCounter}`,
                          name: fileName,
                          mimeType: "text/markdown",
                          relativePath: `runtime/attach/${fileName}`,
                        },
                        pathView: {
                          displayPath: `/workspace/${fileName}`,
                        },
                      },
                    ],
                  };
                  return {
                    transferEnvelopes: [envelope],
                  };
                },
              },
            },
          },
        },
      },
    },
  });

  const callByNodeName = callsByNodeName(subSessionCalls);
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

  const beforeDispatch = getBeforeDispatch(hookManager);
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
  const callByNodeName = callsByNodeName(subSessionCalls);
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

test("workflow hook injects failed upstream task+error from single upstream into multiple downstream nodes", async () => {
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
          'NODE id=a type=action name="节点A" task="执行A任务"',
          'NODE id=branch type=state stateType=branch name="分叉"',
          'NODE id=b type=action name="节点B" task="执行B"',
          'NODE id=c type=action name="节点C" task="执行C"',
          'NODE id=end type=state stateType=end name="结束"',
          "EDGE from=start to=a",
          "EDGE from=a to=branch",
          "EDGE from=branch to=b",
          "EDGE from=branch to=c",
          "EDGE from=b to=end",
          "EDGE from=c to=end",
          "END",
        ].join("\n"),
      }),
      subSessionRunner: async (payload = {}) => {
        subSessionCalls.push(payload);
        const nodeName = String(payload?.metadata?.nodeName || "").trim();
        if (nodeName === "节点A") throw new Error("节点A失败");
        return {
          sessionId: `session-${nodeName}`,
          dialogProcessId: `dialog-${nodeName}`,
          result: { messages: [{ role: "assistant", content: `ok-${nodeName}` }] },
        };
      },
      generatedArtifactPersister: async () => [],
    },
  });

  const beforeDispatch = getBeforeDispatch(hookManager);
  await beforeDispatch.handler({
    userId: "u1",
    sessionId: "s-failure-fanout",
    dialogProcessId: "d-failure-fanout",
    userMessage: "请运行失败传播流程",
    runConfig: { locale: "zh-CN" },
  });
  const callByNodeName = callsByNodeName(subSessionCalls);
  const nodeBSystem = String(callByNodeName.get("节点B")?.systemMessages?.[0] || "");
  const nodeCSystem = String(callByNodeName.get("节点C")?.systemMessages?.[0] || "");
  assert.match(nodeBSystem, /节点A（任务：执行A任务）: 节点A失败/);
  assert.match(nodeCSystem, /节点A（任务：执行A任务）: 节点A失败/);
});

test("workflow hook injects failed upstream task+error from multiple upstream into single downstream node", async () => {
  const hookManager = createMockBotHookManager();
  const registerWorkflowHooks = createRegisterWorkflowHooks();
  const subSessionCalls = [];

  registerWorkflowHooks({
    hookManager,
    options: {
      enabled: true,
      mode: "on",
      parallelNodeExecution: true,
      maxParallelNodeAgents: WORKFLOW_PLUGIN_DEFAULTS.DEFAULT_MAX_PARALLEL_NODE_AGENTS,
      capabilityModelInvoker: async () => ({
        output: [
          "WORKFLOW_DSL/1",
          'NODE id=start type=state stateType=start name="开始"',
          'NODE id=branch type=state stateType=branch name="分叉"',
          'NODE id=a type=action name="节点A" task="执行A任务"',
          'NODE id=b type=action name="节点B" task="执行B任务"',
          'NODE id=merge type=state stateType=merge name="汇聚"',
          'NODE id=c type=action name="节点C" task="执行C任务"',
          'NODE id=end type=state stateType=end name="结束"',
          "EDGE from=start to=branch",
          "EDGE from=branch to=a",
          "EDGE from=branch to=b",
          "EDGE from=a to=merge",
          "EDGE from=b to=merge",
          "EDGE from=merge to=c",
          "EDGE from=c to=end",
          "END",
        ].join("\n"),
      }),
      subSessionRunner: async (payload = {}) => {
        subSessionCalls.push(payload);
        const nodeName = String(payload?.metadata?.nodeName || "").trim();
        if (nodeName === "节点A") throw new Error("节点A失败");
        return {
          sessionId: `session-${nodeName}`,
          dialogProcessId: `dialog-${nodeName}`,
          result: { messages: [{ role: "assistant", content: `ok-${nodeName}` }] },
        };
      },
      generatedArtifactPersister: async () => [],
    },
  });

  const beforeDispatch = getBeforeDispatch(hookManager);
  await beforeDispatch.handler({
    userId: "u1",
    sessionId: "s-failure-merge",
    dialogProcessId: "d-failure-merge",
    userMessage: "请运行失败传播流程",
    runConfig: { locale: "zh-CN" },
  });
  const callByNodeName = callsByNodeName(subSessionCalls);
  const nodeCSystem = String(callByNodeName.get("节点C")?.systemMessages?.[0] || "");
  assert.match(nodeCSystem, /节点A（任务：执行A任务）: 节点A失败/);
});

test("workflow hook injects failed upstream task+error from multiple upstream into multiple downstream nodes", async () => {
  const hookManager = createMockBotHookManager();
  const registerWorkflowHooks = createRegisterWorkflowHooks();
  const subSessionCalls = [];

  registerWorkflowHooks({
    hookManager,
    options: {
      enabled: true,
      mode: "on",
      parallelNodeExecution: true,
      maxParallelNodeAgents: WORKFLOW_PLUGIN_DEFAULTS.DEFAULT_MAX_PARALLEL_NODE_AGENTS,
      capabilityModelInvoker: async () => ({
        output: [
          "WORKFLOW_DSL/1",
          'NODE id=start type=state stateType=start name="开始"',
          'NODE id=branch type=state stateType=branch name="分叉"',
          'NODE id=a type=action name="节点A" task="执行A任务"',
          'NODE id=b type=action name="节点B" task="执行B任务"',
          'NODE id=merge type=state stateType=merge name="汇聚"',
          'NODE id=branch2 type=state stateType=branch name="汇聚后分叉"',
          'NODE id=c type=action name="节点C" task="执行C任务"',
          'NODE id=d type=action name="节点D" task="执行D任务"',
          'NODE id=end type=state stateType=end name="结束"',
          "EDGE from=start to=branch",
          "EDGE from=branch to=a",
          "EDGE from=branch to=b",
          "EDGE from=a to=merge",
          "EDGE from=b to=merge",
          "EDGE from=merge to=branch2",
          "EDGE from=branch2 to=c",
          "EDGE from=branch2 to=d",
          "EDGE from=c to=end",
          "EDGE from=d to=end",
          "END",
        ].join("\n"),
      }),
      subSessionRunner: async (payload = {}) => {
        subSessionCalls.push(payload);
        const nodeName = String(payload?.metadata?.nodeName || "").trim();
        if (nodeName === "节点A") throw new Error("节点A失败");
        return {
          sessionId: `session-${nodeName}`,
          dialogProcessId: `dialog-${nodeName}`,
          result: { messages: [{ role: "assistant", content: `ok-${nodeName}` }] },
        };
      },
      generatedArtifactPersister: async () => [],
    },
  });

  const beforeDispatch = getBeforeDispatch(hookManager);
  await beforeDispatch.handler({
    userId: "u1",
    sessionId: "s-failure-multi",
    dialogProcessId: "d-failure-multi",
    userMessage: "请运行失败传播流程",
    runConfig: { locale: "zh-CN" },
  });
  const callByNodeName = callsByNodeName(subSessionCalls);
  const nodeCSystem = String(callByNodeName.get("节点C")?.systemMessages?.[0] || "");
  const nodeDSystem = String(callByNodeName.get("节点D")?.systemMessages?.[0] || "");
  assert.match(nodeCSystem, /节点A（任务：执行A任务）: 节点A失败/);
  assert.match(nodeDSystem, /节点A（任务：执行A任务）: 节点A失败/);
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

  const beforeDispatch = getBeforeDispatch(hookManager);
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

  const beforeDispatch = getBeforeDispatch(hookManager);
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

test("workflow semantic planning falls back to messageBlocks context when ctx.messages is empty", async () => {
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
      resolveMessageBlock: ({ scope = "", messages = [] } = {}) => {
        if (scope === "conversation") return messages.slice(0, 2);
        return messages;
      },
      resolveModelMessages: ({ messages = [] } = {}) => messages,
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
        sessionId: "wf-node-session-context-blocks",
        dialogProcessId: "wf_node_dialog_context_blocks",
        result: { answer: "done", messages: [{ role: "assistant", content: "done" }] },
      }),
      generatedArtifactPersister: async () => [],
      workflowDialogPersister: async () => null,
      workflowEventLogger: async () => null,
    },
  });

  const beforeDispatch = getBeforeDispatch(hookManager);
  await beforeDispatch.handler({
    userId: "u1",
    sessionId: "s1",
    dialogProcessId: "d1",
    userMessage: "请根据上下文继续生成工作流",
    runConfig: { locale: "zh-CN" },
    messages: [],
    messageBlocks: {
      system: [{ role: "system", content: "你是流程专家" }],
      history: [
        { role: "user", content: "背景：这是采购审批流程" },
        { role: "assistant", content: "收到采购审批背景" },
      ],
      incremental: [{ role: "user", content: "请继续" }],
    },
  });

  assert.equal(invokerCalls.length, 1);
  const semanticMessages = invokerCalls[0]?.messages || [];
  assert.equal(semanticMessages[0]?.role, "system");
  assert.equal(semanticMessages[0]?.content, "你是流程专家");
  assert.equal(semanticMessages[1]?.role, "user");
  assert.equal(semanticMessages[1]?.content, "背景：这是采购审批流程");
  assert.equal(semanticMessages[2]?.role, "assistant");
  assert.equal(semanticMessages[2]?.content, "收到采购审批背景");
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
      capabilityModelInvoker: async (payload = {}) => {
        invokerCalls.push(payload);
        return {
          output: [
            "WORKFLOW_DSL/1",
            'NODE id=start type=state stateType=start name="开始"',
            'NODE id=act type=action name="生成报告" task="使用 search_docs 查询资料后生成报告"',
            'NODE id=end type=state stateType=end name="结束"',
            'EDGE from=start to=act',
            'EDGE from=act to=end',
            "END",
          ].join("\n"),
        };
      },
      subSessionRunner: async () => ({
        sessionId: "wf-node-session-tools",
        dialogProcessId: "wf_node_dialog_tools",
        result: { answer: "done", messages: [{ role: "assistant", content: "done" }] },
      }),
      generatedArtifactPersister: async () => [],
      workflowDialogPersister: async () => null,
      workflowEventLogger: async () => null,
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
  assert.match(String(availableToolsMessage?.content || ""), /检索项目文档和知识库/);
  assert.match(String(availableToolsMessage?.content || ""), /write_file/);
  assert.match(String(availableToolsMessage?.content || ""), /不要臆造工具名/);
  const semanticTask = String(semanticMessages.at(-1)?.content || "");
  assert.doesNotMatch(semanticTask, /当前可用工具/);
});

test("workflow semantic planning reads available tools from runtimeAgentContext", async () => {
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
      capabilityModelInvoker: async (payload = {}) => {
        invokerCalls.push(payload);
        return {
          output: [
            "WORKFLOW_DSL/1",
            'NODE id=start type=state stateType=start name="开始"',
            'NODE id=act type=action name="生成报告" task="使用 search_docs 查询资料后生成报告"',
            'NODE id=end type=state stateType=end name="结束"',
            'EDGE from=start to=act',
            'EDGE from=act to=end',
            "END",
          ].join("\n"),
        };
      },
      subSessionRunner: async () => ({
        sessionId: "wf-node-session-runtime-tools",
        dialogProcessId: "wf_node_dialog_runtime_tools",
        result: { answer: "done", messages: [{ role: "assistant", content: "done" }] },
      }),
      generatedArtifactPersister: async () => [],
      workflowDialogPersister: async () => null,
      workflowEventLogger: async () => null,
    },
  });

  const beforeDispatch = getBeforeDispatch(hookManager);
  await beforeDispatch.handler({
    userId: "u1",
    sessionId: "s1",
    dialogProcessId: "d1",
    userMessage: "查资料并生成报告",
    runConfig: { locale: "zh-CN" },
    runtimeAgentContext: {
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

test("workflow semantic planning falls back to runtimeAgentContext history when ctx.messages is empty", async () => {
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
        sessionId: "wf-node-session-runtime-history",
        dialogProcessId: "wf_node_dialog_runtime_history",
        result: { answer: "done", messages: [{ role: "assistant", content: "done" }] },
      }),
      generatedArtifactPersister: async () => [],
      workflowDialogPersister: async () => null,
      workflowEventLogger: async () => null,
    },
  });

  const beforeDispatch = getBeforeDispatch(hookManager);
  await beforeDispatch.handler({
    userId: "u1",
    sessionId: "s1",
    dialogProcessId: "d1",
    userMessage: "请结合上下文生成工作流",
    runConfig: { locale: "zh-CN" },
    messages: [],
    runtimeAgentContext: {
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
  assert.equal(semanticMessages[0]?.role, "user");
  assert.equal(semanticMessages[0]?.content, "历史背景：审批流程包含财务复核");
  assert.equal(semanticMessages[1]?.role, "assistant");
  assert.equal(semanticMessages[1]?.content, "已记录财务复核约束");
  assert.match(String(semanticMessages.at(-1)?.content || ""), /当前用户消息:\n请结合上下文生成工作流/);
});

test("workflow hook aborts node sub-session when parent stop signal fires", async () => {
  const hookManager = createMockBotHookManager();
  const registerWorkflowHooks = createRegisterWorkflowHooks();
  const abortController = new AbortController();
  let receivedAbortSignal = null;

  registerWorkflowHooks({
    hookManager,
    options: {
      enabled: true,
      mode: "on",
      semanticModel: "semantic-model",
      semanticPrompt: "emit workflow dsl",
      capabilityModelInvoker: async () => ({
        output: [
          "WORKFLOW_DSL/1",
          'NODE id=start type=state stateType=start name="开始"',
          'NODE id=act type=action name="节点A" task="执行当前请求"',
          'NODE id=end type=state stateType=end name="结束"',
          'EDGE from=start to=act',
          'EDGE from=act to=end',
          "END",
        ].join("\n"),
      }),
      subSessionRunner: async ({ abortSignal } = {}) => {
        receivedAbortSignal = abortSignal;
        setTimeout(() => {
          abortController.abort({ type: "user_stop", reason: "test stop" });
        }, 0);
        await new Promise((resolve, reject) => {
          if (abortSignal?.aborted) {
            const error = new Error("aborted before node");
            error.name = "AbortError";
            reject(error);
            return;
          }
          abortSignal?.addEventListener(
            "abort",
            () => {
              const error = new Error("aborted node");
              error.name = "AbortError";
              reject(error);
            },
            { once: true },
          );
        });
      },
      generatedArtifactPersister: async () => [],
      workflowDialogPersister: async () => null,
      workflowEventLogger: async () => null,
    },
  });

  const beforeDispatch = getBeforeDispatch(hookManager);
  await assert.rejects(
    () =>
      beforeDispatch.handler({
        userId: "u1",
        sessionId: "s1",
        dialogProcessId: "d1",
        userMessage: "请执行一个工作流",
        runConfig: { locale: "zh-CN" },
        abortSignal: abortController.signal,
      }),
    (error) => {
      assert.equal(error?.name, "AbortError");
      return true;
    },
  );
  assert.equal(receivedAbortSignal, abortController.signal);
});
