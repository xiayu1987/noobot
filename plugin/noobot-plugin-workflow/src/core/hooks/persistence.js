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
import { resolveWorkflowRuntimeFromContext } from "./runtime.js";
import { resolveWorkflowRunIdentity } from "../workflow-run-identity.js";
import { resolveWorkflowLocaleFromContext, tWorkflow, WORKFLOW_I18N_KEYSET } from "../i18n.js";
import { LENGTH_THRESHOLDS } from "@noobot/shared/length-thresholds";
import { ATTACHMENT_SOURCE } from "@noobot/attachment-protocol/identity";
import {
  TRANSFER_REASON,
  TRANSFER_SOURCE,
  mergeTransferEnvelopes,
} from "@noobot/semantic-transfer-protocol";
import { requirePluginMessagePayload } from "@noobot/plugin-protocol/plugin-message-payload";
import { text, isFunction, isObjectLike } from "@noobot/shared/value";
import { createMessageUid, createModelMessageId } from "@noobot/session-protocol/message-identity";

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
    const role = text(messageItem?.role).toLowerCase();
    if (role && role !== "assistant") continue;
    const content = text(messageItem?.content);
    if (content) return content;
  }
  return "";
}

export function resolveSubSessionFinalOutput(subSession = {}) {
  const result = resolveSubSessionResult(subSession);
  const messages = Array.isArray(result?.messages) ? result.messages : [];
  const lastAssistantContent = findLastAssistantContent(messages);
  if (lastAssistantContent) return lastAssistantContent;
  return text(result?.answer);
}

export function stripHarnessReviewAppendix(inputText = "") {
  const raw = text(inputText);
  if (!raw) return "";
  const markerIndex = raw.search(/(?:^|\n)\s*\[Harness-Review\]\s*(?:\n|$)/);
  if (markerIndex < 0) return raw;
  return raw.slice(0, markerIndex).trim();
}

function buildWorkflowTransferReferenceBlock(transferPayload, ctx) {
  const locale = resolveWorkflowLocaleFromContext(ctx);
  const references = resolveWorkflowTransferAttachmentReferences(transferPayload);
  const lines = references
    .map((item = {}, index) => {
      const label =
        text(item?.name) ||
        tWorkflow(locale, WORKFLOW_I18N_KEYSET.INPUT.DEFAULT_LABEL, { index: index + 1 });
      const attachmentId = text(item?.identity?.attachmentId);
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
  rawText = "",
  maxLength = LENGTH_THRESHOLDS.contextPreview.workflowResultTextChars,
) {
  const raw = text(rawText);
  const fallback = LENGTH_THRESHOLDS.contextPreview.workflowResultTextChars;
  const limit = Number.isFinite(Number(maxLength)) ? Math.max(200, Number(maxLength)) : fallback;
  if (raw.length <= limit) return raw;
  return `${raw.slice(0, limit).trim()}\n\n...`;
}

function composeWorkflowFinalContent({ semanticText = "", attachmentPathBlock = "" } = {}) {
  return [semanticText, attachmentPathBlock]
    .map((item) => text(item))
    .filter(Boolean)
    .join("\n\n");
}

function resolveNodeResultIdentity({ nodeIdentity, transition }) {
  const identity = nodeIdentity;
  const numericTransition = Number(transition);
  return {
    identity,
    nodeName: text(identity.nodeName),
    nodeId: text(identity.nodeId),
    normalizedTransition: Number.isFinite(numericTransition) ? Math.floor(numericTransition) : 0,
  };
}

function buildNodeResultBody({ locale, nodeName, nodeId, subSession, cleanOutput }) {
  const keys = WORKFLOW_I18N_KEYSET.PERSISTENCE;
  return [
    tWorkflow(locale, keys.NODE_RESULT_TITLE),
    "",
    tWorkflow(locale, keys.NODE_LINE, {
      name: nodeName,
    }),
    tWorkflow(locale, keys.NODE_ID_LINE, { id: nodeId }),
    tWorkflow(locale, keys.SUB_SESSION_LINE, { id: text(subSession.sessionId) || "-" }),
    tWorkflow(locale, keys.DIALOG_LINE, { id: text(subSession.dialogProcessId) || "-" }),
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
    workflowRunId: text(identity.workflowRunId),
    nodeExecutionId: text(identity.nodeExecutionId),
    commandId: text(identity.commandId),
    dialogProcessId: text(identity.dialogProcessId),
    turnScopeId: text(identity.turnScopeId),
    nodeSessionId: text(subSession.sessionId),
  };
}

function requireSemanticTransferContent(ctx, purpose) {
  const runtime = resolveWorkflowRuntimeFromContext(ctx);
  const semanticTransferContent = runtime?.sharedTools?.semanticTransfer?.transferSemanticContent;
  if (!isFunction(semanticTransferContent)) {
    throw new Error(`Semantic transfer service is required for ${purpose}`);
  }
  return semanticTransferContent;
}

function applyNodeResultTransfer(subSession, transferPayload) {
  const result = subSession.result;
  if (!isObjectLike(result)) return;
  applyWorkflowTransferPayload(result, transferPayload);
  if (!Array.isArray(result.messages) || !result.messages.length) return;
  const lastIndex = result.messages.length - 1;
  result.messages[lastIndex] = applyWorkflowTransferPayload(
    { ...(result.messages[lastIndex] || {}) },
    transferPayload,
  );
}

export async function persistWorkflowNodeResultAttachment({
  ctx = {},
  subSession = null,
  transition = 0,
  nodeIdentity = null,
} = {}) {
  const locale = resolveWorkflowLocaleFromContext(ctx);
  if (!subSession) return normalizeWorkflowTransferPayload();
  const cleanOutput = stripHarnessReviewAppendix(resolveSubSessionFinalOutput(subSession));
  if (!cleanOutput) return normalizeWorkflowTransferPayload();
  const { identity, nodeName, nodeId, normalizedTransition } = resolveNodeResultIdentity({
    nodeIdentity,
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
        id: nodeId,
        nodeId,
        nodeName,
        content: body,
        meta: buildNodeResultTransferMeta({ identity, subSession, normalizedTransition }),
      },
    ],
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
          sessionId: ctx.sessionId,
        },
      },
    ],
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

