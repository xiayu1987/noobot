/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { WORKFLOW_ACTION, WORKFLOW_PLUGIN_DEFAULTS } from "../constants.js";
import { HOOK_POINT } from "@noobot/hook-protocol";
import { resolveWorkflowLocaleFromContext, tWorkflow, WORKFLOW_I18N_KEYSET } from "../i18n.js";
import {
  getWorkflowTransferPayloadFromResult,
  mergeAttachmentReferences,
  mergeAttachments,
  normalizeAttachmentRefs,
  normalizeWorkflowTransferPayload,
  resolveNodeInputAttachments,
  resolveWorkflowTransferAttachmentReferences,
} from "./attachments.js";
import {
  buildWorkflowDialogRelativeDir,
  persistWorkflowNodeResultAttachment,
} from "./persistence.js";
import {
  hasOwnObjectKey,
  isWorkflowAbortError,
  resolveWorkflowAbortSignal,
  resolveWorkflowParentRunConfig,
  resolveWorkflowRuntimeFromContext,
  throwIfWorkflowAborted,
  withTimeout,
} from "./runtime.js";
import { resolveWorkflowNodeDialogProcessId } from "../node-dialog-process-id.js";
import {
  formatAttachmentIdentityRef,
  projectAttachmentIdentity,
} from "@noobot/attachment-protocol";

export function buildWorkflowInputAttachmentSystemMessage({
  ctx = {},
  attachments = [],
  semanticNode = {},
} = {}) {
  const normalizedAttachments = Array.isArray(attachments) ? attachments : [];
  const locale = resolveWorkflowLocaleFromContext(ctx);
  const lines = normalizedAttachments
    .map((item = {}, index) => {
      const label = String(
        item?.name ||
          item?.fileName ||
          tWorkflow(locale, WORKFLOW_I18N_KEYSET.INPUT.DEFAULT_LABEL, { index: index + 1 }),
      ).trim();
      return `- ${label}: ${formatAttachmentIdentityRef(projectAttachmentIdentity(item))}`;
    })
    .filter(Boolean);
  if (!lines.length) return "";
  const nodeName = String(
    semanticNode?.name ||
      semanticNode?.id ||
      tWorkflow(locale, WORKFLOW_I18N_KEYSET.COMMON.CURRENT_NODE_FALLBACK),
  ).trim();
  return [
    tWorkflow(locale, WORKFLOW_I18N_KEYSET.INPUT.USER_RAW_TITLE),
    "",
    tWorkflow(locale, WORKFLOW_I18N_KEYSET.COMMON.CURRENT_NODE_LINE, { name: nodeName }),
    "",
    tWorkflow(locale, WORKFLOW_I18N_KEYSET.INPUT.SYSTEM_HINT),
    "",
    ...lines,
  ].join("\n");
}

export function buildWorkflowUpstreamAttachmentResults({
  upstreamActionSteps = [],
  completedStepResults = new Map(),
} = {}) {
  return (Array.isArray(upstreamActionSteps) ? upstreamActionSteps : [])
    .map((upstreamStep) => projectWorkflowUpstreamResult(upstreamStep, completedStepResults))
    .filter(Boolean);
}

function projectWorkflowUpstreamResult(upstreamStep = {}, completedStepResults = new Map()) {
  const nodeId = String(upstreamStep.nodeId || "").trim();
  if (!nodeId) return null;
  const stepId = String(upstreamStep.stepId || "").trim();
  const completed = completedStepResults.get(stepId) || {};
  const transferEnvelopes = getWorkflowTransferPayloadFromResult(completed).transferEnvelopes;
  const status = firstText(completed.status, upstreamStep.status);
  const stepFailure = resolveWorkflowStepFailure(completed, upstreamStep);
  const transferFiles = resolveWorkflowTransferAttachmentReferences({ transferEnvelopes }, {});
  if (!transferFiles.length && status !== "failed" && !stepFailure) return null;
  const stepIndex = Number(completed.stepIndex ?? upstreamStep.stepIndex);
  return {
    nodeId,
    nodeName: firstText(completed.nodeName, upstreamStep.nodeName, nodeId),
    nodeTask: firstText(completed.nodeTask, upstreamStep.nodeTask, upstreamStep.task),
    actionNodeStateId: firstText(completed.actionNodeStateId, upstreamStep.actionNodeStateId),
    stepId,
    stepIndex: Number.isFinite(stepIndex) ? stepIndex : -1,
    transition: Number(completed.transition ?? 0),
    nodeDialogProcessId: resolveWorkflowNodeDialogProcessId(completed),
    nodeSessionId: String(completed.nodeSessionId || "").trim(),
    status,
    stepFailure,
    transferEnvelopes,
  };
}

