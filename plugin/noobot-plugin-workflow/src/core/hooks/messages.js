/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { WORKFLOW_SEMANTIC } from "../constants.js";
import { resolveWorkflowLocaleFromContext, tWorkflow, WORKFLOW_I18N_KEYSET } from "../i18n.js";
import { resolveWorkflowAgentContext } from "./runtime.js";
import { LENGTH_THRESHOLDS } from "@noobot/shared/length-thresholds";
import { projectAuxiliaryHistoryMessages } from "@noobot/context-protocol/assembly/auxiliary-history";
import { text } from "@noobot/shared/value";

export function resolveWorkflowSourceText(ctx) {
  return text(ctx.userMessage);
}

function compactWorkflowText(
  input = "",
  maxLength = LENGTH_THRESHOLDS.contextPreview.workflowCompactTextChars,
) {
  const raw = String(input || "")
    .replace(/\s+/g, " ")
    .trim();
  const fallback = LENGTH_THRESHOLDS.contextPreview.workflowCompactTextChars;
  const limit = Number.isFinite(Number(maxLength))
    ? Math.max(80, Math.floor(Number(maxLength)))
    : fallback;
  if (raw.length <= limit) return raw;
  return `${raw.slice(0, limit).trim()}...`;
}

function resolveWorkflowAvailableToolCatalog(ctx = {}) {
  const locale = resolveWorkflowLocaleFromContext(ctx);
  const agentContext = resolveWorkflowAgentContext(ctx);
  const registry = Array.isArray(agentContext?.bindings?.tools) ? agentContext.bindings.tools : [];
  const catalog = [];
  const seenNames = new Set();
  for (const item of registry) {
    const name = text(item?.name);
    if (!name || seenNames.has(name)) continue;
    catalog.push({
      name,
      description: compactWorkflowText(
        item?.description || tWorkflow(locale, WORKFLOW_I18N_KEYSET.MESSAGES.NO_DESCRIPTION),
      ),
    });
    seenNames.add(name);
  }
  return catalog;
}

export function resolveWorkflowAvailableToolNames(ctx = {}) {
  return resolveWorkflowAvailableToolCatalog(ctx).map((item) => item.name);
}

export function buildWorkflowAvailableToolsPlanningBlock(ctx = {}, locale = "zh-CN") {
  const catalog = resolveWorkflowAvailableToolCatalog(ctx);
  if (!catalog.length) return "";
  return [
    tWorkflow(locale, WORKFLOW_I18N_KEYSET.MESSAGES.AVAILABLE_TOOLS_HEADER),
    "```json",
    JSON.stringify(catalog, null, 2),
    "```",
    "",
    tWorkflow(locale, WORKFLOW_I18N_KEYSET.MESSAGES.AVAILABLE_TOOLS_TASK_HINT),
  ].join("\n");
}

export function resolveWorkflowSemanticContextMessages({ options = {}, ctx = {} } = {}) {
  const resolved = options.resolveModelMessages({
    ctx,
    purpose: WORKFLOW_SEMANTIC.PURPOSE,
  });
  if (!Array.isArray(resolved)) {
    throw new TypeError("workflow semantic modelContext resolver must return a message array");
  }
  return projectAuxiliaryHistoryMessages(resolved);
}
