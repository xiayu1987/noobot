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

function sanitizeArtifactFileNamePart(input = "", fallback = "result") {
  const normalized = String(input || "")
    .trim()
    .replaceAll(/[^a-zA-Z0-9\u4e00-\u9fa5_-]+/g, "-")
    .replaceAll(/^-+|-+$/g, "")
    .slice(0, 80);
  return normalized || fallback;
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
  const output = resolveSubSessionFinalOutput(subSession);
  const cleanOutput = stripHarnessReviewAppendix(output);
  if (!cleanOutput) return normalizeWorkflowTransferPayload();
  const identity = nodeIdentity && typeof nodeIdentity === "object" ? nodeIdentity : {};
  const nodeName = String(
    identity?.nodeName || pendingStep?.nodeName || pendingStep?.nodeId || "workflow-node",
  ).trim();
  const nodeId = String(identity?.nodeId || pendingStep?.nodeId || "").trim();
  const normalizedTransition = Number.isFinite(Number(transition))
    ? Math.floor(Number(transition))
    : 0;
  const artifactName = [
    "workflow-node",
    normalizedTransition > 0 ? String(normalizedTransition) : "",
    sanitizeArtifactFileNamePart(nodeName, "node"),
    "result.md",
  ]
    .filter(Boolean)
    .join("-");
  const body = [
    tWorkflow(locale, WORKFLOW_I18N_KEYSET.PERSISTENCE.NODE_RESULT_TITLE),
    "",
    tWorkflow(locale, WORKFLOW_I18N_KEYSET.PERSISTENCE.NODE_LINE, {
      name: nodeName || tWorkflow(locale, WORKFLOW_I18N_KEYSET.PERSISTENCE.NODE_UNNAMED_FALLBACK),
    }),
    tWorkflow(locale, WORKFLOW_I18N_KEYSET.PERSISTENCE.NODE_ID_LINE, { id: nodeId || "-" }),
    tWorkflow(locale, WORKFLOW_I18N_KEYSET.PERSISTENCE.SUB_SESSION_LINE, {
      id: String(subSession?.sessionId || "").trim() || "-",
    }),
    tWorkflow(locale, WORKFLOW_I18N_KEYSET.PERSISTENCE.DIALOG_LINE, {
      id: String(subSession?.dialogProcessId || "").trim() || "-",
    }),
    "",
    tWorkflow(locale, WORKFLOW_I18N_KEYSET.PERSISTENCE.FINAL_OUTPUT_TITLE),
    "",
    cleanOutput,
    "",
  ].join("\n");
  const artifact = {
    name: artifactName,
    mimeType: "text/markdown",
    contentBase64: Buffer.from(body, "utf8").toString("base64"),
  };
  const runtime = resolveWorkflowRuntimeFromContext(ctx);
  const semanticTransferContent = runtime?.sharedTools?.semanticTransfer?.transferSemanticContent;
  if (typeof semanticTransferContent !== "function") {
    throw new Error("Semantic transfer service is required for workflow node results");
  }
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
        meta: {
          transition: normalizedTransition,
          workflowRunId: String(identity?.workflowRunId || "").trim(),
          nodeExecutionId: String(identity?.nodeExecutionId || "").trim(),
          commandId: String(identity?.commandId || "").trim(),
          dialogProcessId: String(
            identity?.dialogProcessId || subSession?.dialogProcessId || "",
          ).trim(),
          turnScopeId: String(identity?.turnScopeId || "").trim(),
          nodeSessionId: String(subSession?.sessionId || "").trim(),
        },
      },
    ],
    nextSteps: [],
    forceAttachment: true,
    attachmentSource: ATTACHMENT_SOURCE.MODEL,
    generationSource: "workflow_node_agent_result",
    source: TRANSFER_SOURCE.PLUGIN,
    reason: TRANSFER_REASON.WORKFLOW_NODE_AGENT_RESULT,
    producer: { type: "plugin", id: `workflow-node:${nodeId}` },
    mimeType: artifact.mimeType,
  });
  const transferPayload = normalizeWorkflowTransferPayload(transferred);
  if (!transferPayload.transferEnvelopes.length) {
    throw new Error("Workflow node result transfer produced no V2 envelope");
  }
  if (subSession.result && typeof subSession.result === "object") {
    applyWorkflowTransferPayload(subSession.result, transferPayload);
    if (Array.isArray(subSession.result.messages) && subSession.result.messages.length) {
      const lastIndex = subSession.result.messages.length - 1;
      const lastMessage = subSession.result.messages[lastIndex] || {};
      subSession.result.messages[lastIndex] = applyWorkflowTransferPayload(
        {
          ...lastMessage,
        },
        transferPayload,
      );
    }
  }
  return transferPayload;
}

const WORKFLOW_MESSAGE_PHASES = Object.freeze(new Set(["planning", "completed"]));

async function transferWorkflowFinalAttachment({
  transferReferenceBlock = "",
  normalizedPhase = "",
  dialogProcessId = "",
  ctx = {},
} = {}) {
  const runtime = resolveWorkflowRuntimeFromContext(ctx);
  const semanticTransferContent = runtime?.sharedTools?.semanticTransfer?.transferSemanticContent;
  if (typeof semanticTransferContent !== "function") {
    throw new Error("Semantic transfer service is required for workflow final attachment summary");
  }
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
    (transferReferenceBlock
      ? buildWorkflowTransferReferenceBlock(composedTransferPayload, ctx)
      : buildWorkflowTransferReferenceBlock(mergedTransferPayload, ctx)) || "";
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
  const messageEventProjection = runtime.materializePendingCurrentTurnMessageEvents();
  applyWorkflowTransferPayload(baseWorkflowPayload, mergedTransferPayload);
  const authoritativeWorkflowRunId = String(
    workflowRunId ||
      baseWorkflowPayload?.workflowRunId ||
      baseWorkflowPayload?.execution?.workflowRunId ||
      baseWorkflowPayload?.execution?.instanceId ||
      ctx?.workflowRunId ||
      "",
  ).trim();
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
    ...(Array.isArray(messageEventProjection.activityTimeline) &&
    messageEventProjection.activityTimeline.length
      ? { activityTimeline: messageEventProjection.activityTimeline }
      : {}),
    ...(Array.isArray(messageEventProjection.toolTimeline) &&
    messageEventProjection.toolTimeline.length
      ? { toolTimeline: messageEventProjection.toolTimeline }
      : {}),
    content,
    dialogProcessId,
    modelAlias: String(semanticResolution?.model || options?.semanticModel || "").trim(),
    modelName: String(semanticResolution?.model || options?.semanticModel || "").trim(),
    summarized: false,
    ...(mergedTransferPayload.transferEnvelopes.length
      ? { transferEnvelopes: mergedTransferPayload.transferEnvelopes }
      : {}),
    pluginMessage: true,
    pluginMeta: {
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
    },
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