function resolveWorkflowStepFailure(completed, upstreamStep) {
  if (completed?.stepFailure && typeof completed.stepFailure === "object") {
    return completed.stepFailure;
  }
  if (upstreamStep?.stepFailure && typeof upstreamStep.stepFailure === "object") {
    return upstreamStep.stepFailure;
  }
  return null;
}

export async function buildWorkflowUpstreamAttachmentSystemMessage({
  options = {},
  ctx = {},
  pendingStep = {},
  upstreamNodeResults = [],
} = {}) {
  const locale = resolveWorkflowLocaleFromContext(ctx);
  const normalizedResults = Array.isArray(upstreamNodeResults) ? upstreamNodeResults : [];
  const { lines, failureLines } = collectUpstreamEvidence(normalizedResults, ctx, locale);
  if (!lines.length && !failureLines.length) return "";
  const customUpstreamMessage = buildCustomUpstreamMessage(
    options,
    ctx,
    pendingStep,
    normalizedResults,
  );
  const pendingName = String(
    pendingStep?.nodeName ||
      pendingStep?.nodeId ||
      tWorkflow(locale, WORKFLOW_I18N_KEYSET.COMMON.CURRENT_NODE_FALLBACK),
  ).trim();
  const message =
    customUpstreamMessage || buildDefaultUpstreamMessage(locale, pendingName, lines, failureLines);
  return transferUpstreamSemanticContent({
    ctx,
    pendingStep,
    pendingName,
    normalizedResults,
    lines,
    failureLines,
    message,
  });
}

function collectUpstreamEvidence(results, ctx, locale) {
  const lines = [];
  const failureLines = [];
  for (const result of results) {
    const nodeLabel = resolveUpstreamNodeLabel(result, locale);
    const failureLine = buildUpstreamFailureLine(result, nodeLabel, locale);
    if (failureLine) failureLines.push(failureLine);
    appendUpstreamAttachmentLines(lines, result, nodeLabel, ctx, locale);
  }
  return { lines, failureLines };
}

function resolveUpstreamNodeLabel(result, locale) {
  return String(
    result?.nodeName ||
      result?.nodeId ||
      tWorkflow(locale, WORKFLOW_I18N_KEYSET.NODE_AGENT.UPSTREAM_NODE_FALLBACK),
  ).trim();
}

function buildUpstreamFailureLine(result, nodeLabel, locale) {
  const failed =
    String(result?.status || "").trim() === "failed" ||
    (result?.stepFailure && typeof result.stepFailure === "object");
  if (!failed) return "";
  const task = String(result?.nodeTask || result?.task || "").trim();
  const message = String(
    result?.stepFailure?.message ||
      tWorkflow(locale, WORKFLOW_I18N_KEYSET.NODE_AGENT.SUB_AGENT_FAILURE_FALLBACK),
  ).trim();
  const key = task
    ? WORKFLOW_I18N_KEYSET.NODE_AGENT.FAILURE_LINE_WITH_TASK
    : WORKFLOW_I18N_KEYSET.NODE_AGENT.FAILURE_LINE_WITHOUT_TASK;
  return tWorkflow(locale, key, { nodeLabel, task, message });
}

