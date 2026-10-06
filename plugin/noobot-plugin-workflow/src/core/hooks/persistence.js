/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import {
  applyWorkflowTransferPayload,
  normalizeWorkflowTransferPayload,
  resolveWorkflowTransferAttachmentReferences,
} from "./attachments.js";
import { resolveWorkflowParentRunConfig, resolveWorkflowRuntimeFromContext } from "./runtime.js";
import { resolveWorkflowLocaleFromContext, tWorkflow, WORKFLOW_I18N_KEYSET } from "../i18n.js";
import { LENGTH_THRESHOLDS } from "@noobot/shared/length-thresholds";
import { ATTACHMENT_SOURCE } from "@noobot/attachment-protocol/identity";
import { TRANSFER_REASON, TRANSFER_SOURCE } from "@noobot/semantic-transfer-protocol";

function ensureTurnMessages(agentResult = {}) {
  const turnMessages = Array.isArray(agentResult?.turnMessages) ? agentResult.turnMessages : [];
  agentResult.turnMessages = turnMessages;
  return turnMessages;
}

function resolveSubSessionResult(subSession) {
  return subSession?.result && typeof subSession.result === "object" ? subSession.result : {};
}

function findLastAssistantContent(messages) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const messageItem = messages[index] || {};
    const role = String(messageItem?.role || "")
      .trim()
      .toLowerCase();
    if (role && role !== "assistant") continue;
    const content = String(messageItem?.content || "").trim();
    if (content) return content;
  }
  return "";
}

export function resolveSubSessionFinalOutput(subSession = {}) {
  const result = resolveSubSessionResult(subSession);
  const messages = Array.isArray(result?.messages) ? result.messages : [];
  const lastAssistantContent = findLastAssistantContent(messages);
  if (lastAssistantContent) return lastAssistantContent;
  return String(result?.answer || result?.output || "").trim();
}

export function stripHarnessReviewAppendix(text = "") {
  const raw = String(text || "").trim();
  if (!raw) return "";
  const markerIndex = raw.search(/(?:^|\n)\s*\[Harness-Review\]\s*(?:\n|$)/);
  if (markerIndex < 0) return raw;
  return raw.slice(0, markerIndex).trim();
}

function buildWorkflowTransferReferenceBlock(workflowPayload = null, ctx = {}) {
  const locale = resolveWorkflowLocaleFromContext(ctx);
  const references = resolveWorkflowTransferAttachmentReferences(
    workflowPayload && typeof workflowPayload === "object" ? workflowPayload : {},
  );
  const lines = references
    .map((item = {}, index) => {
      const label = String(
        item?.name ||
          tWorkflow(locale, WORKFLOW_I18N_KEYSET.INPUT.DEFAULT_LABEL, { index: index + 1 }),
      ).trim();
      const attachmentId = String(item?.identity?.attachmentId || "").trim();
      if (!attachmentId) return "";
      return `- ${label}: attachmentId=${attachmentId}`;
    })
    .filter(Boolean);
  if (!lines.length) return "";
  return [
    "",
    tWorkflow(locale, WORKFLOW_I18N_KEYSET.PERSISTENCE.NODE_RESULT_ATTACHMENT_TITLE),
    "",
    ...lines,
  ].join("\n");
}

export function truncateWorkflowResultText(
  text = "",
  maxLength = LENGTH_THRESHOLDS.contextPreview.workflowResultTextChars,
) {
  const raw = String(text || "").trim();
  const fallback = LENGTH_THRESHOLDS.contextPreview.workflowResultTextChars;
  const limit = Number.isFinite(Number(maxLength)) ? Math.max(200, Number(maxLength)) : fallback;
  if (raw.length <= limit) return raw;
  return `${raw.slice(0, limit).trim()}\n\n...`;
}

function composeWorkflowFinalContent({ semanticText = "", attachmentPathBlock = "" } = {}) {
  return [semanticText, attachmentPathBlock]
    .map((item) => String(item || "").trim())
    .filter(Boolean)
    .join("\n\n");
}

