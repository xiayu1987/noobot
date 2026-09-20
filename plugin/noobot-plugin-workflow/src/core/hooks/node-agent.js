/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { WORKFLOW_ACTION, WORKFLOW_PLUGIN_DEFAULTS } from "../constants.js";
import { HOOK_POINT } from "@noobot/hook-protocol";
import { deriveAgentExecutionId } from "@noobot/session-protocol";
import { resolveWorkflowLocaleFromContext, tWorkflow, WORKFLOW_I18N_KEYSET } from "../i18n.js";
import {
  mergeAttachmentReferences,
  normalizeWorkflowTransferPayload,
  resolveNodeInputAttachments,
  resolveWorkflowTransferAttachmentReferences,
} from "./attachments.js";
import { persistWorkflowNodeResultAttachment } from "./persistence.js";
import { buildWorkflowDialogRelativeDir } from "./planning-dialog-persistence.js";
import {
  buildWorkflowInputAttachmentSystemMessage,
  buildWorkflowUpstreamAttachmentSystemMessage,
} from "./node-upstream-messages.js";
import {
  firstText,
  hasOwnObjectKey,
  isWorkflowAbortError,
  resolveWorkflowAbortSignal,
  resolveWorkflowParentRunConfig,
  throwIfWorkflowAborted,
  withTimeout,
} from "./runtime.js";

function buildWorkflowNodeInstruction(step = {}) {
  const locale = String(step?.locale || "").trim();
  const taskText = String(
    step?.nodeTask || step?.task || step?.instruction || step?.mission || "",
  ).trim();
  if (taskText) return taskText;
  const nodeName = String(step?.nodeName || "").trim();
  if (nodeName) {
    return tWorkflow(locale, WORKFLOW_I18N_KEYSET.NODE_AGENT.NODE_INSTRUCTION_BY_NAME, {
      name: nodeName,
    });
  }
  const nodeId = String(step?.nodeId || "").trim();
  if (nodeId)
    return tWorkflow(locale, WORKFLOW_I18N_KEYSET.NODE_AGENT.NODE_INSTRUCTION_BY_ID, {
      id: nodeId,
    });
  return tWorkflow(locale, WORKFLOW_I18N_KEYSET.NODE_AGENT.NODE_INSTRUCTION_DEFAULT);
}

function resolveNodeTaskForPendingStep({ semantic = {}, pendingStep = {} } = {}) {
  const pendingNodeId = String(pendingStep?.nodeId || "").trim();
  const pendingNodeName = String(pendingStep?.nodeName || "").trim();
  const nodes = Array.isArray(semantic?.nodes) ? semantic.nodes : [];
  const matchedNode = nodes.find((node = {}) => {
    const nodeId = String(node?.id || "").trim();
    const nodeName = String(node?.name || "").trim();
    if (pendingNodeId && nodeId && pendingNodeId === nodeId) return true;
    if (pendingNodeName && nodeName && pendingNodeName === nodeName) return true;
    return false;
  });
  if (!matchedNode) return "";
  return String(
    matchedNode?.task ||
      matchedNode?.taskText ||
      matchedNode?.instruction ||
      matchedNode?.mission ||
      "",
  ).trim();
}

export function resolveSemanticNodeForPendingStep({ semantic = {}, pendingStep = {} } = {}) {
  const pendingNodeId = String(pendingStep?.nodeId || "").trim();
  const pendingNodeName = String(pendingStep?.nodeName || "").trim();
  const nodes = Array.isArray(semantic?.nodes) ? semantic.nodes : [];
  return (
    nodes.find((node = {}) => {
      const nodeId = String(node?.id || "").trim();
      const nodeName = String(node?.name || "").trim();
      if (pendingNodeId && nodeId && pendingNodeId === nodeId) return true;
      if (pendingNodeName && nodeName && pendingNodeName === nodeName) return true;
      return false;
    }) || null
  );
}

