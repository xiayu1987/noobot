/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import { TASK_STATUS } from "../../bot/async/constants.js";
import { recoverableToolError } from "../../shared/errors/index.js";
import { toToolJsonResult } from "../core/tool-json-result.js";
import { tTool } from "../core/tool-i18n.js";
import { ERROR_CODE } from "../../shared/errors/constants.js";
import { TOOL_NAME } from "../constants/index.js";
import { getRuntimeFromAgentContext } from "../../context/agent-context-accessor.js";
import {
  TASK_SUMMARY_PROTOCOL_VERSION,
  TASK_SUMMARY_STATE,
  createTaskSummaryReceipt,
  parseTaskSummaryContent,
} from "@noobot/context-protocol/task/summary";
import {
  MAIN_FLOW_CONTROL_REASON,
  requestMainFlowFinalNoToolsTurn,
} from "../../runtime/main-flow-control.js";
import {
  FLOW_CONTROL_ROLE,
  createFlowControlContextPolicy,
} from "@noobot/context-protocol/tool/context-policy";

export const TASK_SUMMARY_TOOL_NAME = TOOL_NAME.TASK_SUMMARY;

function normalizeToolNameFromToolCall(toolCall = {}) {
  if (!toolCall || typeof toolCall !== "object") return "";
  if (toolCall.name) return String(toolCall.name || "").trim();
  const fn = toolCall.function && typeof toolCall.function === "object" ? toolCall.function : {};
  return String(fn.name || "").trim();
}

export function isTaskSummaryMessage(messageItem = {}) {
  const role = String(messageItem?.role || "").trim();
  if (role === "assistant") {
    const toolCalls = Array.isArray(messageItem?.tool_calls) ? messageItem.tool_calls : [];
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

export function createTaskSummaryTool(ctx = {}) {
  const runtime = getRuntimeFromAgentContext(ctx?.agentContext || {});
  const systemRuntime = runtime?.systemRuntime || {};

  const taskSummaryTool = new DynamicStructuredTool({
    name: TASK_SUMMARY_TOOL_NAME,
    description: tTool(runtime, "tools.task_summary.description"),
    schema: z.object({
      summaryContent: z.string().describe(tTool(runtime, "tools.task_summary.fieldSummaryContent")),
    }),
    metadata: {
      contextPolicy: createFlowControlContextPolicy(
        FLOW_CONTROL_ROLE.CHECKPOINT_BOUNDARY,
      ),
    },
    func: async ({ summaryContent }) => {
      const summaryText = String(summaryContent || "").trim();
      if (!summaryText) {
        throw recoverableToolError(tTool(runtime, "tools.task_summary.summaryContentRequired"), {
          code: ERROR_CODE.RECOVERABLE_INPUT_MISSING,
        });
      }

      let parsedSummary;
      try {
        parsedSummary = parseTaskSummaryContent(summaryText);
      } catch (error) {
        throw recoverableToolError(tTool(runtime, "tools.task_summary.summaryProtocolInvalid"), {
          code: ERROR_CODE.RECOVERABLE_INVALID_TOOL_INPUT,
          details: { reason: String(error?.message || error) },
        });
      }

      const summary = createTaskSummaryReceipt(parsedSummary);
      if (summary.state === TASK_SUMMARY_STATE.COMPLETE) {
        requestMainFlowFinalNoToolsTurn(runtime, {
          reason: MAIN_FLOW_CONTROL_REASON.TASK_SUMMARY_COMPLETE,
          source: TASK_SUMMARY_TOOL_NAME,
          detail: summary,
        });
      } else if (summary.state === TASK_SUMMARY_STATE.BLOCKED) {
        requestMainFlowFinalNoToolsTurn(runtime, {
          reason: MAIN_FLOW_CONTROL_REASON.TASK_SUMMARY_BLOCKED,
          source: TASK_SUMMARY_TOOL_NAME,
          detail: summary,
        });
      }

      systemRuntime.needsPhaseSummary = false;
      systemRuntime.phaseSummaryLoopCount = 0;
      return toToolJsonResult(
        TASK_SUMMARY_TOOL_NAME,
        {
          ok: true,
          status: TASK_STATUS.COMPLETED,
          protocolVersion: TASK_SUMMARY_PROTOCOL_VERSION,
          summary,
          message: tTool(runtime, "tools.task_summary.summaryCompletedFollowState"),
        },
        true,
      );
    },
  });

  return [taskSummaryTool];
}
