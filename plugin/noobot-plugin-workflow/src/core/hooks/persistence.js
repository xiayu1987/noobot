/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import {
  applyWorkflowTransferPayload,
  buildWorkflowTransferPayloadFromAttachments,
  normalizeWorkflowTransferPayload,
  resolveAttachmentDisplayPath,
  resolveWorkflowAttachments,
  resolveWorkflowAttachmentsFromTransferPayload,
  resolveWorkflowTransferFileDisplayPath,
  resolveWorkflowTransferFilesFromPayload,
} from "./attachments.js";
import { resolveWorkflowParentRunConfig, resolveWorkflowRuntimeFromContext } from "./runtime.js";
import { resolveWorkflowLocaleFromContext, tWorkflow, WORKFLOW_I18N_KEYSET } from "../i18n.js";
import { LENGTH_THRESHOLDS } from "@noobot/shared/length-thresholds";

export function ensureTurnMessages(agentResult = {}) {
  const turnMessages = Array.isArray(agentResult?.turnMessages) ? agentResult.turnMessages : [];
  agentResult.turnMessages = turnMessages;
  return turnMessages;
}

export function sanitizeArtifactFileNamePart(input = "", fallback = "result") {
  const normalized = String(input || "")
    .trim()
    .replaceAll(/[^a-zA-Z0-9\u4e00-\u9fa5_-]+/g, "-")
    .replaceAll(/^-+|-+$/g, "")
    .slice(0, 80);
  return normalized || fallback;
}

export function resolveSubSessionFinalOutput(subSession = {}) {
  const result = subSession?.result && typeof subSession.result === "object" ? subSession.result : {};
  const messages = Array.isArray(result?.messages) ? result.messages : [];
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const messageItem = messages[index] || {};
    const role = String(messageItem?.role || "").trim().toLowerCase();
    if (role && role !== "assistant") continue;
    const content = String(messageItem?.content || "").trim();
    if (content) return content;
  }
  const direct = String(result?.answer || result?.output || "").trim();
  if (direct) return direct;
  return "";
}

export function stripHarnessReviewAppendix(text = "") {
  const raw = String(text || "").trim();
  if (!raw) return "";
  const markerIndex = raw.search(/(?:^|\n)\s*\[Harness-Review\]\s*(?:\n|$)/);
  if (markerIndex < 0) return raw;
  return raw.slice(0, markerIndex).trim();
}

export function buildWorkflowAttachmentPathBlockWithContext(attachments = [], ctx = {}) {
  const locale = resolveWorkflowLocaleFromContext(ctx);
  const lines = (Array.isArray(attachments) ? attachments : [])
    .map((item = {}, index) => {
      const label = String(
        item?.name || tWorkflow(locale, WORKFLOW_I18N_KEYSET.ATTACHMENT.DEFAULT_LABEL, { index: index + 1 }),
      ).trim();
      const path = resolveAttachmentDisplayPath(item, ctx);
      if (!path) return "";
      return `- ${label}: ${path}`;
    })
    .filter(Boolean);
  if (!lines.length) return "";
  return ["", tWorkflow(locale, WORKFLOW_I18N_KEYSET.PERSISTENCE.NODE_RESULT_ATTACHMENT_TITLE), "", ...lines].join("\n");
}