function sanitizeWorkflowPayloadForSessionMessage(workflowPayload = null) {
  if (!workflowPayload || typeof workflowPayload !== "object") return null;
  let payload = null;
  try {
    payload = JSON.parse(JSON.stringify(workflowPayload));
  } catch {
    return null;
  }
  const nodeAgentRuns = Array.isArray(payload?.execution?.nodeAgentRuns)
    ? payload.execution.nodeAgentRuns
    : [];
  for (const item of nodeAgentRuns) {
    if (!item || typeof item !== "object") continue;
    delete item.nodeResultText;
  }
  return payload;
}

function trimText(value) {
  return String(value || "").trim();
}

function resolveNodeResultIdentity({ nodeIdentity, pendingStep, transition }) {
  const identity = nodeIdentity && typeof nodeIdentity === "object" ? nodeIdentity : {};
  const step = pendingStep || {};
  const numericTransition = Number(transition);
  return {
    identity,
    nodeName: String(identity.nodeName || step.nodeName || step.nodeId || "workflow-node").trim(),
    nodeId: trimText(identity.nodeId || step.nodeId),
    normalizedTransition: Number.isFinite(numericTransition) ? Math.floor(numericTransition) : 0,
  };
}

function buildNodeResultBody({ locale, nodeName, nodeId, subSession, cleanOutput }) {
  const keys = WORKFLOW_I18N_KEYSET.PERSISTENCE;
  return [
    tWorkflow(locale, keys.NODE_RESULT_TITLE),
    "",
    tWorkflow(locale, keys.NODE_LINE, {
      name: nodeName || tWorkflow(locale, keys.NODE_UNNAMED_FALLBACK),
    }),
    tWorkflow(locale, keys.NODE_ID_LINE, { id: nodeId || "-" }),
    tWorkflow(locale, keys.SUB_SESSION_LINE, { id: trimText(subSession.sessionId) || "-" }),
    tWorkflow(locale, keys.DIALOG_LINE, { id: trimText(subSession.dialogProcessId) || "-" }),
    "",
    tWorkflow(locale, keys.FINAL_OUTPUT_TITLE),
    "",
    cleanOutput,
    "",
  ].join("\n");
}

function buildNodeResultTransferMeta({ identity, subSession, normalizedTransition }) {
  return {
    transition: normalizedTransition,
    workflowRunId: trimText(identity.workflowRunId),
    nodeExecutionId: trimText(identity.nodeExecutionId),
    commandId: trimText(identity.commandId),
    dialogProcessId: trimText(identity.dialogProcessId || subSession.dialogProcessId),
    turnScopeId: trimText(identity.turnScopeId),
    nodeSessionId: trimText(subSession.sessionId),
  };
}

function requireSemanticTransferContent(ctx, purpose) {
  const runtime = resolveWorkflowRuntimeFromContext(ctx);
  const semanticTransferContent = runtime?.sharedTools?.semanticTransfer?.transferSemanticContent;
  if (typeof semanticTransferContent !== "function") {
    throw new Error(`Semantic transfer service is required for ${purpose}`);
  }
  return semanticTransferContent;
}

function applyNodeResultTransfer(subSession, transferPayload) {
  const result = subSession.result;
  if (!result || typeof result !== "object") return;
  applyWorkflowTransferPayload(result, transferPayload);
  if (!Array.isArray(result.messages) || !result.messages.length) return;
  const lastIndex = result.messages.length - 1;
  result.messages[lastIndex] = applyWorkflowTransferPayload(
    { ...(result.messages[lastIndex] || {}) },
    transferPayload,
  );
}

