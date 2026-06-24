/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import {
  applyWorkflowTransferPayload,
  buildWorkflowTransferPayloadFromAttachmentMetas,
  normalizeWorkflowTransferPayload,
  resolveAttachmentDisplayPath,
  resolveWorkflowAttachmentMetasFromTransferPayload,
  resolveWorkflowCompatAttachmentMetas,
  resolveWorkflowTransferFileDisplayPath,
  resolveWorkflowTransferFilesFromPayload,
} from "./attachments.js";
import { resolveWorkflowRuntimeFromContext } from "./runtime.js";
import { resolveWorkflowLocaleFromContext, tWorkflow, WORKFLOW_I18N_KEYSET } from "../i18n.js";

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

export function buildWorkflowAttachmentPathBlockWithContext(attachmentMetas = [], ctx = {}) {
  const locale = resolveWorkflowLocaleFromContext(ctx);
  const lines = (Array.isArray(attachmentMetas) ? attachmentMetas : [])
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

export function truncateWorkflowResultText(text = "", maxLength = 1800) {
  const raw = String(text || "").trim();
  const limit = Number.isFinite(Number(maxLength)) ? Math.max(200, Number(maxLength)) : 1800;
  if (raw.length <= limit) return raw;
  return `${raw.slice(0, limit).trim()}\n\n...`;
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
    // Keep sub-agent execution body out of the parent session; preserve only attachment meta and session linkage.
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
  const nodeName = String(pendingStep?.nodeName || pendingStep?.nodeId || "workflow-node").trim();
  const nodeId = String(pendingStep?.nodeId || "").trim();
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
    let attachmentMetas = [];
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
      attachmentMetas = resolveWorkflowAttachmentMetasFromTransferPayload(transferPayload, ctx);
    } else {
      attachmentMetas = await persister({
        userId,
        sessionId,
        attachmentSource: "model",
        generationSource: "workflow_node_agent_result",
        fallbackMimeType: "text/markdown",
        artifacts: [artifact],
      });
      transferPayload = buildWorkflowTransferPayloadFromAttachmentMetas(attachmentMetas);
    }
    const metas = Array.isArray(attachmentMetas) ? attachmentMetas : [];
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

export async function appendWorkflowPlanningMessage({
  options = {},
  agentResult = {},
  ctx = {},
  sourceText = "",
  semanticText = "",
  semanticResolution = {},
  workflowPayload = null,
  attachmentMetas = [],
} = {}) {
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
                phase: "planning",
                dialogProcessId,
                sessionId: String(ctx?.sessionId || "").trim(),
              },
            },
          ],
          nextSteps: [],
          forceAttachment: true,
          attachmentSource: "model",
          generationSource: "workflow_planning_final_attachment_summary",
          source: "plugin",
          reason: "workflow_planning_final_attachment_summary",
          mimeType: "text/markdown",
        });
        composedTransferPayload = normalizeWorkflowTransferPayload(transferred);
      } catch {
        composedTransferPayload = normalizeWorkflowTransferPayload();
      }
    }
  }
  const mergedTransferPayload = normalizeWorkflowTransferPayload({
    transferResult: composedTransferPayload.transferResult || baseTransferPayload.transferResult || null,
    transferEnvelopes: [
      ...(Array.isArray(baseTransferPayload.transferEnvelopes) ? baseTransferPayload.transferEnvelopes : []),
      ...(Array.isArray(composedTransferPayload.transferEnvelopes)
        ? composedTransferPayload.transferEnvelopes
        : []),
    ],
  });
  const compatAttachmentMetas = resolveWorkflowCompatAttachmentMetas({
    workflowPayload: mergedTransferPayload,
    attachmentMetas,
    ctx,
  });
  const attachmentPathBlock =
    buildWorkflowTransferPathBlockWithContext(composedTransferPayload, ctx) ||
    (finalTransferAttempted
      ? ""
      : buildWorkflowTransferPathBlockWithContext(mergedTransferPayload, ctx) ||
        (composedTransferPayload.transferEnvelopes.length
          ? ""
          : buildWorkflowAttachmentPathBlockWithContext(compatAttachmentMetas, ctx)));
  const content = [semanticText || sourceText || "", attachmentPathBlock]
    .map((item) => String(item || "").trim())
    .filter(Boolean)
    .join("\n\n");
  applyWorkflowTransferPayload(baseWorkflowPayload, mergedTransferPayload);
  const sessionWorkflowPayload = sanitizeWorkflowPayloadForSessionMessage(baseWorkflowPayload);
  const workflowMessage = {
    role: "assistant",
    type: "workflow",
    content,
    dialogProcessId,
    modelAlias: String(semanticResolution?.model || options?.semanticModel || "").trim(),
    modelName: String(semanticResolution?.model || options?.semanticModel || "").trim(),
    summarized: false,
    ...(mergedTransferPayload.transferResult ? { transferResult: mergedTransferPayload.transferResult } : {}),
    ...(mergedTransferPayload.transferEnvelopes.length
      ? { transferEnvelopes: mergedTransferPayload.transferEnvelopes }
      : {}),
    pluginMessage: true,
    pluginMeta: {
      source: "workflow-plugin",
      kind: "workflow",
      phase: "planning",
      semanticInvokerUsed: semanticResolution?.invoked === true,
      sourceTextPreview: String(sourceText || "").slice(0, 800),
      semanticTextPreview: String(semanticText || "").slice(0, 2000),
      payload: sessionWorkflowPayload,
    },
  };
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
  semanticResolution = {},
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
        timestamp: new Date().toISOString(),
        sourceText,
        semanticText,
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