export function buildWorkflowTransferPathBlockWithContext(workflowPayload = null, ctx = {}) {
  const locale = resolveWorkflowLocaleFromContext(ctx);
  const files = resolveWorkflowTransferFilesFromPayload(
    workflowPayload && typeof workflowPayload === "object" ? workflowPayload : {},
    ctx,
  );
  const lines = files
    .map((item = {}, index) => {
      const meta = item?.attachmentMeta || {};
      const label = String(
          item?.name ||
          meta?.name ||
          tWorkflow(locale, WORKFLOW_I18N_KEYSET.ATTACHMENT.DEFAULT_LABEL, { index: index + 1 }),
      ).trim();
      const path = resolveWorkflowTransferFileDisplayPath(item, ctx);
      if (!path) return "";
      return `- ${label}: ${path}`;
    })
    .filter(Boolean);
  if (!lines.length) return "";
  return ["", tWorkflow(locale, WORKFLOW_I18N_KEYSET.PERSISTENCE.NODE_RESULT_ATTACHMENT_TITLE), "", ...lines].join("\n");
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

export function composeWorkflowFinalContent({
  semanticText = "",
  attachmentPathBlock = "",
} = {}) {
  return [semanticText, attachmentPathBlock]
    .map((item) => String(item || "").trim())
    .filter(Boolean)
    .join("\n\n");
}

export function sanitizeWorkflowPayloadForSessionMessage(workflowPayload = null) {
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
  const persister = typeof options?.generatedArtifactPersister === "function"
    ? options.generatedArtifactPersister
    : null;
  if (!persister || !subSession) return [];
  const output = resolveSubSessionFinalOutput(subSession);
  const cleanOutput = stripHarnessReviewAppendix(output);
  if (!cleanOutput) return [];
  const userId = String(ctx?.userId || "").trim();
  const sessionId = String(ctx?.sessionId || "").trim();
  if (!userId || !sessionId) return [];
  const identity = nodeIdentity && typeof nodeIdentity === "object" ? nodeIdentity : {};
  const nodeName = String(identity?.nodeName || pendingStep?.nodeName || pendingStep?.nodeId || "workflow-node").trim();
  const nodeId = String(identity?.nodeId || pendingStep?.nodeId || "").trim();
  const normalizedTransition = Number.isFinite(Number(transition)) ? Math.floor(Number(transition)) : 0;
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
  try {
    const artifact = {
      name: artifactName,
      mimeType: "text/markdown",
      contentBase64: Buffer.from(body, "utf8").toString("base64"),
    };
    const runtime = resolveWorkflowRuntimeFromContext(ctx);
    const semanticTransferContent =
      runtime?.sharedTools?.semanticTransfer?.transferSemanticContent;
    let attachments = [];
    let transferPayload = normalizeWorkflowTransferPayload();
    if (typeof semanticTransferContent === "function") {
      const transferred = await semanticTransferContent({
        scenario: "bot_plugin",
        strategy: "bot_plugin_subagent_result",
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
              dialogProcessId: String(identity?.dialogProcessId || subSession?.dialogProcessId || "").trim(),
              turnScopeId: String(identity?.turnScopeId || "").trim(),
              nodeSessionId: String(subSession?.sessionId || "").trim(),
            },
          },
        ],
        nextSteps: [],
        forceAttachment: true,
        attachmentSource: "model",
        generationSource: "workflow_node_agent_result",
        source: "plugin",
        reason: "workflow_node_agent_result",
        mimeType: artifact.mimeType,
      });
      transferPayload = normalizeWorkflowTransferPayload(transferred);
      attachments = resolveWorkflowAttachmentsFromTransferPayload(transferPayload, ctx);
    } else {
      attachments = await persister({
        userId,
        sessionId,
        attachmentSource: "model",
        generationSource: "workflow_node_agent_result",
        fallbackMimeType: "text/markdown",
        artifacts: [artifact],
      });
      transferPayload = buildWorkflowTransferPayloadFromAttachments(attachments);
    }
    const metas = Array.isArray(attachments) ? attachments : [];
    if (!metas.length) return [];
    if (subSession.result && typeof subSession.result === "object") {
      applyWorkflowTransferPayload(subSession.result, transferPayload);
      if (Array.isArray(subSession.result.messages) && subSession.result.messages.length) {
        const lastIndex = subSession.result.messages.length - 1;
        const lastMessage = subSession.result.messages[lastIndex] || {};
        subSession.result.messages[lastIndex] = applyWorkflowTransferPayload({
          ...lastMessage,
        }, transferPayload);
      }
    }
    return metas;
  } catch {
    return [];
  }
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
  attachments = [],
  nodeAgentRuns = [],
  phase = "",
} = {}) {
  const normalizedPhase = String(phase || "").trim();
  if (!new Set(["planning", "completed"]).has(normalizedPhase)) {
    throw new Error("Workflow message requires an explicit planning or completed phase");
  }
  const turnMessages = ensureTurnMessages(agentResult);
  const dialogProcessId = String(ctx?.dialogProcessId || "").trim();
  const baseWorkflowPayload = workflowPayload && typeof workflowPayload === "object"
    ? workflowPayload
    : {};
  const baseTransferPayload = normalizeWorkflowTransferPayload(baseWorkflowPayload);
  let composedTransferPayload = normalizeWorkflowTransferPayload();
  const transferPathBlock = buildWorkflowTransferPathBlockWithContext(workflowPayload, ctx);
  let finalTransferAttempted = false;
  if (transferPathBlock) {
    const runtime = resolveWorkflowRuntimeFromContext(ctx);
    const semanticTransferContent = runtime?.sharedTools?.semanticTransfer?.transferSemanticContent;
    if (typeof semanticTransferContent === "function") {
      finalTransferAttempted = true;
      try {
        const transferred = await semanticTransferContent({
          scenario: "bot_plugin",
          strategy: "bot_plugin_final_return",
          messages: [
            {
              id: "workflow-final-attachment-summary",
              nodeId: "workflow-final",
              nodeName: "workflow-final-attachment-summary",
              content: transferPathBlock,
              meta: {
                phase: normalizedPhase,
                dialogProcessId,
                sessionId: String(ctx?.sessionId || "").trim(),
              },
            },
          ],
          nextSteps: [],
          forceAttachment: true,
          attachmentSource: "model",
          generationSource: `workflow_${normalizedPhase}_attachment_summary`,
          source: "plugin",
          reason: `workflow_${normalizedPhase}_attachment_summary`,
          mimeType: "text/markdown",
        });
        composedTransferPayload = normalizeWorkflowTransferPayload(transferred);
      } catch {
        composedTransferPayload = normalizeWorkflowTransferPayload();
      }
    }
  }
  const mergedTransferPayload = normalizeWorkflowTransferPayload({
    transferEnvelopes: [
      ...(Array.isArray(baseTransferPayload.transferEnvelopes) ? baseTransferPayload.transferEnvelopes : []),
      ...(Array.isArray(composedTransferPayload.transferEnvelopes)
        ? composedTransferPayload.transferEnvelopes
        : []),
    ],
  });
  const resolvedAttachments = resolveWorkflowAttachments({
    workflowPayload: mergedTransferPayload,
    attachments,
    ctx,
  });
  const attachmentPathBlock =
    buildWorkflowTransferPathBlockWithContext(composedTransferPayload, ctx) ||
    (finalTransferAttempted
      ? ""
      : buildWorkflowTransferPathBlockWithContext(mergedTransferPayload, ctx) ||
        (composedTransferPayload.transferEnvelopes.length
          ? ""
          : buildWorkflowAttachmentPathBlockWithContext(resolvedAttachments, ctx)));
  const content = composeWorkflowFinalContent({
    semanticText,
    attachmentPathBlock,
  });
  const presentationMessageId = String(
    ctx?.presentationMessageId ||
      resolveWorkflowParentRunConfig(ctx)?.presentationMessageId ||
      "",
  ).trim();
  const messageId = String(
    ctx?.messageId ||
      ctx?.runConfig?.messageId ||
      resolveWorkflowParentRunConfig(ctx)?.messageId ||
      "",
  ).trim();
  if (!messageId) {
    throw new Error("Workflow final message requires canonical messageId");
  }
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
  const sessionWorkflowPayload = sanitizeWorkflowPayloadForSessionMessage(baseWorkflowPayload) || {};
  if (authoritativeWorkflowRunId) {
    sessionWorkflowPayload.workflowRunId = authoritativeWorkflowRunId;
    sessionWorkflowPayload.execution = {
      ...(sessionWorkflowPayload.execution || {}),
      workflowRunId: authoritativeWorkflowRunId,
      instanceId: authoritativeWorkflowRunId,
    };
  }
  const workflowMessage = {
    role: "assistant",
    id: messageId,
    messageId,
    type: "workflow",
    chatPresentation: true,
    ...(presentationMessageId ? { presentationMessageId } : {}),
    ...(Array.isArray(messageEventProjection.activityTimeline) && messageEventProjection.activityTimeline.length
      ? { activityTimeline: messageEventProjection.activityTimeline }
      : {}),
    ...(Array.isArray(messageEventProjection.toolTimeline) && messageEventProjection.toolTimeline.length
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
    ...(resolvedAttachments.length ? { attachments: resolvedAttachments } : {}),
    pluginMessage: true,
    pluginMeta: {
      source: "workflow-plugin",
      kind: "workflow",
      phase: normalizedPhase,
      semanticInvokerUsed: semanticResolution?.invoked === true,
      sourceTextPreview: String(sourceText || "").slice(0, LENGTH_THRESHOLDS.contextPreview.workflowPayloadPreviewChars),
      semanticTextPreview: String(semanticText || "").slice(0, LENGTH_THRESHOLDS.contextPreview.workflowSemanticTextPreviewChars),
      payload: sessionWorkflowPayload,
    },
  };
  if (content && messageId) {
    agentResult.output = content;
    agentResult.assistantMessageId = messageId;
  }
  const existing = turnMessages.find((messageItem = {}) => {
    if (messageItem?.pluginMessage !== true) return false;
    if (String(messageItem?.dialogProcessId || "").trim() !== dialogProcessId) return false;
    const meta = messageItem?.pluginMeta && typeof messageItem.pluginMeta === "object"
      ? messageItem.pluginMeta
      : {};
    return String(meta?.source || "").trim() === "workflow-plugin";
  });
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

export function buildWorkflowDialogRelativeDir({
  ctx = {},
  dialogProcessId = "",
  scope = "auto",
} = {}) {
  const sessionId = String(ctx?.sessionId || "").trim();
  const resolvedDialogProcessId = String(dialogProcessId || ctx?.dialogProcessId || "").trim();
  if (!sessionId || !resolvedDialogProcessId) return "";
  const normalizedScope = String(scope || "auto").trim().toLowerCase();
  if (normalizedScope === "planning") {
    return `runtime/workflow/planning/${sessionId}/${resolvedDialogProcessId}`;
  }
  if (normalizedScope === "node") {
    return `runtime/workflow/session/${sessionId}/${resolvedDialogProcessId}`;
  }
  const isNodeDialog = resolvedDialogProcessId.startsWith("wf_node_");
  return isNodeDialog
    ? `runtime/workflow/session/${sessionId}/${resolvedDialogProcessId}`
    : `runtime/workflow/planning/${sessionId}/${resolvedDialogProcessId}`;
}

export async function emitWorkflowRuntimeEvent({
  options = {},
  ctx = {},
  dialogProcessId = "",
  event = "",
  level = "info",
  data = {},
} = {}) {
  if (typeof options?.workflowEventLogger !== "function") return null;
  const userId = String(ctx?.userId || "").trim();
  if (!userId) return null;
  const resolvedDialogProcessId = String(dialogProcessId || ctx?.dialogProcessId || "").trim();
  const relativeDir = buildWorkflowDialogRelativeDir({
    ctx,
    dialogProcessId: resolvedDialogProcessId,
  });
  if (!relativeDir) return null;
  try {
    return await options.workflowEventLogger({
      userId,
      relativeDir,
      fileName: "events.jsonl",
      event: {
        source: "workflow-plugin",
        level: String(level || "info").trim(),
        event: String(event || "").trim(),
        sessionId: String(ctx?.sessionId || "").trim(),
        dialogProcessId: resolvedDialogProcessId,
        ...(data && typeof data === "object" ? data : {}),
      },
    });
  } catch {
    return null;
  }
}

export async function persistWorkflowPlanningDialog({
  options = {},
  ctx = {},
  sourceText = "",
  semanticText = "",
  semantic = null,
  semanticResolution = {},
  workflowRunId = "",
  planningNodeSessions = [],
} = {}) {
  if (typeof options?.workflowDialogPersister !== "function") return null;
  const userId = String(ctx?.userId || "").trim();
  if (!userId) return null;
  const relativeDir = buildWorkflowDialogRelativeDir({
    ctx,
    dialogProcessId: String(ctx?.dialogProcessId || "").trim(),
    scope: "planning",
  });
  if (!relativeDir) return null;
  try {
    return await options.workflowDialogPersister({
      userId,
      relativeDir,
      fileName: "planning.json",
      payload: {
        scope: "workflow_planning",
        userId,
        sessionId: String(ctx?.sessionId || "").trim(),
        dialogProcessId: String(ctx?.dialogProcessId || "").trim(),
        workflowRunId: String(workflowRunId || "").trim(),
        revision: 1,
        sequence: 1,
        timestamp: new Date().toISOString(),
        sourceText,
        semanticText,
        semantic,
        nodeSessions: Array.isArray(planningNodeSessions) ? planningNodeSessions : [],
        semanticModel: String(options?.semanticModel || "").trim(),
        semanticPrompt: String(options?.semanticPrompt || "").trim(),
        semanticResolution: {
          invoked: semanticResolution?.invoked === true,
          traceCount: Number(semanticResolution?.traceCount || 0),
          requestMessages: Array.isArray(semanticResolution?.requestMessages)
            ? semanticResolution.requestMessages
            : [],
        },
      },
    });
  } catch {
    return null;
  }
}