export async function persistWorkflowNodeResultAttachment({
  options = {},
  ctx = {},
  subSession = null,
  pendingStep = {},
  transition = 0,
  nodeIdentity = null,
} = {}) {
  const locale = resolveWorkflowLocaleFromContext(ctx);
  if (!subSession) return normalizeWorkflowTransferPayload();
  const cleanOutput = stripHarnessReviewAppendix(resolveSubSessionFinalOutput(subSession));
  if (!cleanOutput) return normalizeWorkflowTransferPayload();
  const { identity, nodeName, nodeId, normalizedTransition } = resolveNodeResultIdentity({
    nodeIdentity,
    pendingStep,
    transition,
  });
  const body = buildNodeResultBody({ locale, nodeName, nodeId, subSession, cleanOutput });
  const semanticTransferContent = requireSemanticTransferContent(ctx, "workflow node results");
  const transferred = await semanticTransferContent({
    scenario: "workflow",
    strategy: "workflow_subagent",
    category: "sub_agent",
    businessPoint: "task_result",
    messages: [
      {
        nodeId,
        nodeName,
        content: body,
        meta: buildNodeResultTransferMeta({ identity, subSession, normalizedTransition }),
      },
    ],
    nextSteps: [],
    forceAttachment: true,
    attachmentSource: ATTACHMENT_SOURCE.MODEL,
    generationSource: "workflow_node_agent_result",
    source: TRANSFER_SOURCE.PLUGIN,
    reason: TRANSFER_REASON.WORKFLOW_NODE_AGENT_RESULT,
    producer: { type: "plugin", id: `workflow-node:${nodeId}` },
    mimeType: "text/markdown",
  });
  const transferPayload = normalizeWorkflowTransferPayload(transferred);
  if (!transferPayload.transferEnvelopes.length) {
    throw new Error("Workflow node result transfer produced no V2 envelope");
  }
  applyNodeResultTransfer(subSession, transferPayload);
  return transferPayload;
}

const WORKFLOW_MESSAGE_PHASES = Object.freeze(new Set(["planning", "completed"]));

async function transferWorkflowFinalAttachment({
  transferReferenceBlock = "",
  normalizedPhase = "",
  dialogProcessId = "",
  ctx = {},
} = {}) {
  const semanticTransferContent = requireSemanticTransferContent(
    ctx,
    "workflow final attachment summary",
  );
  const transferred = await semanticTransferContent({
    scenario: "workflow",
    strategy: "workflow_final_plan",
    category: "main_agent",
    businessPoint: "final_plan",
    messages: [
      {
        id: "workflow-final-attachment-summary",
        nodeId: "workflow-final",
        nodeName: "workflow-final-attachment-summary",
        content: transferReferenceBlock,
        meta: {
          phase: normalizedPhase,
          dialogProcessId,
          sessionId: String(ctx?.sessionId || "").trim(),
        },
      },
    ],
    nextSteps: [],
    forceAttachment: true,
    attachmentSource: ATTACHMENT_SOURCE.MODEL,
    generationSource: `workflow_${normalizedPhase}_attachment_summary`,
    source: TRANSFER_SOURCE.PLUGIN,
    reason: TRANSFER_REASON.WORKFLOW_FINAL_ATTACHMENT_SUMMARY,
    producer: { type: "plugin", id: "workflow-final-attachment-summary" },
    mimeType: "text/markdown",
  });
  const composedTransferPayload = normalizeWorkflowTransferPayload(transferred);
  if (!composedTransferPayload.transferEnvelopes.length) {
    throw new Error("Workflow final attachment transfer produced no V2 envelope");
  }
  return composedTransferPayload;
}

function mergeWorkflowTransferEnvelopes(baseTransferPayload, composedTransferPayload) {
  return normalizeWorkflowTransferPayload({
    transferEnvelopes: [
      ...(Array.isArray(baseTransferPayload?.transferEnvelopes)
        ? baseTransferPayload.transferEnvelopes
        : []),
      ...(Array.isArray(composedTransferPayload?.transferEnvelopes)
        ? composedTransferPayload.transferEnvelopes
        : []),
    ],
  });
}