export async function runNodeAgent({
  hookManager,
  options = {},
  ctx = {},
  instanceId = "",
  pendingStep = {},
  semantic = {},
  nodeIdentity = null,
  transition = 0,
  upstreamNodeResults = [],
} = {}) {
  throwIfWorkflowAborted(ctx);
  const resolvedNodeIdentity = resolveNodeAgentIdentity({
    nodeIdentity,
    instanceId,
    pendingStep,
    ctx,
  });
  const semanticNode = resolveSemanticNodeForPendingStep({ semantic, pendingStep }) || {};
  const nodeInputAttachments = resolveNodeInputAttachments({
    ctx,
    semanticNode,
    semantic,
  });
  const upstreamAttachmentSystemMessage = await buildWorkflowUpstreamAttachmentSystemMessage({
    options,
    ctx,
    pendingStep,
    upstreamNodeResults,
  });
  const hookPayload = buildNodeAgentHookPayload({
    ctx,
    instanceId,
    pendingStep,
    transition,
    semantic,
    semanticNode,
    resolvedNodeIdentity,
    upstreamNodeResults,
    nodeInputAttachments,
    upstreamAttachmentSystemMessage,
  });
  const { subSession, failure } = await runWorkflowNodeSubSession({
    options,
    ctx,
    instanceId,
    pendingStep,
    transition,
    semanticNode,
    resolvedNodeIdentity,
    upstreamNodeResults,
    nodeInputAttachments,
    upstreamAttachmentSystemMessage,
    agentInstruction: hookPayload.agentInstruction,
  });
  throwIfWorkflowAborted(ctx);
  return resolveNodeAgentResult({
    hookManager,
    options,
    ctx,
    pendingStep,
    hookPayload,
    subSession,
    failure,
    resolvedNodeIdentity,
  });
}

function resolveNodeAgentIdentity({ nodeIdentity, instanceId, pendingStep, ctx }) {
  if (!nodeIdentity || typeof nodeIdentity !== "object") {
    throw new TypeError("workflow node identity is required");
  }
  const dialogProcessId = String(nodeIdentity.dialogProcessId || "").trim();
  const turnScopeId = String(nodeIdentity.turnScopeId || "").trim();
  if (!dialogProcessId || !turnScopeId) {
    throw new TypeError("workflow node identity requires dialogProcessId and turnScopeId");
  }
  const workflowRunId = firstText(nodeIdentity.workflowRunId, instanceId);
  const workflowExecutionId = firstText(
    nodeIdentity.workflowExecutionId,
    ctx?.workflowExecutionId,
    ctx?.executionId,
    ctx?.runConfig?.executionId,
    `workflow:${workflowRunId}`,
  );
  return {
    ...nodeIdentity,
    workflowRunId,
    workflowExecutionId,
    nodeExecutionId: firstText(nodeIdentity.nodeExecutionId),
    commandId: firstText(nodeIdentity.commandId),
    dialogProcessId,
    turnScopeId,
    childExecutionId: firstText(
      nodeIdentity.childExecutionId,
      deriveAgentExecutionId({ turnScopeId }),
    ),
    sessionId: firstText(nodeIdentity.sessionId),
    nodeId: firstText(nodeIdentity.nodeId, pendingStep?.nodeId),
    nodeName: firstText(nodeIdentity.nodeName, pendingStep?.nodeName),
  };
}

function buildNodeAgentHookPayload({
  ctx,
  instanceId,
  pendingStep,
  transition,
  semantic,
  semanticNode,
  resolvedNodeIdentity,
  upstreamNodeResults,
  nodeInputAttachments,
  upstreamAttachmentSystemMessage,
}) {
  return {
    ...ctx,
    workflow: {
      instanceId,
      workflowRunId: resolvedNodeIdentity.workflowRunId,
      nodeIdentity: resolvedNodeIdentity,
      pendingStep,
      transition,
      semantic,
      semanticNode,
      upstreamNodeResults,
      upstreamAttachments: collectUpstreamAttachmentReferences(upstreamNodeResults, ctx),
      inputAttachments: nodeInputAttachments,
      upstreamAttachmentSystemMessage,
    },
    agentInstruction: buildWorkflowNodeInstruction({
      ...pendingStep,
      locale: resolveWorkflowLocaleFromContext(ctx),
      nodeTask: resolveNodeTaskForPendingStep({ semantic, pendingStep }),
    }),
    proposedAction: { type: WORKFLOW_ACTION.SUBMIT, stepIndex: Number(pendingStep?.index || 0) },
  };
}

function collectUpstreamAttachmentReferences(upstreamNodeResults, ctx) {
  return upstreamNodeResults.reduce((acc, item = {}) => {
    const transferPayload = normalizeWorkflowTransferPayload({
      transferEnvelopes: Array.isArray(item.transferEnvelopes) ? item.transferEnvelopes : [],
    });
    return mergeAttachmentReferences(
      acc,
      resolveWorkflowTransferAttachmentReferences(transferPayload, ctx),
    );
  }, []);
}

async function runWorkflowNodeSubSession(params) {
  if (typeof params.options?.subSessionRunner !== "function") {
    return { subSession: null, failure: null };
  }
  let subSession = null;
  let failure = null;
  try {
    subSession = await executeWorkflowNodeSubSession(params);
  } catch (error) {
    if (isWorkflowAbortError(error, params.ctx)) throw error;
    failure = createWorkflowNodeFailure(error);
    if (error?.lifecycle && typeof error.lifecycle === "object") {
      subSession = { lifecycle: error.lifecycle };
    }
  }
  if (subSession) await persistWorkflowNodeSubSession(params, subSession);
  return { subSession, failure };
}

