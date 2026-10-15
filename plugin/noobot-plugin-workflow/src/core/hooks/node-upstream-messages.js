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
import { resolveWorkflowNodeDialogProcessId } from "../node-dialog-process-id.js";
import {
  formatAttachmentIdentityRef,
  projectAttachmentIdentity,
} from "@noobot/attachment-protocol";
import { firstText, text } from "@noobot/shared/value";

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
  const nodeName = text(semanticNode?.name);
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
  const nodeId = text(upstreamStep.nodeId);
  if (!nodeId) return null;
  const stepId = text(upstreamStep.stepId);
  const completed = completedStepResults.get(stepId) || {};
  const transferEnvelopes = getWorkflowTransferPayloadFromResult(completed).transferEnvelopes;
  const transferFiles = resolveWorkflowTransferAttachmentReferences({ transferEnvelopes }, {});
  if (!transferFiles.length) return null;
  const stepIndex = Number(completed.stepIndex ?? upstreamStep.stepIndex);
  return {
    nodeId,
    nodeName: text(upstreamStep.nodeName),
    nodeTask: text(completed.nodeTask),
    actionNodeStateId: firstText(completed.actionNodeStateId, upstreamStep.actionNodeStateId),
    stepId,
    stepIndex: Number.isFinite(stepIndex) ? stepIndex : -1,
    transition: Number(completed.transition ?? 0),
    nodeDialogProcessId: resolveWorkflowNodeDialogProcessId(completed),
    nodeSessionId: text(completed.nodeSessionId),
    status: firstText(completed.status, upstreamStep.status),
    transferEnvelopes,
  };
}

export async function buildWorkflowUpstreamAttachmentSystemMessage({
  options = {},
  ctx = {},
  pendingStep = {},
  upstreamNodeResults = [],
} = {}) {
  const locale = resolveWorkflowLocaleFromContext(ctx);
  const normalizedResults = Array.isArray(upstreamNodeResults) ? upstreamNodeResults : [];
  const lines = collectUpstreamEvidence(normalizedResults, ctx, locale);
  if (!lines.length) return "";
  const customUpstreamMessage = buildCustomUpstreamMessage(
    options,
    ctx,
    pendingStep,
    normalizedResults,
  );
  const pendingName = text(pendingStep?.nodeName);
  return customUpstreamMessage || buildDefaultUpstreamMessage(locale, pendingName, lines);
}

function collectUpstreamEvidence(results, ctx, locale) {
  const lines = [];
  for (const result of results) {
    appendUpstreamAttachmentLines(lines, result, text(result?.nodeName), ctx, locale);
  }
  return lines;
}

function appendUpstreamAttachmentLines(lines, result, nodeLabel, ctx, locale) {
  const transferFiles = resolveWorkflowTransferAttachmentReferences(
    { transferEnvelopes: Array.isArray(result?.transferEnvelopes) ? result.transferEnvelopes : [] },
    ctx,
  );
  for (const [index, file] of transferFiles.entries()) {
    const label =
      text(file?.name) ||
      tWorkflow(locale, WORKFLOW_I18N_KEYSET.INPUT.DEFAULT_LABEL, { index: index + 1 });
    lines.push(`- ${nodeLabel} / ${label}: ${formatAttachmentIdentityRef(file?.identity)}`);
  }
}

function buildCustomUpstreamMessage(options, ctx, pendingStep, upstreamNodeResults) {
  if (typeof options?.workflowNodeSystemMessageBuilder !== "function") return "";
  try {
    return text(
      options.workflowNodeSystemMessageBuilder({
        ctx,
        pendingStep,
        upstreamNodeResults,
        attachments: [],
      }),
    );
  } catch (error) {
    console.warn("[workflow] workflowNodeSystemMessageBuilder failed:", error);
    return "";
  }
}

function buildDefaultUpstreamMessage(locale, pendingName, lines) {
  return [
    tWorkflow(locale, WORKFLOW_I18N_KEYSET.NODE_AGENT.UPSTREAM_ATTACHMENTS_TITLE),
    "",
    tWorkflow(locale, WORKFLOW_I18N_KEYSET.COMMON.CURRENT_NODE_LINE, { name: pendingName }),
    "",
    tWorkflow(locale, WORKFLOW_I18N_KEYSET.NODE_AGENT.UPSTREAM_HINT),
    "",
    tWorkflow(locale, WORKFLOW_I18N_KEYSET.NODE_AGENT.UPSTREAM_RESULT_TITLE),
    ...lines,
  ].join("\n");
}
