/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import {
  CONTEXT_MESSAGE_ROLE,
  resolveContextMessageContent,
  resolveContextMessageDialogProcessId,
  resolveContextMessageId,
  resolveContextMessageRole,
  resolveContextMessageTurnScopeId,
  resolveContextToolCallId,
  readContextMessageField,
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
  const dialogProcessId = resolveContextMessageDialogProcessId(message);
  const parentDialogProcessId = readContextMessageField(message, "parentDialogProcessId");
  const turnScopeId = resolveContextMessageTurnScopeId(message);
  const identity = {
    ...(sourceMessageId ? { noobotMessageId: sourceMessageId } : {}),
    ...(dialogProcessId ? { dialogProcessId } : {}),
    ...(parentDialogProcessId ? { parentDialogProcessId } : {}),
    ...(turnScopeId ? { turnScopeId } : {}),
  };
  return {
    ...(sourceMessageId ? { messageUid: sourceMessageId } : {}),
    role: CONTEXT_MESSAGE_ROLE.USER,
    content: summary,
    summarized: false,
    phaseSummaryMemory: true,
    recoveredFromUnpairedTaskSummary: true,
    ...(toolCallId ? { original_tool_call_id: toolCallId } : {}),
    additional_kwargs: {
      ...identity,
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
