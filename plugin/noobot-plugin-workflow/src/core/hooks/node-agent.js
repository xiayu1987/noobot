/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import {
  PLUGIN_ID,
  WORKFLOW_DATA_SCOPE,
  WORKFLOW_PLUGIN_DEFAULTS,
  resolveWorkflowDataRelativePath,
} from "../constants.js";
import { HOOK_POINT } from "@noobot/hook-protocol";
import { createWorkflowNodeOrigin } from "@noobot/session-protocol/execution-lifecycle";
import { WORKFLOW_ACTION_TYPE, isWorkflowActionType } from "workflow";
import { resolveWorkflowLocaleFromContext, tWorkflow, WORKFLOW_I18N_KEYSET } from "../i18n.js";
import {
  mergeAttachmentReferences,
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
  options,
  ctx,
  signal,
  pendingStep,
  semantic,
  nodeIdentity,
  transition,
  upstreamNodeResults,
}) {
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
      workflowRunId: nodeIdentity.workflowRunId,
      nodeIdentity,
      pendingStep,
      transition,
      semantic,
      semanticNode,
      upstreamNodeResults,
      upstreamAttachments: collectUpstreamAttachmentReferences(upstreamNodeResults),
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

function collectUpstreamAttachmentReferences(upstreamNodeResults) {
  return upstreamNodeResults.reduce(
    (acc, item) =>
      mergeAttachmentReferences(
        acc,
        resolveWorkflowTransferAttachmentReferences({ transferEnvelopes: item.transferEnvelopes }),
      ),
    [],
  );
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
  });
  return {
    parentExecutionScope: ctx?.agentContext || null,
    abortSignal: params.signal,
    message: params.agentInstruction,
    attachments: params.nodeInputAttachments,
    runConfigPatch: buildWorkflowNodeRunConfigPatch(ctx),
    systemMessageFactory: ({ attachments }) =>
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

function buildWorkflowNodeRunConfigPatch(ctx) {
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
    userId: ctx.userId,
    sessionId: identity.nodeSessionId,
    parentSessionId: ctx.sessionId,
    parentDialogProcessId: ctx.dialogProcessId,
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
    workflowRunId: identity.workflowRunId,
    executionId: identity.activeChildExecutionId,
    parentExecutionId: runIdentity.executionId,
    rootExecutionId: runIdentity.rootExecutionId,
    origin: createWorkflowNodeOrigin({
      workflowRunId: identity.workflowRunId,
      workflowNodeExecutionId: identity.nodeExecutionId,
    }),
    nodeExecutionId: identity.nodeExecutionId,
    commandId: identity.commandId,
    dialogProcessId: identity.dialogProcessId,
    nodeId: identity.nodeId,
    nodeName: identity.nodeName,
    transition: params.transition,
    turnScopeId: identity.turnScopeId,
    workflowSessionId: ctx.sessionId,
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
  return { action: resolveNodeAgentDecision(emitted.outcomes), subSession };
}

export const NODE_AGENT_DEFAULT_ACTION = Object.freeze({ type: WORKFLOW_ACTION_TYPE.SUBMIT });

function nodeAgentActionError(message, code, fields) {
  return Object.assign(new Error(message), { code, ...fields });
}

function requireNodeAgentDecision(outcome) {
  if (outcome.value === undefined) return null;
  const action = outcome.value?.action;
  if (!isWorkflowActionType(action?.type)) {
    throw nodeAgentActionError(
      `workflow node agent decision invalid: ${outcome.handlerId}`,
      "WORKFLOW_NODE_ACTION_INVALID",
      { handlerId: outcome.handlerId },
    );
  }
  return { handlerId: outcome.handlerId, action: { type: action.type } };
}

export function resolveNodeAgentDecision(outcomes) {
  const decisions = outcomes.map(requireNodeAgentDecision).filter(Boolean);
  if (decisions.length > 1) {
    throw nodeAgentActionError(
      `workflow node agent decision conflict: ${decisions.map((item) => item.handlerId).join(",")}`,
      "WORKFLOW_NODE_ACTION_CONFLICT",
      { handlerIds: decisions.map((item) => item.handlerId) },
    );
  }
  return decisions.length ? decisions[0].action : NODE_AGENT_DEFAULT_ACTION;
}
