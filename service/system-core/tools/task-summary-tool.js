/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import { markCurrentTurnStoreSummarized } from "../context/session/summarized-message-policy.js";
import { toToolJsonResult } from "./tool-json-result.js";
import { tTool } from "./tool-i18n.js";

export const TASK_SUMMARY_TOOL_NAME = "task_summary";

function normalizeToolNameFromToolCall(toolCall = {}) {
  if (!toolCall || typeof toolCall !== "object") return "";
  if (toolCall.name) return String(toolCall.name || "").trim();
  const fn = toolCall.function && typeof toolCall.function === "object"
    ? toolCall.function
    : {};
  return String(fn.name || "").trim();
}

export function isTaskSummaryMessage(messageItem = {}) {
  const role = String(messageItem?.role || "").trim();
  if (role === "assistant") {
    const toolCalls = Array.isArray(messageItem?.tool_calls)
      ? messageItem.tool_calls
      : [];
    return toolCalls.some(
      (toolCall) => normalizeToolNameFromToolCall(toolCall) === TASK_SUMMARY_TOOL_NAME,
    );
  }
  if (role === "tool") {
    const toolName = String(messageItem?.toolName || messageItem?.tool_name || "").trim();
    if (toolName === TASK_SUMMARY_TOOL_NAME) return true;
    try {
      const parsed = JSON.parse(String(messageItem?.content || ""));
      return String(parsed?.toolName || "").trim() === TASK_SUMMARY_TOOL_NAME;
    } catch {
      return false;
    }
  }
  return false;
}

function markCurrentTurnMessagesSummarized(currentTurnMessages = null) {
  return markCurrentTurnStoreSummarized(currentTurnMessages, {
    taskSummaryToolName: TASK_SUMMARY_TOOL_NAME,
  });
}

export function createTaskSummaryTool(ctx = {}) {
  const runtime = ctx?.agentContext?.runtime || {};
  const currentTurnMessages = runtime?.currentTurnMessages || null;
  const systemRuntime = runtime?.systemRuntime || {};

  const taskSummaryTool = new DynamicStructuredTool({
    name: TASK_SUMMARY_TOOL_NAME,
    description: tTool(runtime, "tools.task_summary.description"),
    schema: z.object({
      summaryContent: z
        .string()
        .describe(tTool(runtime, "tools.task_summary.fieldSummaryContent")),
    }),
    func: async ({ summaryContent }) => {
      const summaryText = String(summaryContent || "").trim();
      if (!summaryText) {
        return toToolJsonResult(TASK_SUMMARY_TOOL_NAME, {
          ok: false,
          message: tTool(runtime, "tools.task_summary.summaryContentRequired"),
        });
      }

      systemRuntime.needsPhaseSummary = false;
      systemRuntime.toolLoopExecutionCount = 0;
      systemRuntime.phaseSummaryLoopCount = 0;
      const currentTurnSummarizedCount =
        markCurrentTurnMessagesSummarized(currentTurnMessages);

      return toToolJsonResult(
        TASK_SUMMARY_TOOL_NAME,
        {
          ok: true,
          status: "completed",
          message: tTool(runtime, "tools.task_summary.summaryCompletedContinue"),
          phaseSummary: summaryText,
          summarizedMessages: {
            currentTurn: currentTurnSummarizedCount,
          },
        },
        true,
      );
    },
  });

  return [taskSummaryTool];
}