async function executeWorkflowNodeSubSession(params) {
  const request = createWorkflowNodeSubSessionRequest(params);
  throwIfWorkflowAborted(params.ctx);
  const timeoutMs = resolveNodeAgentTimeout(params.options);
  const runPromise = Promise.resolve(params.options.subSessionRunner(request));
  try {
    const result = await withTimeout(
      runPromise,
      timeoutMs,
      `workflow node sub-session timeout (${timeoutMs}ms)`,
      { signal: resolveWorkflowAbortSignal(params.ctx) },
    );
    throwIfWorkflowAborted(params.ctx);
    return result;
  } catch (error) {
    if (isWorkflowAbortError(error, params.ctx)) await Promise.allSettled([runPromise]);
    throw error;
  }
}

function createWorkflowNodeSubSessionRequest(params) {
  const { ctx, resolvedNodeIdentity: identity } = params;
  const relativeDir = buildWorkflowDialogRelativeDir({
    ctx,
    dialogProcessId: identity.dialogProcessId,
    scope: "node",
  });
  return {
    parentExecutionScope: ctx?.agentContext || null,
    parentContext: ctx,
    abortSignal: resolveWorkflowAbortSignal(ctx),
    message: params.agentInstruction,
    attachments: params.nodeInputAttachments,
    runConfigPatch: buildWorkflowNodeRunConfigPatch(ctx, identity),
    systemMessageFactory: ({ attachments = [] } = {}) =>
      [
        buildWorkflowInputAttachmentSystemMessage({
          ctx,
          attachments,
          semanticNode: params.semanticNode,
        }),
        params.upstreamAttachmentSystemMessage,
      ].filter(Boolean),
    eventListener: typeof ctx?.eventListener?.onEvent === "function" ? ctx.eventListener : null,
    strategy: buildWorkflowNodeSubSessionStrategy(ctx, identity, relativeDir),
    metadata: buildWorkflowNodeSubSessionMetadata(params),
  };
}

function buildWorkflowNodeRunConfigPatch(ctx, identity) {
  const parentRunConfig = resolveWorkflowParentRunConfig(ctx);
  const selectedPlugins = Array.isArray(parentRunConfig.selectedPlugins)
    ? parentRunConfig.selectedPlugins.map((item) => String(item || "").trim()).filter(Boolean)
    : [];
  const harness =
    parentRunConfig.plugins?.harness && typeof parentRunConfig.plugins.harness === "object"
      ? parentRunConfig.plugins.harness
      : {};
  const harnessEnabled =
    selectedPlugins.includes("harness") ||
    harness.enabled === true ||
    String(harness.mode || "")
      .trim()
      .toLowerCase() === "on";
  const patch = {
    ...(hasOwnObjectKey(parentRunConfig, "streaming")
      ? { streaming: parentRunConfig.streaming }
      : {}),
    turnScopeId: identity.turnScopeId,
    workflowRunId: identity.workflowRunId,
    workflowNodeExecutionId: identity.nodeExecutionId,
    workflowNodeCommandId: identity.commandId,
  };
  if (!harnessEnabled) return patch;
  return {
    ...patch,
    selectedPlugins: Array.from(new Set([...selectedPlugins, "harness"])),
    plugins: { harness: { ...harness, enabled: true, mode: "on" } },
  };
}

function buildWorkflowNodeSubSessionStrategy(ctx, identity, relativeDir) {
  return {
    sessionId: identity.sessionId,
    parentSessionId: String(ctx?.sessionId || "").trim(),
    parentDialogProcessId: String(ctx?.dialogProcessId || "").trim(),
    dialogProcessId: identity.dialogProcessId,
    turnScopeId: identity.turnScopeId,
    commandId: identity.commandId,
    executionId: identity.childExecutionId,
    parentExecutionId: identity.workflowExecutionId,
    rootExecutionId: String(ctx?.rootExecutionId || identity.workflowExecutionId).trim(),
    disabledPlugins: ["workflow"],
    relativeDir,
    allowedRoot: "runtime/workflow/session",
  };
}

