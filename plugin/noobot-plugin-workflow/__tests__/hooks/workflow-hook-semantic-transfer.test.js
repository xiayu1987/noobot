/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import { HOOK_POINT } from "@noobot/hook-protocol";

import {
  createMockBotHookManager,
  workflowDsl,
  simpleActionWorkflowDsl,
  createCapabilityModelInvoker,
  createNodeResult,
  createRecordingSubSessionRunner,
  createAttachmentPersister,
  createSemanticTransferTool,
  createV2AttachmentTransferEnvelope,
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

test("workflow hook uses injected sub-session strategy and marks workflow message", async () => {
  const hookManager = createMockBotHookManager();
  const registerWorkflowHooks = createRegisterWorkflowHooks();
  const subSessionCalls = [];
  const semanticTransferCalls = [];
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
          lifecycle: { executionId: payload?.strategy?.executionId || payload?.metadata?.executionId, executionKind: "agent", state: "completed", revision: 4, sequence: 4 },
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
      generatedArtifactPersister: undefined,
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
      turnScopeId: "root-turn-1",
      messageId: "assistant-message-1",
      presentationMessageId: "assistant-presentation-1",
    },
    agentContext: {
      execution: {
        controllers: {
          runtime: {
            materializePendingCurrentTurnMessageEvents() {
              return { activityTimeline: [{
                eventId: "workflow_semantic:test",
                event: "workflow_semantic_response",
                type: "workflow_semantic",
                text: "canonical workflow analysis",
                output: "canonical workflow analysis",
                sequence: 1,
                sequenceDomain: "message-event",
                sequenceScopeId: "assistant-presentation-1",
                authority: "authoritative",
              }], toolTimeline: [] };
            },
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
              semanticTransfer: createSemanticTransferTool({
                calls: semanticTransferCalls,
                prefix: "wf-node-result",
                sessionId: "s1",
                calls: semanticTransferCalls,
              }),
            },
          },
        },
      },
    },
    eventListener: {
      onEvent() {},
    },
  };
  const dispatchOutcome = await beforeDispatch.handler(beforeContext);
  const agentResult = dispatchOutcome?.result;
  assert.ok(agentResult);

  assert.equal(subSessionCalls.length, 1);
  assert.equal(semanticTransferCalls.some((item) => item?.strategy === "bot_plugin_subagent_result"), true);
  assert.equal(planningPersistCalls.length, 1);
  assert.equal(eventLogCalls.length > 0, true);
  const planningRuntimeEvent = eventLogCalls.find(
    (call = {}) => call?.event?.event === "workflow_planning_message_prepared",
  )?.event;
  assert.equal(planningRuntimeEvent?.turnScopeId, "root-turn-1");
  assert.equal(planningRuntimeEvent?.presentationMessageId, "assistant-presentation-1");
  assert.equal(planningRuntimeEvent?.workflowPayload?.workflowRunId, planningRuntimeEvent?.workflowRunId);
  assert.equal(Array.isArray(planningRuntimeEvent?.workflowPayload?.semantic?.nodes), true);
  assert.equal(Array.isArray(planningRuntimeEvent?.workflowPayload?.semantic?.flowtos), true);
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
  assert.match(String(subCall?.runConfigPatch?.turnScopeId || ""), /^workflow-node:root-turn-1_/);
  assert.equal(subCall?.strategy?.turnScopeId, subCall?.runConfigPatch?.turnScopeId);
  assert.equal(subCall?.metadata?.turnScopeId, subCall?.runConfigPatch?.turnScopeId);
  assert.equal(typeof subCall?.eventListener?.onEvent, "function");
  assert.match(
    String(subCall?.strategy?.relativeDir || ""),
    /^runtime\/workflow\/session\/s1\/wf_node_/,
  );

  assert.ok(agentResult.workflow);
  assert.ok(String(agentResult.workflow?.workflowRunId || "").trim());
  assert.equal(
    agentResult.workflow?.execution?.workflowRunId,
    agentResult.workflow?.workflowRunId,
  );
  assert.equal(
    agentResult.workflow?.execution?.instanceId,
    agentResult.workflow?.workflowRunId,
  );
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
  assert.equal(agentResult.workflow?.execution?.nodeAgentRuns?.[0]?.stepStatus, undefined);
  assert.equal(agentResult.workflow?.attachments, undefined);
  assert.equal(agentResult.workflow.nodeSessions[0]?.attachments, undefined);

  const workflowTurnMessage = workflowTurn(agentResult);
  assert.ok(workflowTurnMessage);
  assert.equal(workflowTurnMessage?.type, "workflow");
  assert.equal(workflowTurnMessage?.chatPresentation, true);
  assert.equal(workflowTurnMessage?.presentationMessageId, "assistant-presentation-1");
  assert.equal(workflowTurnMessage?.messageId, "assistant-message-1");
  assert.equal(workflowTurnMessage?.id, "assistant-message-1");
  assert.equal(agentResult?.assistantMessageId, "assistant-message-1");
  assert.equal(workflowTurnMessage?.attachments, undefined);
  assert.equal(
    workflowTurnMessage?.transferEnvelopes?.some(
      (item) => item?.payload?.attachments?.[0]?.identity?.attachmentId === "wf-node-result-1",
    ),
    true,
  );
  assert.equal(workflowTurnMessage?.activityTimeline?.length, 1);
  assert.equal(workflowTurnMessage?.activityTimeline?.[0]?.eventId, "workflow_semantic:test");
  assert.equal(workflowTurnMessage?.activityTimeline?.[0]?.event, "workflow_semantic_response");
  assert.equal(workflowTurnMessage?.activityTimeline?.[0]?.text, "canonical workflow analysis");
  assert.match(String(workflowTurnMessage?.content || ""), /attachmentId=wf-node-result-1/);
  assert.match(String(workflowTurnMessage?.content || ""), /^WORKFLOW_DSL\/1/);
  assert.equal(String(workflowTurnMessage?.content || "").includes("message-node-done"), false);
  assert.equal(String(workflowTurnMessage?.content || "").includes("answer-node-done"), false);
  assert.equal(workflowTurnMessage?.pluginMeta?.source, "workflow-plugin");
  assert.equal(
    workflowTurnMessage?.pluginMeta?.payload?.workflowRunId,
    agentResult.workflow?.workflowRunId,
  );
  assert.equal(
    workflowTurnMessage?.pluginMeta?.payload?.execution?.nodeAgentRuns?.[0]?.nodeResultText,
    undefined,
  );
  assert.equal(
    workflowTurnMessage?.pluginMeta?.payload?.execution?.nodeAgentRuns?.[0]?.stepStatus,
    undefined,
  );
  assert.equal(
    workflowTurnMessage?.pluginMeta?.payload?.nodeSessions?.[0]?.stepStatus,
    undefined,
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
  const envelope = createV2AttachmentTransferEnvelope({
    attachmentId: "wf-semantic-result-1",
    sessionId: "s1",
    producerId: "wf-semantic-node-session-1",
    name: "workflow-node-result.md",
  });

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
      subSessionRunner: async (payload = {}) => ({
        lifecycle: { executionId: payload?.strategy?.executionId || payload?.metadata?.executionId, executionKind: "agent", state: "completed", revision: 4, sequence: 4 },
        sessionId: "wf-semantic-node-session-1",
        dialogProcessId: "wf_semantic_node_dialog_1",
        result: {
          answer: "semantic-node-done",
          messages: [{ role: "assistant", content: "semantic-node-done", type: "message" }],
        },
      }),
      generatedArtifactPersister: undefined,
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
                    if (String(strategy || "") !== "bot_plugin_final_return") return { transferEnvelopes: [] };
                  }
                  const isFinal = String(strategy || "") === "bot_plugin_final_return";
                  return {
                    transferEnvelopes: [isFinal ? createV2AttachmentTransferEnvelope({
                      attachmentId: "wf-semantic-final-1",
                      sessionId: "s1",
                      producerType: "plugin",
                      producerId: "workflow-final-summary",
                      transferId: "transfer-wf-semantic-final-1",
                      messageId: "message-wf-semantic-final-1",
                      name: "final-summary.md",
                      strategy: "bot_plugin_final_return",
                      reason: "workflow_completed_attachment_summary",
                    }) : envelope],
                  };
                },
              },
            },
          },
        },
      },
    },
  };

  const dispatchOutcome = await beforeDispatch.handler(ctx);
  const agentResult = dispatchOutcome?.result;
  assert.ok(agentResult?.workflow);
  assert.equal(fallbackArtifactCalls.length, 0);
  assert.equal(agentResult.workflow?.transferEnvelopes?.length >= 1, true);
  assert.equal(agentResult.workflow?.transferEnvelopes?.[0]?.protocol, "noobot.semantic-transfer");
  assert.equal(agentResult.workflow?.nodeSessions?.[0]?.transferEnvelopes?.length >= 1, true);
  assert.equal(agentResult.workflow?.nodeSessions?.[0]?.transferEnvelopes?.[0]?.protocol, "noobot.semantic-transfer");
  const workflowTurnMessage = workflowTurn(agentResult);
  assert.equal(workflowTurnMessage?.chatPresentation, true);
  assert.equal(workflowTurnMessage?.transferEnvelopes?.length >= 1, true);
  assert.equal(workflowTurnMessage?.transferEnvelopes?.[0]?.protocol, "noobot.semantic-transfer");
  assert.equal(workflowTurnMessage?.transferEnvelopes?.[0]?.payload?.attachments?.[0]?.identity?.attachmentId, "wf-semantic-result-1");
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
      subSessionRunner: async (payload = {}) => ({
        lifecycle: { executionId: payload?.strategy?.executionId || payload?.metadata?.executionId, executionKind: "agent", state: "completed", revision: 4, sequence: 4 },
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
                  const suffix = generationSource === "workflow_completed_attachment_summary"
                    ? "final"
                    : "node";
                  const envelope = createV2AttachmentTransferEnvelope({
                    attachmentId: `wf-semantic-${suffix}-1`,
                    sessionId: "s1",
                    producerType: "plugin",
                    producerId: `workflow-${suffix}-summary`,
                    transferId: `transfer-wf-semantic-${suffix}-1`,
                    messageId: `message-wf-semantic-${suffix}-1`,
                    name: `${suffix}-summary.md`,
                    strategy: "bot_plugin_final_return",
                    reason: "workflow_completed_attachment_summary",
                  });
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
  const dispatchOutcome = await beforeDispatch.handler(ctx);

  const hasFinalSummaryCall = semanticTransferCalls.some(
    (item = {}) =>
      String(item?.scenario || "").trim() === "bot_plugin" &&
      String(item?.strategy || "").trim() === "bot_plugin_final_return" &&
      String(item?.generationSource || "").trim() === "workflow_completed_attachment_summary",
  );
  assert.equal(hasFinalSummaryCall, true);
  const agentResult = dispatchOutcome?.result;
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
      (item = {}) => String(item?.payload?.attachments?.[0]?.identity?.attachmentId || "").trim() === "wf-semantic-final-1",
    ),
    true,
  );
  assert.equal(
    workflowPayloadTransferEnvelopes.some(
      (item = {}) => String(item?.payload?.attachments?.[0]?.identity?.attachmentId || "").trim() === "wf-semantic-final-1",
    ),
    true,
  );
  const workflowContent = String(workflowTurnMessage?.content || "");
  assert.match(workflowContent, /final-summary\.md/);
  assert.doesNotMatch(workflowContent, /node-summary\.md/);
});
