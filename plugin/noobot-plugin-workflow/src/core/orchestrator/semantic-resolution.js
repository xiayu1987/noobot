/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { WORKFLOW_PLUGIN_DEFAULTS, WORKFLOW_SEMANTIC } from "../constants.js";
import { resolveWorkflowAbortSignal, throwIfWorkflowAborted } from "../hooks/runtime.js";
import { resolveWorkflowInputAttachments } from "../hooks/attachments.js";
import {
  buildWorkflowAvailableToolsPlanningBlock,
  resolveWorkflowAvailableToolNames,
  resolveWorkflowSemanticContextMessages,
} from "../hooks/messages.js";
import { resolveWorkflowLocaleFromContext, tWorkflow, WORKFLOW_I18N_KEYSET } from "../i18n.js";
import { MODEL_CONTEXT_SEQUENCE_POLICY } from "@noobot/model-protocol";
import { projectAttachmentIdentity } from "@noobot/attachment-protocol";
import {
  buildDualLaneModelContext,
  MODEL_CONTEXT_LANE,
} from "@noobot/context-protocol/dual-lane-context";

export function buildWorkflowInputAttachmentPlanningBlock(attachments = [], ctx = {}) {
  const locale = resolveWorkflowLocaleFromContext(ctx);
  const lines = (Array.isArray(attachments) ? attachments : [])
    .map((item = {}, index) => {
      const identity = projectAttachmentIdentity(item);
      const attachmentId = identity.attachmentId;
      const name = String(
        item?.name ||
          item?.fileName ||
          tWorkflow(locale, WORKFLOW_I18N_KEYSET.INPUT.DEFAULT_LABEL, { index: index + 1 }),
      ).trim();
      const mimeType = String(item?.mimeType || "").trim();
      const parts = [
        attachmentId ? `attachmentId=${attachmentId}` : "",
        `sessionId=${identity.sessionId}`,
        `attachmentSource=${identity.attachmentSource}`,
        name ? `name=${name}` : "",
        mimeType ? `mimeType=${mimeType}` : "",
      ].filter(Boolean);
      return parts.length ? `- ${parts.join("; ")}` : "";
    })
    .filter(Boolean);
  if (!lines.length) return "";
  return [
    tWorkflow(locale, WORKFLOW_I18N_KEYSET.INPUT.HEADER),
    ...lines,
    "",
    tWorkflow(locale, WORKFLOW_I18N_KEYSET.INPUT.PLAN_HINT_1),
    tWorkflow(locale, WORKFLOW_I18N_KEYSET.INPUT.PLAN_HINT_2),
    tWorkflow(locale, WORKFLOW_I18N_KEYSET.INPUT.PLAN_HINT_3),
    tWorkflow(locale, WORKFLOW_I18N_KEYSET.INPUT.PLAN_HINT_4),
  ].join("\n");
}

export async function resolveSemanticText({ options = {}, ctx = {}, sourceText = "" } = {}) {
  throwIfWorkflowAborted(ctx);
  if (typeof options?.capabilityModelInvoker !== "function") {
    return {
      text: sourceText,
      invoked: false,
      model: "",
      traceCount: 0,
    };
  }
  const userMessage = String(ctx?.userMessage || "").trim();
  const locale = String(ctx?.runConfig?.locale || WORKFLOW_PLUGIN_DEFAULTS.DEFAULT_LOCALE).trim();
  const userAttachments = resolveWorkflowInputAttachments(ctx);
  const attachmentPlanningBlock = buildWorkflowInputAttachmentPlanningBlock(userAttachments, ctx);
  const availableToolNames = resolveWorkflowAvailableToolNames(ctx);
  const availableToolsPlanningBlock = buildWorkflowAvailableToolsPlanningBlock(ctx, locale);
  const contextMessages = resolveWorkflowSemanticContextMessages({ options, ctx, locale });
  const availableToolsSystemMessage = String(availableToolsPlanningBlock || "").trim()
    ? { role: "system", content: availableToolsPlanningBlock }
    : null;
  const semanticTaskMessage = {
    role: "user",
    content: [
      tWorkflow(locale, WORKFLOW_I18N_KEYSET.SEMANTIC.PLAN_BY_CONTEXT),
      tWorkflow(locale, WORKFLOW_I18N_KEYSET.SEMANTIC.CURRENT_USER_MESSAGE, {
        message: userMessage || tWorkflow(locale, WORKFLOW_I18N_KEYSET.SEMANTIC.EMPTY),
      }),
      attachmentPlanningBlock,
      tWorkflow(locale, WORKFLOW_I18N_KEYSET.SEMANTIC.SOURCE_INPUT, {
        source: sourceText || tWorkflow(locale, WORKFLOW_I18N_KEYSET.SEMANTIC.EMPTY),
      }),
    ]
      .map((item) => String(item || "").trim())
      .filter(Boolean)
      .join("\n\n"),
  };
  const semanticMessages = buildDualLaneModelContext({
    lane: MODEL_CONTEXT_LANE.AUXILIARY,
    sourceMessages: contextMessages,
    protocolSystemMessages: [
      String(options?.semanticPrompt || "").trim(),
      ...(availableToolsSystemMessage ? [availableToolsSystemMessage] : []),
    ].filter(Boolean),
    taskMessages: [semanticTaskMessage],
  }).messages;
  const result = await options.capabilityModelInvoker({
    purpose: WORKFLOW_SEMANTIC.PURPOSE,
    domain: WORKFLOW_SEMANTIC.DOMAIN,
    model: options?.semanticModel || "",
    locale,
    prompt: "",
    messages: semanticMessages,
    ctx,
    toolAllowlist: availableToolNames,
    signal: resolveWorkflowAbortSignal(ctx),
    contextSequencePolicy: MODEL_CONTEXT_SEQUENCE_POLICY.INDEPENDENT_REQUEST,
  });
  throwIfWorkflowAborted(ctx);
  const resolvedText = String(result?.output?.text || "").trim() || sourceText;
  return {
    text: resolvedText,
    invoked: true,
    model: String(options?.semanticModel || "").trim(),
    traceCount: Array.isArray(result?.traces) ? result.traces.length : 0,
    requestMessages: semanticMessages,
    toolAllowlist: availableToolNames,
  };
}