function buildWorkflowNodeSubSessionMetadata(params) {
  const { ctx, resolvedNodeIdentity: identity } = params;
  return {
    scope: "workflow_node",
    instanceId: String(params.instanceId || "").trim(),
    workflowRunId: identity.workflowRunId,
    executionId: identity.childExecutionId,
    parentExecutionId: identity.workflowExecutionId,
    rootExecutionId: String(ctx?.rootExecutionId || identity.workflowExecutionId).trim(),
    origin: {
      type: "workflow_node",
      workflowRunId: identity.workflowRunId,
      workflowNodeExecutionId: identity.nodeExecutionId,
    },
    nodeExecutionId: identity.nodeExecutionId,
    commandId: identity.commandId,
    dialogProcessId: identity.dialogProcessId,
    nodeId: identity.nodeId,
    nodeName: identity.nodeName,
    transition: Number(params.transition || 0),
    turnScopeId: identity.turnScopeId,
    workflowSessionId: String(ctx?.sessionId || "").trim(),
    workflowDialogProcessId: identity.dialogProcessId,
    upstreamWorkflowNodeResults: params.upstreamNodeResults,
  };
}

function resolveNodeAgentTimeout(options) {
  const configured = Number(options?.nodeAgentTimeoutMs);
  return Number.isFinite(configured)
    ? Math.max(1000, Math.floor(configured))
    : WORKFLOW_PLUGIN_DEFAULTS.DEFAULT_NODE_AGENT_TIMEOUT_MS;
}

function createWorkflowNodeFailure(error) {
  return {
    source: "workflow_node_agent",
    code: String(error?.code || "WORKFLOW_NODE_SUBSESSION_FAILED").trim(),
    message: String(error?.message || error || "workflow node sub-session failed").trim(),
  };
}

async function persistWorkflowNodeSubSession(params, subSession) {
  throwIfWorkflowAborted(params.ctx);
  await persistWorkflowNodeResultAttachment({
    options: params.options,
    ctx: params.ctx,
    subSession,
    pendingStep: params.pendingStep,
    transition: params.transition,
    nodeIdentity: {
      ...params.resolvedNodeIdentity,
      sessionId: String(subSession.sessionId || "").trim(),
    },
  });
}

async function resolveNodeAgentResult({
  hookManager,
  options,
  ctx,
  pendingStep,
  hookPayload,
  subSession,
  failure,
  resolvedNodeIdentity,
}) {
  if (failure)
    return createFailedNodeAgentResult(pendingStep, subSession, failure, resolvedNodeIdentity);
  const directAction =
    typeof options?.nodeAgentExecutor === "function"
      ? await options.nodeAgentExecutor(hookPayload)
      : null;
  throwIfWorkflowAborted(ctx);
  if (directAction && typeof directAction === "object") {
    return createNodeAgentResult(directAction, subSession, resolvedNodeIdentity);
  }
  const emitted = await hookManager.emit(HOOK_POINT.WORKFLOW.NODE_AGENT_EXECUTE, hookPayload);
  throwIfWorkflowAborted(ctx);
  const action = emitted.outcomes
    .map((outcome) => outcome?.value?.action)
    .find((value) => value && typeof value === "object");
  return createNodeAgentResult(
    action || { type: WORKFLOW_ACTION.SUBMIT, stepIndex: Number(pendingStep?.index || 0) },
    subSession,
    resolvedNodeIdentity,
  );
}

function createNodeAgentResult(action, subSession, identity) {
  return {
    action,
    subSession,
    nodeDialogProcessId: identity.dialogProcessId,
    nodeIdentity: { ...identity, sessionId: String(subSession?.sessionId || "").trim() },
  };
}

function createFailedNodeAgentResult(pendingStep, subSession, failure, identity) {
  return {
    action: {
      type: WORKFLOW_ACTION.SUBMIT,
      stepIndex: Number(pendingStep?.index || 0),
      stepFailure: failure,
    },
    subSession,
    nodeDialogProcessId: identity.dialogProcessId,
    nodeIdentity: identity,
    status: "failed",
    stepFailure: failure,
  };
}

function buildPendingStepKey(step = {}) {
  return `${String(step?.nodeName || "").trim()}::${Number(step?.nodeType || 0)}`;
}

export function resolveStepIndexForAction({
  snapshot = {},
  preferredIndex = 0,
  pendingStep = {},
} = {}) {
  const pendingSteps = Array.isArray(snapshot?.pendingSteps) ? snapshot.pendingSteps : [];
  if (!pendingSteps.length) return 0;
  const key = buildPendingStepKey(pendingStep);
  const matchedIndex = pendingSteps.findIndex((item) => buildPendingStepKey(item) === key);
  if (matchedIndex >= 0) return matchedIndex;
  const index = Number.isFinite(Number(preferredIndex))
    ? Math.max(0, Math.floor(Number(preferredIndex)))
    : 0;
  return Math.min(index, Math.max(0, pendingSteps.length - 1));
}
