/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { HumanMessage } from "@langchain/core/messages";
import { MESSAGE_ROLE } from "../../../../bot-manage/config/constants.js";
import { toLangChainToolCalls } from "./message-utils.js";

const TASK_SUMMARY_TOOL_NAME = "task_summary";

function resolveToolNameFromToolCallLike(toolCall = {}) {
  if (!toolCall || typeof toolCall !== "object") return "";
  if (toolCall.name) return String(toolCall.name || "").trim();
  const fn = toolCall.function && typeof toolCall.function === "object" ? toolCall.function : {};
  return String(fn.name || "").trim();
}

function hasTaskSummaryToolCallMessage(msg = {}) {
  return (Array.isArray(msg?.tool_calls) ? msg.tool_calls : []).some(
    (toolCall) => resolveToolNameFromToolCallLike(toolCall) === TASK_SUMMARY_TOOL_NAME,
  );
}

export function isTaskSummaryToolResultMessage(msg = {}) {
  const explicitToolName = String(msg?.toolName || msg?.tool_name || "").trim();
  if (explicitToolName === TASK_SUMMARY_TOOL_NAME) return true;
  try {
    const parsed = JSON.parse(String(msg?.content || ""));
    return String(parsed?.toolName || "").trim() === TASK_SUMMARY_TOOL_NAME;
  } catch {
    return false;
  }
}

function extractTaskSummaryTextFromToolResult(msg = {}) {
  const rawContent = String(msg?.content || "").trim();
  if (!rawContent) return "";
  try {
    const parsed = JSON.parse(rawContent);
    const phaseSummary = String(parsed?.phaseSummary || parsed?.phase_summary || "").trim();
    if (phaseSummary) return phaseSummary;
    const summaryContent = String(parsed?.summaryContent || parsed?.summary_content || "").trim();
    if (summaryContent) return summaryContent;
    const summary = typeof parsed?.summary === "string"
      ? String(parsed.summary || "").trim()
      : "";
    if (summary) return summary;
  } catch {
    // fall through to raw content
  }
  return rawContent;
}

export function buildTaskSummaryFallbackHumanMessage(msg = {}) {
  const summaryText = extractTaskSummaryTextFromToolResult(msg);
  if (!summaryText) return null;
  return new HumanMessage({
    content: `[阶段小结]
${summaryText}`,
    additional_kwargs: {
      noobotInternalMessageType: "phase_summary_memory",
      recoveredFromUnpairedTaskSummary: true,
    },
  });
}

export function shouldSkipSummarizedHistoryMessage(msg = {}) {
  if (msg?.summarized !== true) return false;
  return !hasTaskSummaryToolCallMessage(msg) && !isTaskSummaryToolResultMessage(msg);
}

export function normalizeUnpairedTaskSummaryToolResults(historyMessages = []) {
  const source = Array.isArray(historyMessages) ? historyMessages : [];
  const knownToolCallIds = new Set();
  for (const msg of source) {
    if ((msg?.role || "") !== MESSAGE_ROLE.ASSISTANT) continue;
    const toolCalls = toLangChainToolCalls(msg?.tool_calls || []);
    for (const toolCall of toolCalls) {
      const id = String(toolCall?.id || "").trim();
      if (id) knownToolCallIds.add(id);
    }
  }

  return source.map((msg) => {
    if ((msg?.role || "") !== MESSAGE_ROLE.TOOL) return msg;
    if (!isTaskSummaryToolResultMessage(msg)) return msg;
    const toolCallId = String(msg?.tool_call_id || "").trim();
    if (toolCallId && knownToolCallIds.has(toolCallId)) return msg;
    const summaryText = extractTaskSummaryTextFromToolResult(msg);
    if (!summaryText) return msg;
    return {
      role: MESSAGE_ROLE.USER,
      content: `[阶段小结]
${summaryText}`,
      dialogProcessId: msg?.dialogProcessId,
      parentDialogProcessId: msg?.parentDialogProcessId,
      turnScopeId: msg?.turnScopeId,
      summarized: false,
      phaseSummaryMemory: true,
    };
  });
}