function resolveWorkflowMessageId(ctx = {}) {
  const messageId = String(
    ctx?.messageId ||
      ctx?.runConfig?.messageId ||
      resolveWorkflowParentRunConfig(ctx)?.messageId ||
      "",
  ).trim();
  if (!messageId) {
    throw new Error("Workflow final message requires canonical messageId");
  }
  return messageId;
}

function buildSessionWorkflowPayload(baseWorkflowPayload, authoritativeWorkflowRunId) {
  const sessionWorkflowPayload =
    sanitizeWorkflowPayloadForSessionMessage(baseWorkflowPayload) || {};
  if (!authoritativeWorkflowRunId) return sessionWorkflowPayload;
  sessionWorkflowPayload.workflowRunId = authoritativeWorkflowRunId;
  sessionWorkflowPayload.execution = {
    ...(sessionWorkflowPayload.execution || {}),
    workflowRunId: authoritativeWorkflowRunId,
    instanceId: authoritativeWorkflowRunId,
  };
  return sessionWorkflowPayload;
}

function findExistingWorkflowMessage(turnMessages = [], dialogProcessId = "") {
  return turnMessages.find((messageItem = {}) => {
    if (messageItem?.pluginMessage !== true) return false;
    if (String(messageItem?.dialogProcessId || "").trim() !== dialogProcessId) return false;
    const meta =
      messageItem?.pluginMeta && typeof messageItem.pluginMeta === "object"
        ? messageItem.pluginMeta
        : {};
    return String(meta?.source || "").trim() === "workflow-plugin";
  });
}

async function resolveWorkflowTransferParts({
  workflowPayload = null,
  baseWorkflowPayload = {},
  ctx = {},
  normalizedPhase = "",
  dialogProcessId = "",
} = {}) {
  const baseTransferPayload = normalizeWorkflowTransferPayload(baseWorkflowPayload);
  const transferReferenceBlock = buildWorkflowTransferReferenceBlock(workflowPayload, ctx);
  const composedTransferPayload = transferReferenceBlock
    ? await transferWorkflowFinalAttachment({
        transferReferenceBlock,
        normalizedPhase,
        dialogProcessId,
        ctx,
      })
    : normalizeWorkflowTransferPayload();
  const mergedTransferPayload = mergeWorkflowTransferEnvelopes(
    baseTransferPayload,
    composedTransferPayload,
  );
  const attachmentReferenceBlock =
    buildWorkflowTransferReferenceBlock(
      transferReferenceBlock ? composedTransferPayload : mergedTransferPayload,
      ctx,
    ) || "";
  return { mergedTransferPayload, attachmentReferenceBlock };
}

function resolveAuthoritativeWorkflowRunId(workflowRunId, baseWorkflowPayload = {}, ctx = {}) {
  return String(
    workflowRunId ||
      baseWorkflowPayload?.workflowRunId ||
      baseWorkflowPayload?.execution?.workflowRunId ||
      baseWorkflowPayload?.execution?.instanceId ||
      ctx?.workflowRunId ||
      "",
  ).trim();
}

function pickNonEmptyTimelines(messageEventProjection = {}) {
  const timelines = {};
  for (const key of ["activityTimeline", "toolTimeline"]) {
    const timeline = messageEventProjection[key];
    if (Array.isArray(timeline) && timeline.length) timelines[key] = timeline;
  }
  return timelines;
}

function buildWorkflowPluginMeta({
  normalizedPhase = "",
  semanticResolution = {},
  sourceText = "",
  semanticText = "",
  sessionWorkflowPayload = {},
} = {}) {
  return {
    source: "workflow-plugin",
    kind: "workflow",
    phase: normalizedPhase,
    semanticInvokerUsed: semanticResolution?.invoked === true,
    sourceTextPreview: String(sourceText || "").slice(
      0,
      LENGTH_THRESHOLDS.contextPreview.workflowPayloadPreviewChars,
    ),
    semanticTextPreview: String(semanticText || "").slice(
      0,
      LENGTH_THRESHOLDS.contextPreview.workflowSemanticTextPreviewChars,
    ),
    payload: sessionWorkflowPayload,
  };
}

