import test from "node:test";
import assert from "node:assert/strict";

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
  WORKFLOW_BOT_HOOK_POINTS,
  WORKFLOW_PLUGIN_DEFAULTS,
  resolveWorkflowNodeDialogProcessId,
  collectWorkflowDialogProcessIds,
  resolveWorkflowDialogProcessId,
} from "./helpers/workflow-hook-session-strategy-helper.js";

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
  assert.equal(agentResult.workflow?.attachments, undefined);
  assert.equal(agentResult.workflow.nodeSessions[0]?.attachments, undefined);

  const workflowTurnMessage = workflowTurn(agentResult);
  assert.ok(workflowTurnMessage);
  assert.equal(workflowTurnMessage?.type, "workflow");
  assert.equal(workflowTurnMessage?.attachments, undefined);
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


