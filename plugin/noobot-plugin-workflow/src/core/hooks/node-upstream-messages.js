/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { resolveWorkflowLocaleFromContext, tWorkflow, WORKFLOW_I18N_KEYSET } from "../i18n.js";
import { resolveWorkflowTransferAttachmentReferences } from "./attachments.js";
import {
  formatAttachmentIdentityRef,
  projectAttachmentIdentity,
} from "@noobot/attachment-protocol";
import { text } from "@noobot/shared/value";

export function buildWorkflowInputAttachmentSystemMessage({ ctx, attachments, semanticNode }) {
  const locale = resolveWorkflowLocaleFromContext(ctx);
  const lines = attachments
    .map((item, index) => {
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
  upstreamActionSteps,
  completedStepResults,
}) {
  return upstreamActionSteps
    .map((upstreamStep) => projectWorkflowUpstreamResult(upstreamStep, completedStepResults))
    .filter(Boolean);
}

function projectWorkflowUpstreamResult(upstreamStep, completedStepResults) {
  const completed = completedStepResults.get(upstreamStep.stepId);
  if (!completed) return null;
  const { transferEnvelopes } = completed;
  if (!resolveWorkflowTransferAttachmentReferences({ transferEnvelopes }).length) return null;
  return {
    nodeId: upstreamStep.nodeId,
    nodeName: upstreamStep.nodeName,
    nodeTask: completed.nodeTask,
    actionNodeStateId: upstreamStep.actionNodeStateId,
    stepId: upstreamStep.stepId,
    stepIndex: upstreamStep.stepIndex,
    transition: completed.transition,
    nodeSessionId: completed.nodeSessionId,
    transferEnvelopes,
  };
}

export async function buildWorkflowUpstreamAttachmentSystemMessage({
  ctx,
  pendingStep,
  upstreamNodeResults,
}) {
  const locale = resolveWorkflowLocaleFromContext(ctx);
  const lines = collectUpstreamEvidence(upstreamNodeResults, locale);
  if (!lines.length) return "";
  return buildDefaultUpstreamMessage(locale, pendingStep.nodeName, lines);
}

function collectUpstreamEvidence(results, locale) {
  const lines = [];
  for (const result of results) {
    appendUpstreamAttachmentLines(lines, result, locale);
  }
  return lines;
}

function appendUpstreamAttachmentLines(lines, result, locale) {
  const transferFiles = resolveWorkflowTransferAttachmentReferences({
    transferEnvelopes: result.transferEnvelopes,
  });
  for (const [index, file] of transferFiles.entries()) {
    const label =
      text(file?.name) ||
      tWorkflow(locale, WORKFLOW_I18N_KEYSET.INPUT.DEFAULT_LABEL, { index: index + 1 });
    lines.push(`- ${result.nodeName} / ${label}: ${formatAttachmentIdentityRef(file?.identity)}`);
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
