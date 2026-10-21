/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import {
  CONTEXT_MESSAGE_PROJECTION_TYPE,
  CONTEXT_MESSAGE_ROLE,
  resolveContextMessageContent,
  resolveContextMessageDialogProcessId,
  resolveContextMessageId,
  resolveContextMessageRole,
  resolveContextMessageTurnScopeId,
  resolveContextToolResultCallId,
  readContextMessageField,
  deriveContextMessageProjectionId,
  writeContextMessageMetadata,
} from "../message/codec.js";
import { CONTEXT_INTERNAL_MESSAGE_TYPE } from "../message/internal-types.js";
import { FLOW_CONTROL_ROLE, hasContextMessageFlowControlRole } from "../tool/context-policy.js";
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
  if (!hasContextMessageFlowControlRole(message, FLOW_CONTROL_ROLE.CHECKPOINT_BOUNDARY))
    return null;
  const summary = extractContextTaskSummary(message);
  if (!summary) return null;
  const sourceMessageId = resolveContextMessageId(message);
  if (!sourceMessageId) {
    throw new Error("checkpoint boundary tool result requires additional_kwargs.messageUid");
  }
  const toolCallId = resolveContextToolResultCallId(message);
  const metadata = {
    messageUid: deriveContextMessageProjectionId(
      sourceMessageId,
      CONTEXT_MESSAGE_PROJECTION_TYPE.PHASE_SUMMARY,
    ),
    dialogProcessId: resolveContextMessageDialogProcessId(message) || undefined,
    parentDialogProcessId: readContextMessageField(message, "parentDialogProcessId") || undefined,
    turnScopeId: resolveContextMessageTurnScopeId(message) || undefined,
    noobotInternalMessageType: CONTEXT_INTERNAL_MESSAGE_TYPE.PHASE_SUMMARY_MEMORY,
    recoveredFromUnpairedTaskSummary: true,
    original_tool_call_id: toolCallId || undefined,
  };
  return writeContextMessageMetadata(
    { role: CONTEXT_MESSAGE_ROLE.USER, content: summary },
    metadata,
  );
}
