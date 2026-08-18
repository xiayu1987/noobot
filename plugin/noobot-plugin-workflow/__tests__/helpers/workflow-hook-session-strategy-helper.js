/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import { createModelContext } from "@noobot/context-protocol";
import { HOOK_POINT } from "@noobot/hook-protocol";
import { createEventEnvelope, validateProtocolEvent } from "@noobot/event-protocol";
import {
  createTransferEnvelope,
  createTransferIdentity,
  createAttachmentReference,
  TRANSFER_DIRECTION,
} from "@noobot/semantic-transfer-protocol";

import { createRegisterWorkflowHooks } from "../../src/core/hooks.js";
import { WORKFLOW_PLUGIN_DEFAULTS } from "../../src/core/constants.js";
import { resolveWorkflowNodeDialogProcessId } from "../../src/core/node-dialog-process-id.js";
import {
  collectWorkflowDialogProcessIds,
  resolveWorkflowDialogProcessId,
} from "../../frontend/utils/workflowDialogProcessId.js";

export function createMockBotHookManager() {
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
      if (String(point || "").trim() === HOOK_POINT.WORKFLOW.NODE_AGENT_EXECUTE) {
        return {
          outcomes: [
            {
              status: "ok",
              value: { action: { type: "submit", stepIndex: 0 } },
            },
          ],
        };
      }
      const record = listeners.get(String(point || "").trim());
      if (!record || typeof record.handler !== "function") {
        return { outcomes: [], failures: [] };
      }
      const result = await record.handler(payload || {});
      return { outcomes: [{ status: "ok", value: result }], failures: [] };
    },
  };
}



export function workflowDsl(lines = []) {
  return ["WORKFLOW_DSL/1", ...lines, "END"].join("\n");
}

