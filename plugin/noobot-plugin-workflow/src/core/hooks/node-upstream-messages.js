/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { resolveWorkflowLocaleFromContext, tWorkflow, WORKFLOW_I18N_KEYSET } from "../i18n.js";
import {
  getWorkflowTransferPayloadFromResult,
  resolveWorkflowTransferAttachmentReferences,
} from "./attachments.js";
import { firstText, resolveWorkflowRuntimeFromContext } from "./runtime.js";
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
