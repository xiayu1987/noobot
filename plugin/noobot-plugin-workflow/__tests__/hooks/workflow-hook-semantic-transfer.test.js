/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";

import {
  createMockBotHookManager,
  createSemanticTransferTool,
  createV2AttachmentTransferEnvelope,
  installTurnMessageEventRuntimeFixture,
  getBeforeDispatch,
  workflowTurn,
  registerWorkflowAgentHooks,
  createTestHookInvocation,
} from "../helpers/workflow-hook-session-strategy-helper.js";
import { TRANSFER_REASON } from "@noobot/semantic-transfer-protocol";

test("workflow hook uses injected sub-session strategy and marks workflow message", async () => {
  const hookManager = createMockBotHookManager();
  const subSessionCalls = [];
  const semanticTransferCalls = [];

  const disposers = registerWorkflowAgentHooks({
    hookManager,
    config: {
      enabled: true,
      mode: "on",
      semanticModel: "qwen3_6_plus",
      semanticPrompt: "emit workflow dsl",
      resolveModelMessages: () => [],
      capabilityModelInvoker: async () => ({
        output: {
          text: [
            "WORKFLOW_DSL/1",
            'NODE id=start type=state stateType=start name="开始"',
            'NODE id=act type=action name="节点A" task="请输出：节点A执行完成"',
            'NODE id=end type=state stateType=end name="结束"',
            "EDGE from=start to=act",
            "EDGE from=act to=end",
            "END",
          ].join("\n"),
        },
        traces: [{ id: "semantic_trace_1" }],
      }),
      subSessionRunner: async (payload = {}) => {
        subSessionCalls.push(payload);
        return {
          lifecycle: {
            executionId: payload?.strategy?.executionId || payload?.metadata?.executionId,
            executionKind: "agent",
            state: "completed",
            revision: 4,
            sequence: 4,
          },
          sessionId: "wf-node-session-1",
          dialogProcessId: "wf_node_dialog_1",
          persisted: { outputDir: "/tmp/noobot/workflow/s1/node1" },
          result: {
            answer: 'answer-node-done\n\n[Harness-Review]\n{"status":"pass"}',
            messages: [{ role: "assistant", content: "message-node-done", type: "message" }],
          },
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
      presentationMessageId: "assistant-presentation-1",
    },
    agentContext: {
      bindings: {
        runtime: {
          materializeUnownedCurrentTurnMessageEvents() {
            return {
              activityTimeline: [
                {
                  eventId: "workflow_semantic:test",
                  event: "workflow_semantic_response",
                  type: "workflow_semantic",
                  text: "canonical workflow analysis",
                  output: "canonical workflow analysis",
                  sequence: 1,
                  sequenceDomain: "message-event",
                  sequenceScopeId: "assistant-presentation-1",
                  authority: "authoritative",
                },
              ],
              toolTimeline: [],
            };
          },
          sharedTools: {
            resolveAttachmentDisplayPath({ meta = {} } = {}) {
              const normalized = String(meta?.path || "").trim();
              if (!normalized) return "";
              return `/injected${normalized.startsWith("/") ? normalized : `/${normalized}`}`;
            },
            semanticTransfer: createSemanticTransferTool({
              calls: semanticTransferCalls,
              prefix: "wf-node-result",
              sessionId: "s1",
            }),
          },
        },
      },
    },
    eventListener: {
      onEvent() {},
    },
  };
  const dispatchOutcome = await beforeDispatch.handler(beforeContext, createTestHookInvocation());
  const agentResult = dispatchOutcome?.result;
  assert.ok(agentResult);

  assert.equal(subSessionCalls.length, 1);
  assert.equal(
    semanticTransferCalls.some((item) => item?.strategy === "workflow_subagent"),
    true,
  );

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
  assert.match(
    String(subCall?.runConfigPatch?.turnScopeId || ""),
    /^workflow-node:agent_root-turn-1_/,
  );
  assert.equal(subCall?.strategy?.turnScopeId, subCall?.runConfigPatch?.turnScopeId);
  assert.equal(subCall?.metadata?.turnScopeId, subCall?.runConfigPatch?.turnScopeId);
  assert.equal(typeof subCall?.eventListener?.onEvent, "function");
  assert.match(
    String(subCall?.strategy?.relativeDir || ""),
    /^runtime\/plugin-data\/workflow\/session\/s1\/wf_node_/,
  );

  assert.ok(workflowTurn(agentResult).pluginMeta.payload);
  assert.ok(String(workflowTurn(agentResult).pluginMeta.payload?.workflowRunId || "").trim());
  assert.equal("workflowRunId" in workflowTurn(agentResult).pluginMeta.payload.execution, false);
  assert.equal("instanceId" in workflowTurn(agentResult).pluginMeta.payload.execution, false);
  assert.equal(workflowTurn(agentResult).pluginMeta.payload?.runMeta?.dialogProcessId, "d1");
  assert.equal("planningDialog" in workflowTurn(agentResult).pluginMeta.payload, false);
  assert.match(
    String(workflowTurn(agentResult).pluginMeta.payload.nodeSessions[0]?.dialogProcessId || ""),
    /^wf_node_/,
  );
  assert.equal(workflowTurn(agentResult).pluginMeta.payload.nodeSessions[0]?.dialogId, undefined);
  assert.match(
    String(
      workflowTurn(agentResult).pluginMeta.payload?.execution?.nodeAgentRuns?.[0]
        ?.nodeDialogProcessId || "",
    ),
    /^wf_node_/,
  );
  assert.equal(
    workflowTurn(agentResult).pluginMeta.payload?.execution?.nodeAgentRuns?.[0]?.nodeDialogId,
    undefined,
  );
  assert.equal(Array.isArray(workflowTurn(agentResult).pluginMeta.payload?.nodeSessions), true);
  assert.equal(workflowTurn(agentResult).pluginMeta.payload.nodeSessions.length, 1);
  assert.equal(workflowTurn(agentResult).pluginMeta.payload.nodeSessions[0]?.rootSessionId, "s1");
  assert.equal(
    workflowTurn(agentResult).pluginMeta.payload.nodeSessions[0]?.sessionId,
    "wf-node-session-1",
  );
  assert.equal(
    workflowTurn(agentResult).pluginMeta.payload?.execution?.nodeAgentRuns?.[0]?.status,
    undefined,
  );
  assert.equal(workflowTurn(agentResult).pluginMeta.payload?.attachments, undefined);
  assert.equal(
    workflowTurn(agentResult).pluginMeta.payload.nodeSessions[0]?.attachments,
    undefined,
  );

  const workflowTurnMessage = workflowTurn(agentResult);
  assert.ok(workflowTurnMessage);
  assert.equal(workflowTurnMessage?.type, "workflow");
  assert.equal(workflowTurnMessage?.chatPresentation, true);
  assert.equal(workflowTurnMessage?.presentationMessageId, "assistant-presentation-1");
  assert.match(workflowTurnMessage?.modelMessageId, /^mm_[0-9a-f-]{36}$/);
  assert.equal(workflowTurnMessage?.messageId, undefined);
  assert.equal(agentResult?.modelMessageId, workflowTurnMessage.modelMessageId);
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
    workflowTurn(agentResult).pluginMeta.payload?.workflowRunId,
  );
  assert.equal(
    workflowTurnMessage?.pluginMeta?.payload?.execution?.nodeAgentRuns?.[0]?.nodeResultText,
    undefined,
  );
  assert.equal(
    workflowTurnMessage?.pluginMeta?.payload?.execution?.nodeAgentRuns?.[0]?.status,
    undefined,
  );
  assert.equal(workflowTurnMessage?.pluginMeta?.payload?.nodeSessions?.[0]?.status, "succeeded");
});

test("workflow hook propagates semantic transfer envelopes for node result artifacts", async () => {
  const hookManager = createMockBotHookManager();
  const fallbackArtifactCalls = [];
  const envelope = createV2AttachmentTransferEnvelope({
    attachmentId: "wf-semantic-result-1",
    sessionId: "s1",
    producerId: "wf-semantic-node-session-1",
    name: "workflow-node-result.md",
  });

  registerWorkflowAgentHooks({
    hookManager,
    config: {
      enabled: true,
      mode: "on",
      semanticModel: "qwen3_6_plus",
      resolveModelMessages: () => [],
      capabilityModelInvoker: async () => ({
        output: {
          text: [
            "WORKFLOW_DSL/1",
            'NODE id=start type=state stateType=start name="开始"',
            'NODE id=act type=action name="节点A" task="请输出节点结果"',
            'NODE id=end type=state stateType=end name="结束"',
            "EDGE from=start to=act",
            "EDGE from=act to=end",
            "END",
          ].join("\n"),
        },
      }),
      subSessionRunner: async (payload = {}) => ({
        lifecycle: {
          executionId: payload?.strategy?.executionId || payload?.metadata?.executionId,
          executionKind: "agent",
          state: "completed",
          revision: 4,
          sequence: 4,
        },
        sessionId: "wf-semantic-node-session-1",
        dialogProcessId: "wf_semantic_node_dialog_1",
        result: {
          answer: "semantic-node-done",
          messages: [{ role: "assistant", content: "semantic-node-done", type: "message" }],
        },
      }),
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
      bindings: {
        runtime: {
          sharedTools: {
            semanticTransfer: {
              async transferSemanticContent({ scenario = "", strategy = "" } = {}) {
                if (String(scenario || "") !== "workflow") {
                  return { transferEnvelopes: [] };
                }
                const isFinal = String(strategy || "") === "workflow_final_plan";
                return {
                  transferEnvelopes: [
                    isFinal
                      ? createV2AttachmentTransferEnvelope({
                          attachmentId: "wf-semantic-final-1",
                          sessionId: "s1",
                          producerType: "plugin",
                          producerId: "workflow-final-summary",
                          transferId: "transfer-wf-semantic-final-1",
                          presentationMessageId: "presentation-wf-semantic-final-1",
                          name: "final-summary.md",
                          scenario: "workflow",
                          strategy: "workflow_final_plan",
                          reason: TRANSFER_REASON.WORKFLOW_FINAL_ATTACHMENT_SUMMARY,
                        })
                      : envelope,
                  ],
                };
              },
            },
          },
        },
      },
    },
  };

  const dispatchOutcome = await beforeDispatch.handler(ctx, createTestHookInvocation());
  const agentResult = dispatchOutcome?.result;
  assert.ok(workflowTurn(agentResult).pluginMeta.payload);
  assert.equal(fallbackArtifactCalls.length, 0);
  assert.equal(workflowTurn(agentResult).pluginMeta.payload?.transferEnvelopes?.length >= 1, true);
  assert.equal(
    workflowTurn(agentResult).pluginMeta.payload?.transferEnvelopes?.[0]?.protocol,
    "noobot.semantic-transfer",
  );
  assert.equal(
    workflowTurn(agentResult).pluginMeta.payload?.nodeSessions?.[0]?.transferEnvelopes?.length >= 1,
    true,
  );
  assert.equal(
    workflowTurn(agentResult).pluginMeta.payload?.nodeSessions?.[0]?.transferEnvelopes?.[0]
      ?.protocol,
    "noobot.semantic-transfer",
  );
  const workflowTurnMessage = workflowTurn(agentResult);
  assert.equal(workflowTurnMessage?.chatPresentation, true);
  assert.equal(workflowTurnMessage?.transferEnvelopes?.length >= 1, true);
  assert.equal(workflowTurnMessage?.transferEnvelopes?.[0]?.protocol, "noobot.semantic-transfer");
  assert.equal(
    workflowTurnMessage?.transferEnvelopes?.[0]?.payload?.attachments?.[0]?.identity?.attachmentId,
    "wf-semantic-result-1",
  );
});

test("workflow hook routes final attachment summary composition through semantic-transfer", async () => {
  const hookManager = createMockBotHookManager();
  const semanticTransferCalls = [];

  registerWorkflowAgentHooks({
    hookManager,
    config: {
      enabled: true,
      mode: "on",
      semanticModel: "qwen3_6_plus",
      resolveModelMessages: () => [],
      capabilityModelInvoker: async () => ({
        output: {
          text: [
            "WORKFLOW_DSL/1",
            'NODE id=start type=state stateType=start name="开始"',
            'NODE id=act type=action name="节点A" task="请输出节点结果"',
            'NODE id=end type=state stateType=end name="结束"',
            "EDGE from=start to=act",
            "EDGE from=act to=end",
            "END",
          ].join("\n"),
        },
      }),
      subSessionRunner: async (payload = {}) => ({
        lifecycle: {
          executionId: payload?.strategy?.executionId || payload?.metadata?.executionId,
          executionKind: "agent",
          state: "completed",
          revision: 4,
          sequence: 4,
        },
        sessionId: "wf-summary-node-session-1",
        dialogProcessId: "wf_summary_node_dialog_1",
        result: {
          answer: "summary-node-done",
          messages: [{ role: "assistant", content: "summary-node-done", type: "message" }],
        },
      }),
    },
  });

  const beforeDispatch = getBeforeDispatch(hookManager);
  const ctx = installTurnMessageEventRuntimeFixture({
    userId: "u1",
    sessionId: "s1",
    dialogProcessId: "d1",
    userMessage: "请给我一个语义传递工作流",
    runConfig: { locale: "zh-CN", streaming: false },
    agentContext: {
      bindings: {
        runtime: {
          sharedTools: {
            semanticTransfer: {
              async transferSemanticContent(payload = {}) {
                semanticTransferCalls.push(payload);
                const generationSource = String(payload?.generationSource || "").trim();
                const suffix =
                  generationSource === "workflow_completed_attachment_summary" ? "final" : "node";
                const envelope = createV2AttachmentTransferEnvelope({
                  attachmentId: `wf-semantic-${suffix}-1`,
                  sessionId: "s1",
                  producerType: "plugin",
                  producerId: `workflow-${suffix}-summary`,
                  transferId: `transfer-wf-semantic-${suffix}-1`,
                  presentationMessageId: `presentation-wf-semantic-${suffix}-1`,
                  name: `${suffix}-summary.md`,
                  scenario: String(payload?.scenario || "").trim(),
                  strategy: String(payload?.strategy || "").trim(),
                  reason: TRANSFER_REASON.WORKFLOW_FINAL_ATTACHMENT_SUMMARY,
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
  });
  const dispatchOutcome = await beforeDispatch.handler(ctx, createTestHookInvocation());

  const hasFinalSummaryCall = semanticTransferCalls.some(
    (item = {}) =>
      String(item?.scenario || "").trim() === "workflow" &&
      String(item?.strategy || "").trim() === "workflow_final_plan" &&
      String(item?.generationSource || "").trim() === "workflow_completed_attachment_summary",
  );
  assert.equal(hasFinalSummaryCall, true);
  const agentResult = dispatchOutcome?.result;
  const workflowTurnMessage = workflowTurn(agentResult);
  assert.ok(workflowTurnMessage);
  const transferEnvelopes = Array.isArray(workflowTurnMessage?.transferEnvelopes)
    ? workflowTurnMessage.transferEnvelopes
    : [];
  const workflowPayloadTransferEnvelopes = Array.isArray(
    workflowTurn(agentResult).pluginMeta.payload?.transferEnvelopes,
  )
    ? workflowTurn(agentResult).pluginMeta.payload.transferEnvelopes
    : [];
  assert.equal(
    transferEnvelopes.some(
      (item = {}) =>
        String(item?.payload?.attachments?.[0]?.identity?.attachmentId || "").trim() ===
        "wf-semantic-final-1",
    ),
    true,
  );
  assert.equal(
    workflowPayloadTransferEnvelopes.some(
      (item = {}) =>
        String(item?.payload?.attachments?.[0]?.identity?.attachmentId || "").trim() ===
        "wf-semantic-final-1",
    ),
    true,
  );
  const workflowContent = String(workflowTurnMessage?.content || "");
  assert.match(workflowContent, /final-summary\.md/);
  assert.doesNotMatch(workflowContent, /node-summary\.md/);
});
