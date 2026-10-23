/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import {
  PLUGIN_ID,
  WORKFLOW_ACTION,
  WORKFLOW_DATA_SCOPE,
  WORKFLOW_PLUGIN_DEFAULTS,
  resolveWorkflowDataRelativePath,
} from "../constants.js";
import { HOOK_POINT } from "@noobot/hook-protocol";
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
  hasOwnObjectKey,
  isWorkflowAbortError,
  throwIfWorkflowAborted,
  withTimeout,
} from "./runtime.js";
import { resolveWorkflowRunIdentity } from "../workflow-run-identity.js";
import { text, isObjectLike } from "@noobot/shared/value";

function buildWorkflowNodeInstruction(step = {}) {
  const locale = text(step?.locale);
  const taskText = text(step?.nodeTask);
  if (taskText) return taskText;
  return tWorkflow(locale, WORKFLOW_I18N_KEYSET.NODE_AGENT.NODE_INSTRUCTION_BY_NAME, {
    name: text(step?.nodeName),
  });
}

export function resolveSemanticNodeForPendingStep({ semantic, pendingStep }) {
  const matches = semantic.nodes.filter((node) => node.id === pendingStep.nodeId);
  if (matches.length !== 1) {
    throw new Error(`workflow semantic node not found: ${pendingStep.nodeId}`);
  }
  return matches[0];
}

export async function runNodeAgent({
  hookManager,
  options = {},
  ctx = {},
  signal,
  instanceId = "",
  pendingStep = {},
  semantic = {},
  nodeIdentity,
  transition = 0,
  upstreamNodeResults = [],
} = {}) {
  throwIfWorkflowAborted(signal);
  const runIdentity = resolveWorkflowRunIdentity(ctx);
  const semanticNode = resolveSemanticNodeForPendingStep({ semantic, pendingStep });
  const nodeInputAttachments = resolveNodeInputAttachments({
    ctx,
    semanticNode,
    semantic,
  });
  const upstreamAttachmentSystemMessage = await buildWorkflowUpstreamAttachmentSystemMessage({
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
    nodeIdentity,
    upstreamNodeResults,
    nodeInputAttachments,
    upstreamAttachmentSystemMessage,
  });
  const { subSession, childFailed } = await runWorkflowNodeSubSession({
    options,
    ctx,
    signal,
    instanceId,
    pendingStep,
    transition,
    semanticNode,
    nodeIdentity,
    runIdentity,
    upstreamNodeResults,
    nodeInputAttachments,
    upstreamAttachmentSystemMessage,
    agentInstruction: hookPayload.agentInstruction,
  });
  throwIfWorkflowAborted(signal);
  return resolveNodeAgentResult({
    hookManager,
    signal,
    hookPayload,
    subSession,
    childFailed,
  });
}

function buildNodeAgentHookPayload({
  ctx,
  instanceId,
  pendingStep,
  transition,
  semantic,
  semanticNode,
  nodeIdentity,
  upstreamNodeResults,
  nodeInputAttachments,
  upstreamAttachmentSystemMessage,
}) {
  return {
    ...ctx,
    workflow: {
      instanceId,
      workflowRunId: nodeIdentity.workflowRunId,
      nodeIdentity,
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
      nodeTask: text(semanticNode?.task),
    }),
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
  try {
    const subSession = await executeWorkflowNodeSubSession(params);
    if (subSession) await persistWorkflowNodeSubSession(params, subSession);
    return { subSession, childFailed: false };
  } catch (error) {
    if (isWorkflowAbortError(error, params.signal)) throw error;
    if (!isObjectLike(error?.lifecycle)) throw error;
    return { subSession: { lifecycle: error.lifecycle }, childFailed: true };
  }
}

async function executeWorkflowNodeSubSession(params) {
  const request = createWorkflowNodeSubSessionRequest(params);
  throwIfWorkflowAborted(params.signal);
  const timeoutMs = resolveNodeAgentTimeout(params.options);
  const runPromise = Promise.resolve(params.options.subSessionRunner(request));
  try {
    const result = await withTimeout(
      runPromise,
      timeoutMs,
      `workflow node sub-session timeout (${timeoutMs}ms)`,
      { signal: params.signal },
    );
    throwIfWorkflowAborted(params.signal);
    return result;
  } catch (error) {
    if (isWorkflowAbortError(error, params.signal)) await Promise.allSettled([runPromise]);
    throw error;
  }
}

