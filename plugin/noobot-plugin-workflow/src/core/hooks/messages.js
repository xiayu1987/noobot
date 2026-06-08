/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { WORKFLOW_BOT_HOOK_POINTS, WORKFLOW_SEMANTIC } from "../constants.js";
import { resolveWorkflowLocaleFromContext, tWorkflow } from "../i18n.js";

export function resolveAssistantOutput(agentResult = {}) {
  const direct = String(agentResult?.output || agentResult?.answer || "").trim();
  if (direct) return direct;
  const messages = Array.isArray(agentResult?.turnMessages) ? agentResult.turnMessages : [];
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const messageItem = messages[index] || {};
    const content = String(messageItem?.content || "").trim();
    if (content) return content;
  }
  return "";
}

export function resolveWorkflowSourceText(ctx = {}, agentResult = {}, hookPoint = "") {
  const normalizedHookPoint = String(hookPoint || "").trim();
  const outputFromAgent = resolveAssistantOutput(agentResult);
  if (outputFromAgent) return outputFromAgent;
  if (normalizedHookPoint === WORKFLOW_BOT_HOOK_POINTS.BEFORE_AGENT_DISPATCH) {
    return String(ctx?.userMessage || "").trim();
  }
  return String(ctx?.userMessage || "").trim();
}

export function extractWorkflowMessageTextContent(content = "") {
  if (content === undefined || content === null) return "";
  if (typeof content === "string") return content.trim();
  if (Array.isArray(content)) {
    return content
      .map((item = {}) => {
        if (typeof item === "string") return item;
        if (!item || typeof item !== "object") return "";
        return String(item?.text || item?.content || item?.value || "").trim();
      })
      .filter(Boolean)
      .join("\n")
      .trim();
  }
  if (typeof content === "object") {
    return String(content?.text || content?.content || content?.value || "").trim();
  }
  return String(content || "").trim();
}

export function compactWorkflowText(input = "", maxLength = 500) {
  const raw = String(input || "")
    .replace(/\s+/g, " ")
    .trim();
  const limit = Number.isFinite(Number(maxLength)) ? Math.max(80, Math.floor(Number(maxLength))) : 500;
  if (raw.length <= limit) return raw;
  return `${raw.slice(0, limit).trim()}...`;
}

export function resolveWorkflowAvailableToolCatalog(ctx = {}) {
  const locale = resolveWorkflowLocaleFromContext(ctx);
  const registry = Array.isArray(ctx?.agentContext?.payload?.tools?.registry)
    ? ctx.agentContext.payload.tools.registry
    : [];
  const catalog = [];
  const seenNames = new Set();
  for (const item of registry) {
    const name = String(item?.name || "").trim();
    if (!name || seenNames.has(name)) continue;
    catalog.push({
      name,
      description: compactWorkflowText(item?.description || tWorkflow(locale, "workflowNoDescription")),
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
    tWorkflow(locale, "workflowAvailableToolsHeader"),
    "```json",
    JSON.stringify(catalog, null, 2),
    "```",
    "",
    tWorkflow(locale, "workflowAvailableToolsTaskHint"),
  ].join("\n");
}

export function resolveWorkflowCompatibleRole(message = {}) {
  const role = String(message?.role || message?.lc_kwargs?.role || "").trim().toLowerCase();
  if (role === "human") return "user";
  if (role === "ai") return "assistant";
  if (role) return role;
  const type = String(message?.type || message?.lc_kwargs?.type || "").trim().toLowerCase();
  if (type === "human") return "user";
  if (type === "ai") return "assistant";
  if (type === "system") return "system";
  if (type === "tool") return "tool";
  if (type) return type;
  return "";
}

export function resolveWorkflowToolCallName(toolCall = {}) {
  if (!toolCall || typeof toolCall !== "object") return "";
  const fnName = String(toolCall?.function?.name || "").trim();
  if (fnName) return fnName;
  return String(toolCall?.name || "").trim();
}

export function resolveWorkflowToolCallArguments(toolCall = {}) {
  if (!toolCall || typeof toolCall !== "object") return "";
  const fnArgs = toolCall?.function?.arguments;
  if (typeof fnArgs === "string") return fnArgs.trim();
  if (fnArgs && typeof fnArgs === "object") {
    try {
      return JSON.stringify(fnArgs);
    } catch {
      return String(fnArgs);
    }
  }
  const args = toolCall?.args;
  if (typeof args === "string") return args.trim();
  if (args && typeof args === "object") {
    try {
      return JSON.stringify(args);
    } catch {
      return String(args);
    }
  }
  return "";
}

export function buildWorkflowToolCallSemanticText(toolCalls = [], locale = "zh-CN") {
  const calls = Array.isArray(toolCalls) ? toolCalls : [];
  if (!calls.length) return "";
  return calls
    .map((toolCall = {}) => {
      const name =
        resolveWorkflowToolCallName(toolCall) || tWorkflow(locale, "workflowToolCallUnknownScript");
      const args =
        resolveWorkflowToolCallArguments(toolCall) || tWorkflow(locale, "workflowToolCallNoArguments");
      return tWorkflow(locale, "workflowToolCallSemanticLine", { name, args });
    })
    .join("\n");
}

export function normalizeWorkflowSemanticContextMessage(message = {}, locale = "zh-CN") {
  const role = resolveWorkflowCompatibleRole(message);
  if (!role) return null;
  const content = extractWorkflowMessageTextContent(
    message?.content ?? message?.lc_kwargs?.content ?? message,
  );
  const toolCalls = Array.isArray(message?.tool_calls)
    ? message.tool_calls
    : Array.isArray(message?.toolCalls)
      ? message.toolCalls
      : Array.isArray(message?.additional_kwargs?.tool_calls)
        ? message.additional_kwargs.tool_calls
        : Array.isArray(message?.lc_kwargs?.tool_calls)
          ? message.lc_kwargs.tool_calls
          : [];
  if (role === "tool") {
    return content ? { role: "assistant", content } : null;
  }
  if ((role === "assistant" || role === "ai") && toolCalls.length) {
    const semanticContent = buildWorkflowToolCallSemanticText(toolCalls, locale);
    return semanticContent ? { role: "user", content: semanticContent } : null;
  }
  if (!content) return null;
  if (!["system", "user", "assistant"].includes(role)) return null;
  return { role, content };
}

export function resolveWorkflowSemanticContextMessages({ options = {}, ctx = {}, locale = "zh-CN" } = {}) {
  const fallbackMessages = Array.isArray(ctx?.messages) ? ctx.messages : [];
  if (typeof options?.resolveModelMessages === "function") {
    try {
      const resolved = options.resolveModelMessages({
        ctx,
        purpose: WORKFLOW_SEMANTIC.PURPOSE,
        messages: fallbackMessages,
      });
      if (Array.isArray(resolved)) {
        return resolved
          .map((item = {}) => normalizeWorkflowSemanticContextMessage(item, locale))
          .filter((item) => item && String(item.content || "").trim());
      }
    } catch {
      // Fall through to local ctx.messages compatibility fallback.
    }
  }
  return fallbackMessages
    .map((item = {}) => normalizeWorkflowSemanticContextMessage(item, locale))
    .filter((item) => item && String(item.content || "").trim());
}