function findExistingWorkflowMessage(turnMessages = [], dialogProcessId = "") {
  return turnMessages.find((messageItem = {}) => {
    if (messageItem?.pluginMessage !== true) return false;
    if (text(messageItem?.dialogProcessId) !== dialogProcessId) return false;
    const meta =
      messageItem?.pluginMeta && typeof messageItem.pluginMeta === "object"
        ? messageItem.pluginMeta
        : {};
    return text(meta?.source) === "workflow-plugin";
  });
}

function resolveWorkflowMessageIdentity(existing = null) {
  if (!existing) return { modelMessageId: createModelMessageId(), messageUid: createMessageUid() };
  const modelMessageId = text(existing.modelMessageId);
  if (!modelMessageId)
    throw new Error("Existing workflow message requires a journal modelMessageId");
  const messageUid = text(existing.messageUid);
  if (!messageUid) throw new Error("Existing workflow message requires a messageUid");
  return { modelMessageId, messageUid };
}

async function resolveWorkflowTransferParts({
  nodeTransferEnvelopes,
  ctx,
  normalizedPhase,
  dialogProcessId,
}) {
  if (!Array.isArray(nodeTransferEnvelopes)) {
    throw new Error("Workflow message requires explicit node transfer envelopes");
  }
  const nodeTransferPayload = { transferEnvelopes: mergeTransferEnvelopes(nodeTransferEnvelopes) };
  const transferReferenceBlock = buildWorkflowTransferReferenceBlock(nodeTransferPayload, ctx);
  if (!transferReferenceBlock) {
    return {
      transferEnvelopes: nodeTransferPayload.transferEnvelopes,
      attachmentReferenceBlock: "",
    };
  }
  const composedTransferPayload = await transferWorkflowFinalAttachment({
    transferReferenceBlock,
    normalizedPhase,
    dialogProcessId,
    ctx,
  });
  return {
    transferEnvelopes: mergeTransferEnvelopes(
      nodeTransferPayload.transferEnvelopes,
      composedTransferPayload.transferEnvelopes,
    ),
    attachmentReferenceBlock: buildWorkflowTransferReferenceBlock(composedTransferPayload, ctx),
  };
}

function pickNonEmptyTimelines(messageEventProjection) {
  const timelines = {};
  for (const key of ["activityTimeline", "toolTimeline"]) {
    const timeline = messageEventProjection[key];
    if (timeline.length) timelines[key] = timeline;
  }
  return timelines;
}

function buildWorkflowPluginMeta({ normalizedPhase, workflowPayload }) {
  return {
    source: "workflow-plugin",
    kind: "workflow",
    phase: normalizedPhase,
    payload: requirePluginMessagePayload(workflowPayload),
  };
}

async function upsertWorkflowMessage({
  options,
  agentResult,
  ctx,
  semanticText,
  workflowPayload,
  nodeTransferEnvelopes,
  phase,
}) {
  const normalizedPhase = text(phase);
  if (!WORKFLOW_MESSAGE_PHASES.has(normalizedPhase)) {
    throw new Error("Workflow message requires an explicit planning or completed phase");
  }
  const turnMessages = ensureTurnMessages(agentResult);
  const dialogProcessId = ctx.dialogProcessId;
  const { transferEnvelopes, attachmentReferenceBlock } = await resolveWorkflowTransferParts({
    nodeTransferEnvelopes,
    ctx,
    normalizedPhase,
    dialogProcessId,
  });
  const content = composeWorkflowFinalContent({
    semanticText,
    attachmentPathBlock: attachmentReferenceBlock,
  });
  const { presentationMessageId } = resolveWorkflowRunIdentity(ctx);
  const runtime = resolveWorkflowRuntimeFromContext(ctx);
  if (!isFunction(runtime?.materializeUnownedCurrentTurnMessageEvents)) {
    throw new Error("Turn message event materializer is required");
  }
  const messageEventProjection = runtime.materializeUnownedCurrentTurnMessageEvents();
  const existing = findExistingWorkflowMessage(turnMessages, dialogProcessId);

  const { modelMessageId, messageUid } = resolveWorkflowMessageIdentity(existing);
  const workflowMessage = {
    role: "assistant",
    messageUid,
    modelMessageId,
    type: "workflow",
    chatPresentation: true,
    presentationMessageId,
    ...pickNonEmptyTimelines(messageEventProjection),
    content,
    dialogProcessId,
    modelAlias: text(options.semanticModel),
    modelName: text(options.semanticModel),
    summarized: false,
    ...(transferEnvelopes.length ? { transferEnvelopes } : {}),
    pluginMessage: true,
    pluginMeta: buildWorkflowPluginMeta({ normalizedPhase, workflowPayload }),
  };
  if (content) {
    agentResult.output = content;
    agentResult.modelMessageId = modelMessageId;
  }
  if (existing) {
    Object.assign(existing, workflowMessage);
    return existing;
  }
  turnMessages.push(workflowMessage);
  return workflowMessage;
}

export function appendWorkflowPlanningMessage(payload) {
  return upsertWorkflowMessage({
    ...payload,
    phase: "planning",
  });
}

export function publishWorkflowFinalMessage(payload) {
  return upsertWorkflowMessage({
    ...payload,
    phase: "completed",
  });
}