async function upsertWorkflowMessage({
  options = {},
  agentResult = {},
  ctx = {},
  sourceText = "",
  semanticText = "",
  semanticResolution = {},
  semantic = null,
  workflowRunId = "",
  planningNodeSessions = [],
  workflowPayload = null,
  nodeAgentRuns = [],
  phase = "",
} = {}) {
  const normalizedPhase = String(phase || "").trim();
  if (!WORKFLOW_MESSAGE_PHASES.has(normalizedPhase)) {
    throw new Error("Workflow message requires an explicit planning or completed phase");
  }
  const turnMessages = ensureTurnMessages(agentResult);
  const dialogProcessId = String(ctx?.dialogProcessId || "").trim();
  const baseWorkflowPayload =
    workflowPayload && typeof workflowPayload === "object" ? workflowPayload : {};
  const { mergedTransferPayload, attachmentReferenceBlock } = await resolveWorkflowTransferParts({
    workflowPayload,
    baseWorkflowPayload,
    ctx,
    normalizedPhase,
    dialogProcessId,
  });
  const content = composeWorkflowFinalContent({
    semanticText,
    attachmentPathBlock: attachmentReferenceBlock,
  });
  const presentationMessageId = String(
    ctx?.presentationMessageId || resolveWorkflowParentRunConfig(ctx)?.presentationMessageId || "",
  ).trim();
  const messageId = resolveWorkflowMessageId(ctx);
  const runtime = resolveWorkflowRuntimeFromContext(ctx);
  if (typeof runtime?.materializePendingCurrentTurnMessageEvents !== "function") {
    throw new Error("Turn message event materializer is required");
  }
  const messageEventProjection = runtime.materializePendingCurrentTurnMessageEvents({ messageId });
  applyWorkflowTransferPayload(baseWorkflowPayload, mergedTransferPayload);
  const authoritativeWorkflowRunId = resolveAuthoritativeWorkflowRunId(
    workflowRunId,
    baseWorkflowPayload,
    ctx,
  );
  const sessionWorkflowPayload = buildSessionWorkflowPayload(
    baseWorkflowPayload,
    authoritativeWorkflowRunId,
  );
  const workflowMessage = {
    role: "assistant",
    id: messageId,
    messageId,
    type: "workflow",
    chatPresentation: true,
    ...(presentationMessageId ? { presentationMessageId } : {}),
    ...pickNonEmptyTimelines(messageEventProjection),
    content,
    dialogProcessId,
    modelAlias: String(semanticResolution?.model || options?.semanticModel || "").trim(),
    modelName: String(semanticResolution?.model || options?.semanticModel || "").trim(),
    summarized: false,
    ...(mergedTransferPayload.transferEnvelopes.length
      ? { transferEnvelopes: mergedTransferPayload.transferEnvelopes }
      : {}),
    pluginMessage: true,
    pluginMeta: buildWorkflowPluginMeta({
      normalizedPhase,
      semanticResolution,
      sourceText,
      semanticText,
      sessionWorkflowPayload,
    }),
  };
  if (content && messageId) {
    agentResult.output = content;
    agentResult.assistantMessageId = messageId;
  }
  const existing = findExistingWorkflowMessage(turnMessages, dialogProcessId);
  if (existing) {
    Object.assign(existing, workflowMessage);
    return existing;
  }
  turnMessages.push(workflowMessage);
  return workflowMessage;
}

export function appendWorkflowPlanningMessage(payload = {}) {
  return upsertWorkflowMessage({
    ...payload,
    nodeAgentRuns: [],
    phase: "planning",
  });
}

export function publishWorkflowFinalMessage(payload = {}) {
  return upsertWorkflowMessage({
    ...payload,
    phase: "completed",
  });
}