function createWorkflowNodeSubSessionRequest(params) {
  const { ctx, nodeIdentity: identity, runIdentity } = params;
  const relativeDir = buildWorkflowDialogRelativeDir({
    ctx,
    dialogProcessId: identity.dialogProcessId,
    scope: "node",
  });
  return {
    parentExecutionScope: ctx?.agentContext || null,
    abortSignal: params.signal,
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
    eventListener: ctx.eventListener,
    strategy: buildWorkflowNodeSubSessionStrategy({ ctx, identity, runIdentity, relativeDir }),
    metadata: buildWorkflowNodeSubSessionMetadata(params),
  };
}

function buildWorkflowNodeRunConfigPatch(ctx, identity) {
  const parentRunConfig = ctx.runConfig;
  const selectedPlugins = Array.isArray(parentRunConfig.selectedPlugins)
    ? parentRunConfig.selectedPlugins.map((item) => text(item)).filter(Boolean)
    : [];
  const harness =
    parentRunConfig.plugins?.harness && typeof parentRunConfig.plugins.harness === "object"
      ? parentRunConfig.plugins.harness
      : {};
  const harnessEnabled =
    selectedPlugins.includes("harness") ||
    harness.enabled === true ||
    text(harness.mode).toLowerCase() === "on";
  const patch = {
    ...(hasOwnObjectKey(parentRunConfig, "streaming")
      ? { streaming: parentRunConfig.streaming }
      : {}),
    turnScopeId: identity.turnScopeId,
    workflowRunId: identity.workflowRunId,
    workflowNodeExecutionId: identity.nodeExecutionId,
  };
  if (!harnessEnabled) return patch;
  return {
    ...patch,
    selectedPlugins: Array.from(new Set([...selectedPlugins, "harness"])),
    plugins: { harness: { ...harness, enabled: true, mode: "on" } },
  };
}

function buildWorkflowNodeSubSessionStrategy({ ctx, identity, runIdentity, relativeDir }) {
  return {
    userId: text(ctx?.userId),
    sessionId: identity.sessionId,
    parentSessionId: text(ctx?.sessionId),
    parentDialogProcessId: text(ctx?.dialogProcessId),
    dialogProcessId: identity.dialogProcessId,
    turnScopeId: identity.turnScopeId,
    executionId: identity.activeChildExecutionId,
    parentExecutionId: runIdentity.executionId,
    rootExecutionId: runIdentity.rootExecutionId,
    disabledPlugins: [PLUGIN_ID],
    relativeDir,
    allowedRoot: resolveWorkflowDataRelativePath(WORKFLOW_DATA_SCOPE.SESSION),
  };
}

function buildWorkflowNodeSubSessionMetadata(params) {
  const { ctx, nodeIdentity: identity, runIdentity } = params;
  return {
    scope: "workflow_node",
    instanceId: text(params.instanceId),
    workflowRunId: identity.workflowRunId,
    executionId: identity.activeChildExecutionId,
    parentExecutionId: runIdentity.executionId,
    rootExecutionId: runIdentity.rootExecutionId,
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
    workflowSessionId: text(ctx?.sessionId),
    upstreamWorkflowNodeResults: params.upstreamNodeResults,
  };
}

function resolveNodeAgentTimeout(options) {
  const configured = Number(options?.nodeAgentTimeoutMs);
  return Number.isFinite(configured)
    ? Math.max(1000, Math.floor(configured))
    : WORKFLOW_PLUGIN_DEFAULTS.DEFAULT_NODE_AGENT_TIMEOUT_MS;
}

async function persistWorkflowNodeSubSession(params, subSession) {
  throwIfWorkflowAborted(params.signal);
  await persistWorkflowNodeResultAttachment({
    ctx: params.ctx,
    subSession,
    transition: params.transition,
    nodeIdentity: params.nodeIdentity,
  });
}

async function resolveNodeAgentResult({
  hookManager,
  signal,
  hookPayload,
  subSession,
  childFailed,
}) {
  if (childFailed) return { action: null, subSession };
  const emitted = await hookManager.emit(HOOK_POINT.WORKFLOW.NODE_AGENT_EXECUTE, hookPayload, {
    signal,
  });
  throwIfWorkflowAborted(signal);
  const action = emitted.outcomes
    .map((outcome) => outcome?.value?.action)
    .find((value) => value && typeof value === "object");
  return {
    action: action || { type: WORKFLOW_ACTION.SUBMIT },
    subSession,
  };
}
