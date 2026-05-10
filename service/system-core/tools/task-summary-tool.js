/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import { toToolJsonResult } from "./tool-json-result.js";

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

function shouldMarkSummarized(messageItem = {}) {
  const role = String(messageItem?.role || "").trim();
  if (role === "system" || role === "user") return false;
  if (isTaskSummaryMessage(messageItem)) return false;
  return true;
}

function markCurrentTurnMessagesSummarized(currentTurnMessages = null) {
  if (!currentTurnMessages) return 0;
  if (typeof currentTurnMessages.updateWhere === "function") {
    return currentTurnMessages.updateWhere(
      { summarized: true },
      (messageItem) => shouldMarkSummarized(messageItem),
    );
  }
  return 0;
}

async function markPersistedMessagesSummarized({
  sessionManager = null,
  userId = "",
  sessionId = "",
  parentSessionId = "",
} = {}) {
  if (
    !sessionManager ||
    typeof sessionManager.markSessionMessagesSummarized !== "function" ||
    !userId ||
    !sessionId
  ) {
    return 0;
  }
  return sessionManager.markSessionMessagesSummarized({
    userId,
    sessionId,
    parentSessionId,
    shouldMark: shouldMarkSummarized,
  });
}

export function createTaskSummaryTool(ctx = {}) {
  const runtime = ctx?.agentContext?.runtime || {};
  const currentTurnMessages = runtime?.currentTurnMessages || null;
  const systemRuntime = runtime?.systemRuntime || {};
  const sessionManager = runtime?.sessionManager || null;

  const taskSummaryTool = new DynamicStructuredTool({
    name: TASK_SUMMARY_TOOL_NAME,
    description:
      "提交当前任务阶段小结。仅在系统要求阶段小结时调用；summaryContent 需简要说明当前目标、已完成事项、关键结果/文件/状态、未完成事项和下一步。",
    schema: z.object({
      summaryContent: z
        .string()
        .describe("阶段小结内容。请简明但覆盖当前任务状态、关键结果、遗留问题和下一步。"),
    }),
    func: async ({ summaryContent }) => {
      const summaryText = String(summaryContent || "").trim();
      if (!summaryText) {
        return toToolJsonResult(TASK_SUMMARY_TOOL_NAME, {
          ok: false,
          message: "summaryContent 必填",
        });
      }

      systemRuntime.needsPhaseSummary = false;
      systemRuntime.toolLoopExecutionCount = 0;
      systemRuntime.phaseSummaryLoopCount = 0;

      const currentTurnSummarizedCount =
        markCurrentTurnMessagesSummarized(currentTurnMessages);
      const persistedSummarizedCount = await markPersistedMessagesSummarized({
        sessionManager,
        userId: String(runtime?.userId || systemRuntime?.userId || "").trim(),
        sessionId: String(systemRuntime?.sessionId || runtime?.sessionId || "").trim(),
        parentSessionId: String(
          systemRuntime?.parentSessionId || runtime?.parentSessionId || "",
        ).trim(),
      });

      return toToolJsonResult(
        TASK_SUMMARY_TOOL_NAME,
        {
          ok: true,
          status: "completed",
          phaseSummary: summaryText,
          summarizedMessages: {
            currentTurn: currentTurnSummarizedCount,
            persisted: persistedSummarizedCount,
          },
        },
        true,
      );
    },
  });

  return [taskSummaryTool];
}