export function simpleActionWorkflowDsl({
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

export function createCapabilityModelInvoker(output, calls = null) {
  return async (payload = {}) => {
    if (Array.isArray(calls)) calls.push(payload);
    return { output };
  };
}

export function createNodeResult(nodeName, overrides = {}) {
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

export function createRecordingSubSessionRunner(calls, { failNodeName = "", failMessage = "" } = {}) {
  return async (payload = {}) => {
    calls.push(payload);
    const nodeName = String(payload?.metadata?.nodeName || payload?.message || "").trim();
    if (failNodeName && nodeName === failNodeName) {
      throw new Error(failMessage || `${nodeName}失败`);
    }
    return createNodeResult(nodeName);
  };
}

export function createAttachmentPersister({ prefix = "att", counterRef = { value: 0 } } = {}) {
  return async (payload = {}) => {
    counterRef.value += 1;
    const artifactName = String(payload?.artifacts?.[0]?.name || `result-${counterRef.value}.md`);
    return [
      {
        attachmentId: `${prefix}-${counterRef.value}`,
        sessionId: String(payload?.sessionId || "s1"),
        attachmentSource: "model",
        name: artifactName,
        mimeType: "text/markdown",
      },
    ];
  };
}

export function createV2AttachmentTransferEnvelope({
  attachmentId,
  sessionId = "s1",
  turnScopeId = "turn-workflow-test",
  runId = "run-workflow-test",
  producerType = "subagent",
  producerId = "workflow-test-producer",
  transferId = `transfer-${attachmentId}`,
  messageId = `message-${attachmentId}`,
  name = "workflow-result.md",
  mimeType = "text/markdown",
  strategy = "workflow_subagent",
  scenario = "workflow",
  reason = "workflow_node_result",
} = {}) {
  return createTransferEnvelope({
    transferId,
    messageId,
    identity: createTransferIdentity({
      sessionId,
      turnScopeId,
      runId,
      producer: { type: producerType, id: producerId },
    }),
    direction: TRANSFER_DIRECTION.OUTPUT,
    payload: {
      mode: "attachment",
      attachments: [createAttachmentReference({
        identity: { attachmentId, sessionId, attachmentSource: "model" },
        role: "primary",
        name,
        mimeType,
      })],
    },
    intent: { source: producerType, reason, scenario, strategy },
    meta: { originalLength: 0, persisted: true },
  });
}

export function createSemanticTransferTool({ prefix = "att", counterRef = { value: 0 }, calls = null, sessionId = "" } = {}) {
  return {
    async transferSemanticContent(payload = {}) {
      const { scenario = "", strategy = "", messages = [] } = payload;
      if (Array.isArray(calls)) calls.push(payload);
      const expectedScenario = "workflow";
      if (String(scenario || "") !== expectedScenario || !["workflow_subagent", "workflow_final_plan"].includes(String(strategy || ""))) {
        return { transferEnvelopes: [] };
      }
      const strategyKey = String(strategy || "").trim();
      const counters = counterRef.byStrategy instanceof Map
        ? counterRef.byStrategy
        : (counterRef.byStrategy = new Map());
      const scopedCount = Number(counters.get(strategyKey) || 0) + 1;
      counters.set(strategyKey, scopedCount);
      counterRef.value += 1;
      const nodeName = String(messages?.[0]?.nodeName || `节点${counterRef.value}`).trim();
      const fileName = `workflow-node-${scopedCount}-${nodeName}-result.md`;
      const attachmentId = `${prefix}-${scopedCount}`;
      const effectiveSessionId = String(
        sessionId || messages?.[0]?.meta?.sessionId || payload?.sessionId || "s1",
      ).trim();
      const effectiveTurnScopeId = String(
        messages?.[0]?.meta?.turnScopeId || payload?.turnScopeId || `turn-${prefix}-${scopedCount}`,
      ).trim();
      const effectiveRunId = String(
        messages?.[0]?.meta?.workflowRunId || payload?.runId || `run-${prefix}-${scopedCount}`,
      ).trim();
      const envelope = createTransferEnvelope({
        transferId: `transfer-${prefix}-${strategyKey}-${scopedCount}`,
        messageId: `message-${prefix}-${strategyKey}-${scopedCount}`,
        identity: createTransferIdentity({
          sessionId: effectiveSessionId,
          turnScopeId: effectiveTurnScopeId,
          runId: effectiveRunId,
          producer: { type: "subagent", id: nodeName },
        }),
        direction: TRANSFER_DIRECTION.OUTPUT,
        payload: {
          mode: "attachment",
          attachments: [createAttachmentReference({
            identity: { attachmentId, sessionId: effectiveSessionId, attachmentSource: "model" },
            role: "primary",
            name: fileName,
            mimeType: "text/markdown",
          })],
        },
        intent: {
          source: "subagent",
          reason: "workflow_node_result",
          scenario: expectedScenario,
          strategy,
        },
        meta: { originalLength: 0, persisted: true },
      });
      return {
        transferEnvelopes: [envelope],
        ...(String(payload?.strategy || "") === "workflow_subagent" && String(payload?.content || "").trim()
          ? { injectionMessage: String(payload.content).trim() }
          : {}),
      };
    },
  };
}

export function createBaseContext(overrides = {}) {
  const context = {
    userId: "u1",
    sessionId: "s1",
    dialogProcessId: "d1",
    userMessage: "请执行一个工作流",
    runConfig: { locale: "zh-CN" },
    ...overrides,
  };
  if (!context.modelContext) {
    context.modelContext = createModelContext({
      messageBlocks: { system: [], history: [], incremental: [] },
    });
  }
  context.contextProtocolVersion = 1;
  return context;
}

export function createContextWithSharedTools(sharedTools = {}, overrides = {}) {
  return createBaseContext({
    agentContext: {
      bindings: { runtime: { sharedTools }, tools: [], extensions: {} },
    },
    ...overrides,
  });
}

export function installTurnMessageEventRuntimeFixture(context = {}) {
  const target = context && typeof context === "object" ? context : {};
  if (!target.modelContext) {
    target.modelContext = createModelContext({
      messageBlocks: { system: [], history: [], incremental: [] },
    });
  }
  target.contextProtocolVersion = 1;
  const runConfig = target.runConfig && typeof target.runConfig === "object"
    ? target.runConfig
    : (target.runConfig = {});
  const sessionId = String(target.sessionId || "test-session").trim();
  const dialogProcessId = String(target.dialogProcessId || "test-dialog").trim();
  if (!String(target.turnScopeId || "").trim()) {
    target.turnScopeId = String(runConfig.turnScopeId || `test-turn:${sessionId}:${dialogProcessId}`).trim();
  }
  if (!String(runConfig.turnScopeId || "").trim()) runConfig.turnScopeId = target.turnScopeId;
  if (!String(runConfig.messageId || "").trim()) {
    runConfig.messageId = `test-message:${sessionId}:${dialogProcessId}`;
  }
  if (!String(runConfig.presentationMessageId || "").trim()) {
    runConfig.presentationMessageId = `test-presentation:${sessionId}:${dialogProcessId}`;
  }
  const existingAgentContext = target.agentContext && typeof target.agentContext === "object"
    ? target.agentContext
    : null;
  const agentContext = existingAgentContext || {};
  const bindings = agentContext.bindings && typeof agentContext.bindings === "object"
    ? agentContext.bindings
    : (agentContext.bindings = {});
  const legacyRuntime = agentContext?.execution?.controllers?.runtime;
  const runtime = bindings.runtime && typeof bindings.runtime === "object"
    ? bindings.runtime
    : (bindings.runtime = legacyRuntime && typeof legacyRuntime === "object" ? legacyRuntime : {});
  const runtimeSharedTools = runtime.sharedTools && typeof runtime.sharedTools === "object"
    ? runtime.sharedTools
    : {};
  if (!runtimeSharedTools.semanticTransfer) {
    runtimeSharedTools.semanticTransfer = createSemanticTransferTool();
  }
  runtime.sharedTools = runtimeSharedTools;
  if (!runtime.runConfig || typeof runtime.runConfig !== "object") runtime.runConfig = runConfig;
  if (!runtime.sessionManager) {
    const sequences = new Map();
    runtime.sessionManager = {
      async commitAuthorityEvent({ sessionId: authoritySessionId, family, identity, causality, ordering, producer, payload }) {
        const stream = `${ordering.domain}:${ordering.scopeId}`;
        const sequence = (sequences.get(stream) || 0) + 1;
        sequences.set(stream, sequence);
        const envelope = createEventEnvelope({
          family,
          identity: {
            ...identity,
            eventId: `test-event:${stream}:${sequence}`,
            sessionId: String(authoritySessionId || "").trim(),
          },
          causality,
          ordering: { ...ordering, sequence, aggregateVersion: sequence },
          producer,
          occurredAt: new Date(sequence * 1000).toISOString(),
          payload,
        });
        const validation = validateProtocolEvent(envelope);
        assert.equal(validation.valid, true, validation.errors?.join(","));
        return { committed: true, envelope, aggregateVersion: sequence };
      },
    };
  }
  if (!Array.isArray(bindings.tools)) {
    bindings.tools = Array.isArray(agentContext?.payload?.tools?.registry)
      ? agentContext.payload.tools.registry
      : [];
  }
  if (!bindings.extensions || typeof bindings.extensions !== "object") {
    bindings.extensions = {};
  }

  if (!existingAgentContext) target.agentContext = agentContext;
  if (typeof target?.eventListener?.onEvent !== "function") {
    target.eventListener = { async onEvent() {} };
  }
  if (typeof runtime.materializePendingCurrentTurnMessageEvents !== "function") {
    runtime.materializePendingCurrentTurnMessageEvents = () => ({
      activityTimeline: [],
      toolTimeline: [],
    });
  }
  return target;
}

export function getBeforeDispatch(hookManager) {
  const beforeDispatch = hookManager.listeners.get(HOOK_POINT.BOT.BEFORE_AGENT_DISPATCH);
  assert.ok(beforeDispatch?.handler);
  return {
    ...beforeDispatch,
    handler(context = {}) {
      return beforeDispatch.handler(installTurnMessageEventRuntimeFixture(context));
    },
  };
}

export async function runWorkflowHook({ options = {}, context = {} } = {}) {
  const hookManager = createMockBotHookManager();
  createRegisterWorkflowHooks()({ hookManager, options: { enabled: true, mode: "on", ...options } });
  const ctx = createBaseContext(context);
  const dispatchOutcome = await getBeforeDispatch(hookManager).handler(ctx);
  return { hookManager, ctx, dispatchOutcome, agentResult: dispatchOutcome?.result };
}

export function callsByNodeName(calls = []) {
  return new Map(calls.map((call) => [String(call?.metadata?.nodeName || "").trim(), call]));
}

export function workflowTurn(agentResult) {
  return (agentResult?.turnMessages || []).find((item) => item?.pluginMessage === true && item?.pluginMeta?.kind === "workflow");
}

export {
  createRegisterWorkflowHooks,
  WORKFLOW_PLUGIN_DEFAULTS,
  resolveWorkflowNodeDialogProcessId,
  collectWorkflowDialogProcessIds,
  resolveWorkflowDialogProcessId,
};