function appendUpstreamAttachmentLines(lines, result, nodeLabel, ctx, locale) {
  const transferFiles = resolveWorkflowTransferAttachmentReferences(
    { transferEnvelopes: Array.isArray(result?.transferEnvelopes) ? result.transferEnvelopes : [] },
    ctx,
  );
  for (const [index, file] of transferFiles.entries()) {
    const label = String(
      file?.name ||
        tWorkflow(locale, WORKFLOW_I18N_KEYSET.INPUT.DEFAULT_LABEL, { index: index + 1 }),
    ).trim();
    lines.push(`- ${nodeLabel} / ${label}: ${formatAttachmentIdentityRef(file?.identity)}`);
  }
}

function buildCustomUpstreamMessage(options, ctx, pendingStep, upstreamNodeResults) {
  if (typeof options?.workflowNodeSystemMessageBuilder !== "function") return "";
  try {
    return String(
      options.workflowNodeSystemMessageBuilder({
        ctx,
        pendingStep,
        upstreamNodeResults,
        attachments: [],
      }) || "",
    ).trim();
  } catch (error) {
    console.warn("[workflow] workflowNodeSystemMessageBuilder failed:", error);
    return "";
  }
}

function buildDefaultUpstreamMessage(locale, pendingName, lines, failureLines) {
  return [
    tWorkflow(locale, WORKFLOW_I18N_KEYSET.NODE_AGENT.UPSTREAM_ATTACHMENTS_TITLE),
    "",
    tWorkflow(locale, WORKFLOW_I18N_KEYSET.COMMON.CURRENT_NODE_LINE, { name: pendingName }),
    "",
    tWorkflow(locale, WORKFLOW_I18N_KEYSET.NODE_AGENT.UPSTREAM_HINT),
    "",
    failureLines.length
      ? tWorkflow(locale, WORKFLOW_I18N_KEYSET.NODE_AGENT.UPSTREAM_FAILURE_TITLE)
      : "",
    ...failureLines,
    failureLines.length && lines.length ? "" : "",
    lines.length ? tWorkflow(locale, WORKFLOW_I18N_KEYSET.NODE_AGENT.UPSTREAM_RESULT_TITLE) : "",
    ...lines,
  ].join("\n");
}

async function transferUpstreamSemanticContent({
  ctx,
  pendingStep,
  pendingName,
  normalizedResults,
  lines,
  failureLines,
  message,
}) {
  const runtime = resolveWorkflowRuntimeFromContext(ctx);
  const transferSemanticContent = runtime?.sharedTools?.semanticTransfer?.transferSemanticContent;
  if (typeof transferSemanticContent !== "function") return message;
  try {
    const transferred = await transferSemanticContent({
      scenario: "workflow",
      strategy: "workflow_subagent",
      content: message,
      producer: { type: "plugin", id: `workflow-upstream:${pendingName}` },
      meta: {
        pendingNodeId: String(pendingStep?.nodeId || "").trim(),
        pendingNodeName: pendingName,
        upstreamResultCount: normalizedResults.length,
        upstreamAttachmentLineCount: lines.length,
        failureCount: failureLines.length,
      },
    });
    return String(transferred?.injectionMessage || message).trim() || message;
  } catch (error) {
    console.warn("[workflow] upstream semantic transfer failed:", error);
    return message;
  }
}

export function buildWorkflowNodeInstruction(step = {}) {
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

export function resolveNodeTaskForPendingStep({ semantic = {}, pendingStep = {} } = {}) {
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

export function resolveWorkflowInstanceId(ctx = {}) {
  const provided = String(
    ctx?.workflowInstanceId || ctx?.runConfig?.workflowInstanceId || "",
  ).trim();
  if (provided) return provided;
  const base = String(ctx?.dialogProcessId || ctx?.sessionId || "session").trim() || "session";
  return `wf_inst_${base}_${Date.now()}`;
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
    childExecutionId: firstText(nodeIdentity.childExecutionId, `agent:${turnScopeId}`),
    sessionId: firstText(nodeIdentity.sessionId),
    nodeId: firstText(nodeIdentity.nodeId, pendingStep?.nodeId),
    nodeName: firstText(nodeIdentity.nodeName, pendingStep?.nodeName),
  };
}

function firstText(...values) {
  for (const value of values) {
    const text = String(value ?? "").trim();
    if (text) return text;
  }
  return "";
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

export function buildPendingStepKey(step = {}) {
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
