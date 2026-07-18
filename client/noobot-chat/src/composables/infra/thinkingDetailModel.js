/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  getMessageDialogProcessId,
  getMessageRole,
  getMessageSessionId,
  getMessageTurnScopeId,
} from "./messageIdentity";
import { resolveTimeMs } from "./timeFields";
import {
  buildToolCallSummary,
  buildToolResultSummary,
  buildToolNameByCallId,
  stringifyToolValue,
} from "./toolLogFormatting";

function eventName(item = {}) {
  return String(item?.event || item?.type || "").trim().toLowerCase();
}

export function isSameThinkingTurnScope(target = {}, candidate = {}) {
  const targetTurnScopeId = getMessageTurnScopeId(target);
  const candidateTurnScopeId = getMessageTurnScopeId(candidate);
  if (!targetTurnScopeId || !candidateTurnScopeId) return false;
  const targetSessionId = getMessageSessionId(target);
  const candidateSessionId = getMessageSessionId(candidate);
  return targetTurnScopeId === candidateTurnScopeId &&
    (!targetSessionId || !candidateSessionId || targetSessionId === candidateSessionId);
}

function isLogInScope(messageItem = {}, logItem = {}) {
  const targetTurnScopeId = getMessageTurnScopeId(messageItem);
  const logTurnScopeId = getMessageTurnScopeId(logItem);
  if (!targetTurnScopeId || !logTurnScopeId || targetTurnScopeId === logTurnScopeId) return true;
  const dialogProcessId = getMessageDialogProcessId(messageItem);
  return Boolean(dialogProcessId && (
    getMessageDialogProcessId(logItem) === dialogProcessId ||
    String(logItem?.parentDialogProcessId || logItem?.parent_dialog_process_id || "").trim() === dialogProcessId
  ));
}

function getScopedMessages(messageItem, allMessages, sessionDocs, variant) {
  const dialogProcessId = getMessageDialogProcessId(messageItem);
  const targetTurnScopeId = getMessageTurnScopeId(messageItem);
  const sessionMessages = (Array.isArray(sessionDocs) ? sessionDocs : []).flatMap((doc = {}) =>
    Array.isArray(doc.messages) ? doc.messages : (Array.isArray(doc.messageList) ? doc.messageList : []),
  );
  const filterScoped = (candidates, allowChildProcesses = false) => candidates.filter((item = {}) => {
    if (targetTurnScopeId) {
      if (isSameThinkingTurnScope(messageItem, item)) return true;
      return Boolean(allowChildProcesses && dialogProcessId &&
        String(item?.parentDialogProcessId || item?.parent_dialog_process_id || "").trim() === dialogProcessId);
    }
    return !dialogProcessId || getMessageDialogProcessId(item) === dialogProcessId;
  });
  // The detail response's allMessages is authoritative when it contains this
  // turn. sessionDocs remains a workflow/history fallback and may include
  // child-process messages that are not present in the flattened response.
  const responseMessages = Array.isArray(allMessages) ? allMessages : [];
  const scopedResponseMessages = filterScoped(responseMessages);
  if (scopedResponseMessages.length > 0) return scopedResponseMessages;
  const scopedSessionMessages = filterScoped(sessionMessages, true);
  if (scopedSessionMessages.length > 0) return scopedSessionMessages;
  return variant === "details" && sessionMessages.length > 0 ? sessionMessages : scopedResponseMessages;
}

function buildLogsFromMessages(messageItem, messages, toolResultFallback) {
  const toolNameByCallId = buildToolNameByCallId(messages);
  const logs = [];
  for (const item of messages) {
    const type = String(item?.type || "").trim().toLowerCase();
    const role = getMessageRole(item).toLowerCase();
    const toolCalls = Array.isArray(item?.tool_calls) ? item.tool_calls : [];
    const common = {
      sessionId: String(item?.sessionId || messageItem?.sessionId || ""),
      depth: 1,
      dialogProcessId: getMessageDialogProcessId(item) || getMessageDialogProcessId(messageItem),
      turnScopeId: getMessageTurnScopeId(item) || getMessageTurnScopeId(messageItem),
      ts: item?.ts || messageItem?.ts || "",
    };
    if (toolCalls.length || type === "tool_call") {
      (toolCalls.length ? toolCalls : [{}]).forEach((toolCall, index) => {
        const toolCallId = String(toolCall?.id || "").trim();
        logs.push({ ...common, event: "tool_call", type: "tool_call", toolCallId,
          text: buildToolCallSummary(toolCall, `tool_${index + 1}`),
          detailText: stringifyToolValue(toolCall?.function?.arguments ?? toolCall?.args ?? "") });
      });
    } else if (role === "tool" || type === "tool_result") {
      const toolCallId = String(item?.tool_call_id || item?.toolCallId || "").trim();
      const toolName = toolNameByCallId.get(toolCallId) || toolResultFallback;
      logs.push({ ...common, event: "tool_result", type: "tool_result", toolCallId,
        text: buildToolResultSummary(item?.content, toolName), detailText: String(item?.content || "").trim() });
    }
  }
  return logs;
}

function sortLogs(logs) {
  return logs.map((item, index) => ({ item, index })).sort((a, b) => {
    const left = resolveTimeMs(a.item?.ts);
    const right = resolveTimeMs(b.item?.ts);
    return left !== null && right !== null && left !== right ? left - right : a.index - b.index;
  }).map(({ item }) => item);
}

/** Single adapter from thinking-detail/raw message shapes to display-ready tool logs. */
export function normalizeThinkingToolLogs({
  messageItem = {}, allMessages = [], sessionDocs = [], variant = "panel",
  toolResultFallback = "tool_result",
} = {}) {
  const raw = Array.isArray(messageItem?.completedToolLogs) ? messageItem.completedToolLogs
    : (Array.isArray(messageItem?.processCompletedToolLogs) ? messageItem.processCompletedToolLogs : []);
  const completed = raw.filter((item) => isLogInScope(messageItem, item));
  const scopedMessages = getScopedMessages(messageItem, allMessages, sessionDocs, variant);
  const projected = buildLogsFromMessages(messageItem, scopedMessages, toolResultFallback);
  let merged = completed;
  if (!completed.length) merged = projected;
  else if (completed.some((item) => eventName(item) === "tool_call" && !String(item?.text || "").trim())) {
    const calls = projected.filter((item) => eventName(item) === "tool_call");
    merged = calls.length ? [
      ...completed.filter((item) => eventName(item) !== "tool_call" || String(item?.text || "").trim()),
      ...calls,
    ] : completed;
  }
  const seen = new Set();
  return sortLogs(merged.filter((item) => {
    const callId = String(item?.toolCallId || item?.tool_call_id || "").trim();
    if (!callId) return true;
    const key = `${eventName(item)}:${callId}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }));
}
