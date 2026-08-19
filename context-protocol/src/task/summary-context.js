/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import {
  CONTEXT_MESSAGE_ROLE,
  resolveContextMessageContent,
  resolveContextMessageId,
  resolveContextMessageRole,
  resolveContextToolCallId,
} from "../message/codec.js";
import { FLOW_CONTROL_ROLE, hasFlowControlRole } from "../tool/context-policy.js";
import { TASK_SUMMARY_PROTOCOL_VERSION, parseTaskSummaryReceipt } from "./summary.js";

export function extractContextTaskSummary(message = {}) {
  const raw = resolveContextMessageContent(message).trim();
  if (!raw) return "";
  try {
    const parsed = JSON.parse(raw);
    if (parsed?.protocolVersion !== TASK_SUMMARY_PROTOCOL_VERSION) return "";
    parseTaskSummaryReceipt(parsed?.summary);
    return raw;
  } catch {
    return "";
  }
}

export function recoverContextTaskSummaryToolResult(message = {}) {
  if (resolveContextMessageRole(message) !== CONTEXT_MESSAGE_ROLE.TOOL) return null;
  if (!hasFlowControlRole(message, FLOW_CONTROL_ROLE.CHECKPOINT_BOUNDARY)) return null;
  const summary = extractContextTaskSummary(message);
  if (!summary) return null;
  const sourceMessageId = resolveContextMessageId(message);
  const toolCallId = resolveContextToolCallId(message);
  const {
    tool_call_id: omittedToolCallId,
    toolCallId: omittedToolCallIdCamel,
    toolName: omittedToolName,
    tool_name: omittedToolNameSnake,
    tool_calls: omittedToolCalls,
    ...rest
  } = message;
  void omittedToolCallId;
  void omittedToolCallIdCamel;
  void omittedToolName;
  void omittedToolNameSnake;
  void omittedToolCalls;
  return {
    ...rest,
    role: CONTEXT_MESSAGE_ROLE.USER,
    content: summary,
    summarized: false,
    phaseSummaryMemory: true,
    recoveredFromUnpairedTaskSummary: true,
    ...(toolCallId ? { original_tool_call_id: toolCallId } : {}),
    additional_kwargs: {
      ...(message?.additional_kwargs && typeof message.additional_kwargs === "object"
        ? message.additional_kwargs
        : {}),
      noobotInternalMessageType: "phase_summary_memory",
      recoveredFromUnpairedTaskSummary: true,
      ...(toolCallId ? { original_tool_call_id: toolCallId } : {}),
    },
    projection: {
      type: "phase-summary",
      sourceMessageId,
    },
    data: { summary },
  };
}
