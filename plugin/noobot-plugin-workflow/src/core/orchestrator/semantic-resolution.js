/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { WORKFLOW_PLUGIN_DEFAULTS, WORKFLOW_SEMANTIC } from "../constants.js";
import { throwIfWorkflowAborted } from "../hooks/runtime.js";
import { resolveWorkflowInputAttachments } from "../hooks/attachments.js";
import {
  buildWorkflowAvailableToolsPlanningBlock,
  resolveWorkflowAvailableToolNames,
  resolveWorkflowSemanticContextMessages,
} from "../hooks/messages.js";
import { resolveWorkflowLocaleFromContext, tWorkflow, WORKFLOW_I18N_KEYSET } from "../i18n.js";
import { MODEL_CONTEXT_SEQUENCE_POLICY } from "@noobot/model-protocol";
import { defineCapabilityActivity } from "@noobot/plugin-protocol";
import {
  formatAttachmentIdentityRef,
  projectAttachmentIdentity,
} from "@noobot/attachment-protocol";
import {
  buildDualLaneModelContext,
  MODEL_CONTEXT_LANE,
} from "@noobot/context-protocol/assembly/dual-lane";
import { text } from "@noobot/shared/value";

function buildWorkflowInputAttachmentPlanningBlock(attachments = [], ctx = {}) {
  const locale = resolveWorkflowLocaleFromContext(ctx);
  const lines = (Array.isArray(attachments) ? attachments : [])
    .map((item = {}, index) => {
      const identity = projectAttachmentIdentity(item);
      const identityRef = formatAttachmentIdentityRef(identity);
      const name = String(
        item?.name ||
          item?.fileName ||
          tWorkflow(locale, WORKFLOW_I18N_KEYSET.INPUT.DEFAULT_LABEL, { index: index + 1 }),
      ).trim();
      const mimeType = text(item?.mimeType);
      const parts = [
        `identityRef=${identityRef}`,
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

export async function resolveSemanticText({
  options = {},
  ctx = {},
  signal,
  sourceText = "",
} = {}) {
  throwIfWorkflowAborted(signal);
  const userMessage = text(ctx?.userMessage);
  const locale = text(ctx?.runConfig?.locale) || WORKFLOW_PLUGIN_DEFAULTS.DEFAULT_LOCALE;
  const userAttachments = resolveWorkflowInputAttachments(ctx);
  const attachmentPlanningBlock = buildWorkflowInputAttachmentPlanningBlock(userAttachments, ctx);
  const availableToolNames = resolveWorkflowAvailableToolNames(ctx);
  const availableToolsPlanningBlock = buildWorkflowAvailableToolsPlanningBlock(ctx, locale);
  const contextMessages = resolveWorkflowSemanticContextMessages({ options, ctx });
  const availableToolsSystemMessage = text(availableToolsPlanningBlock)
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
      .map((item) => text(item))
      .filter(Boolean)
      .join("\n\n"),
  };
  const semanticMessages = buildDualLaneModelContext({
    lane: MODEL_CONTEXT_LANE.AUXILIARY,
    sourceMessages: contextMessages,
    protocolSystemMessages: [
      text(options?.semanticPrompt),
      ...(availableToolsSystemMessage ? [availableToolsSystemMessage] : []),
    ].filter(Boolean),
    taskMessages: [semanticTaskMessage],
  }).messages;
  const result = await options.capabilityModelInvoker({
    activity: defineCapabilityActivity("workflow_semantic"),
    purpose: WORKFLOW_SEMANTIC.PURPOSE,
    domain: WORKFLOW_SEMANTIC.DOMAIN,
    model: options?.semanticModel || "",
    locale,
    prompt: "",
    messages: semanticMessages,
    ctx,
    toolAllowlist: availableToolNames,
    signal,
    contextSequencePolicy: MODEL_CONTEXT_SEQUENCE_POLICY.INDEPENDENT_REQUEST,
  });
  throwIfWorkflowAborted(signal);
  const resolvedText = text(result?.output?.text) || sourceText;
  return {
    text: resolvedText,
    traceCount: Array.isArray(result?.traces) ? result.traces.length : 0,
    requestMessages: semanticMessages,
    toolAllowlist: availableToolNames,
  };
}
