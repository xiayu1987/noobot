/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { nowIso } from "../../infra/timeFields";
import { RoleEnum } from "../../../shared/constants/chatConstants";
import { messages } from "noobot-i18n/client/messages";
import { foldConversationMessages } from "../../infra/messageModel";
import { getMessageDialogProcessId, getMessageRole, getMessageTurnScopeId } from "../../infra/messageIdentity";

export function normalizeTrimmedString(value) {
  return String(value || "").trim();
}

const LOCALE_STORAGE_KEY = "noobot_locale";
const FALLBACK_LOCALE = "zh-CN";

function translateClientMessage(key = "", params = {}) {
  const locale = String(globalThis?.localStorage?.getItem?.(LOCALE_STORAGE_KEY) || FALLBACK_LOCALE).trim();
  const table = messages[locale] || messages[FALLBACK_LOCALE] || {};
  const fallbackTable = messages[FALLBACK_LOCALE] || {};
  const raw = String(key || "")
    .split(".")
    .filter(Boolean)
    .reduce((acc, part) => (acc && typeof acc === "object" ? acc[part] : undefined), table);
  const fallbackRaw = String(key || "")
    .split(".")
    .filter(Boolean)
    .reduce((acc, part) => (acc && typeof acc === "object" ? acc[part] : undefined), fallbackTable);
  return String(raw ?? fallbackRaw ?? key).replaceAll(/\{(\w+)\}/g, (_, paramKey) => String(params?.[paramKey] ?? ""));
}

const INTERNAL_EVENT_PLACEHOLDER_LINE_RE = /^\[(tool_call|tool_result|session_turn_full|assistant_message_saved|system)\]$/;

export const INTERNAL_EXECUTION_EVENT_NAMES = new Set([
  "session_turn_full",
  "assistant_message_saved",
  "system",
]);

export function stripInternalEventPlaceholderLines(value) {
  return String(value || "")
    .split(/\r?\n/)
    .filter((line) => !INTERNAL_EVENT_PLACEHOLDER_LINE_RE.test(line.trim()))
    .join("\n")
    .trim();
}

export function isInternalEventPlaceholderText(value) {
  const rawText = normalizeTrimmedString(value);
  if (!rawText) return false;
  return !stripInternalEventPlaceholderLines(rawText);
}

export function sanitizeExecutionLogText(value) {
  return stripInternalEventPlaceholderLines(value);
}

function stringifyExecutionValue(value) {
  if (value === undefined || value === null) return "";
  if (typeof value === "string") return value.trim();
  try {
    return JSON.stringify(value);
  } catch {
    return String(value || "").trim();
  }
}

function pickExecutionToolName(logItem = {}) {
  return normalizeTrimmedString(
    logItem?.toolName ||
      logItem?.name ||
      logItem?.function?.name ||
      logItem?.tool?.name ||
      logItem?.data?.toolName ||
      logItem?.data?.name ||
      logItem?.data?.function?.name,
  );
}

function pickExecutionToolArgs(logItem = {}) {
  return stringifyExecutionValue(
    logItem?.args ??
      logItem?.arguments ??
      logItem?.input ??
      logItem?.params ??
      logItem?.rawInput ??
      logItem?.rawArgs ??
      logItem?.function?.arguments ??
      logItem?.data?.args ??
      logItem?.data?.arguments ??
      logItem?.data?.input ??
      logItem?.data?.params ??
      logItem?.data?.rawInput ??
      logItem?.data?.rawArgs ??
      logItem?.data?.function?.arguments,
  );
}

function pickExecutionToolResult(logItem = {}) {
  return stringifyExecutionValue(
    logItem?.result ??
      logItem?.output ??
      logItem?.content ??
      logItem?.data?.result ??
      logItem?.data?.output ??
      logItem?.data?.content,
  );
}

function stripExecutionCommandPrefix(value) {
  let text = normalizeTrimmedString(value);
  const prefixRe = /^(?:(?:开始|完成)：\s*)?执行命令：\s*|^(?:(?:Started|Completed):\s*)?Command:\s*/i;
  while (prefixRe.test(text)) text = text.replace(prefixRe, "").trim();
  return text;
}

function buildExecutionCommandLabel(statusKey = "", commandText = "") {
  return translateClientMessage(statusKey, { command: stripExecutionCommandPrefix(commandText) });
}

function pickExecutionCommandText(logItem = {}) {
  const explicitCommand = stringifyExecutionValue(
    logItem?.command ??
      logItem?.cmd ??
      logItem?.displayText ??
      logItem?.description ??
      logItem?.data?.command ??
      logItem?.data?.cmd ??
      logItem?.data?.displayText ??
      logItem?.data?.description ??
      logItem?.metadata?.command ??
      logItem?.metadata?.cmd ??
      logItem?.metadata?.displayText,
  );
  if (explicitCommand) return stripExecutionCommandPrefix(explicitCommand);

  const text = sanitizeExecutionLogText(logItem?.text);
  if (text && !/^[\w.-]+\s+(started|completed)$/i.test(stripExecutionCommandPrefix(text))) {
    return stripExecutionCommandPrefix(text);
  }

  const toolName = pickExecutionToolName(logItem);
  const toolArgs = pickExecutionToolArgs(logItem);
  const commandFromToolFields = [toolName, toolArgs].filter(Boolean).join(" ").trim();
  if (commandFromToolFields) return stripExecutionCommandPrefix(commandFromToolFields);

  return stripExecutionCommandPrefix(text);
}

export function buildExecutionLogDisplayText(logItem = {}) {
  const eventName = normalizeTrimmedString(logItem?.event).toLowerCase();
  const typeName = normalizeTrimmedString(logItem?.type).toLowerCase();
  const text = sanitizeExecutionLogText(logItem?.text);
  const isToolCall = eventName === "tool_call" || typeName === "tool_call";
  const isToolResult = eventName === "tool_result" || typeName === "tool_result";
  if (isToolCall) {
    const commandText = pickExecutionCommandText(logItem);
    return commandText ? buildExecutionCommandLabel("message.executionCommandStarted", commandText) : "";
  }
  if (isToolResult) {
    const commandText = pickExecutionCommandText(logItem) || stripExecutionCommandPrefix(pickExecutionToolResult(logItem));
    return commandText ? buildExecutionCommandLabel("message.executionCommandCompleted", commandText) : "";
  }
  return text;
}

export function isDisplayableExecutionLog(logItem = {}) {
  const text = buildExecutionLogDisplayText(logItem);
  if (!text) return false;
  const eventName = normalizeTrimmedString(logItem?.event).toLowerCase();
  const typeName = normalizeTrimmedString(logItem?.type).toLowerCase();
  if (
    INTERNAL_EXECUTION_EVENT_NAMES.has(eventName) ||
    INTERNAL_EXECUTION_EVENT_NAMES.has(typeName)
  ) {
    return false;
  }
  return true;
}

export function sanitizeExecutionLogForDisplay(logItem = {}) {
  const text = buildExecutionLogDisplayText(logItem);
  if (!text) return null;
  const sanitizedLog = { ...logItem, text };
  return isDisplayableExecutionLog(sanitizedLog) ? sanitizedLog : null;
}

export function isBlankCompatibleSameId(left, right) {
  const normalizedLeft = normalizeTrimmedString(left);
  const normalizedRight = normalizeTrimmedString(right);
  return !normalizedLeft || !normalizedRight || normalizedLeft === normalizedRight;
}

export function pickAssistantMessagesForCurrentTurn({
  foldedMessages = [],
  dialogProcessId = "",
  turnScopeId = "",
}) {
  const normalizedDialogProcessId = normalizeTrimmedString(dialogProcessId);
  const normalizedTurnScopeId = normalizeTrimmedString(turnScopeId);
  const messageList = Array.isArray(foldedMessages) ? foldedMessages : [];
  const lastUserMessageIndex = (() => {
    for (let messageIndex = messageList.length - 1; messageIndex >= 0; messageIndex -= 1) {
      if (getMessageRole(messageList[messageIndex]) === RoleEnum.USER) {
        return messageIndex;
      }
    }
    return -1;
  })();
  const assistantMessagesAfterLastUser = messageList.filter(
    (messageItem, messageIndex) =>
      messageIndex > lastUserMessageIndex &&
      getMessageRole(messageItem) === RoleEnum.ASSISTANT,
  );
  if (!assistantMessagesAfterLastUser.length) return [];
  if (normalizedTurnScopeId) {
    const matchedTurnMessages = assistantMessagesAfterLastUser.filter(
      (messageItem) => getMessageTurnScopeId(messageItem) === normalizedTurnScopeId,
    );
    if (matchedTurnMessages.length) return matchedTurnMessages;
    const hasAnyExplicitTurnScope = assistantMessagesAfterLastUser.some((messageItem) =>
      Boolean(getMessageTurnScopeId(messageItem)),
    );
    if (!hasAnyExplicitTurnScope && normalizedDialogProcessId) {
      const legacyDialogMessages = assistantMessagesAfterLastUser.filter(
        (messageItem) => getMessageDialogProcessId(messageItem) === normalizedDialogProcessId,
      );
      if (legacyDialogMessages.length) return legacyDialogMessages;
    }
    return [];
  }
  if (!normalizedDialogProcessId) return assistantMessagesAfterLastUser;
  const matchedMessages = assistantMessagesAfterLastUser.filter(
    (messageItem) =>
      getMessageDialogProcessId(messageItem) === normalizedDialogProcessId,
  );
  return matchedMessages.length ? matchedMessages : assistantMessagesAfterLastUser;
}

export function mergeAssistantContents(assistantMessages = []) {
  const contentList = [];
  for (const assistantMessage of assistantMessages) {
    const content = stripInternalEventPlaceholderLines(assistantMessage?.content);
    if (!content) continue;
    if (contentList[contentList.length - 1] === content) continue;
    contentList.push(content);
  }
  return contentList.join("\n\n");
}

export function buildWorkflowMessageSignature(messageItem = {}) {
  const workflowMeta =
    messageItem?.workflowMeta &&
    typeof messageItem.workflowMeta === "object" &&
    !Array.isArray(messageItem.workflowMeta)
      ? messageItem.workflowMeta
      : {};
  const semanticPreview = String(
    workflowMeta?.semanticTextPreview ||
      workflowMeta?.payload?.interaction?.semanticTextPreview ||
      "",
  ).trim();
  return [
    getMessageDialogProcessId(messageItem),
    normalizeTrimmedString(messageItem?.content),
    semanticPreview,
  ].join("|");
}

export function patchAssistantFromWorkflowMessage(targetMessage = null, workflowMessageItem = {}) {
  if (!targetMessage || !workflowMessageItem) return false;
  const previousPending = Boolean(targetMessage.pending);
  const previousStatusLabel = String(targetMessage.statusLabel || "");
  const previousRealtimeLogs = Array.isArray(targetMessage.realtimeLogs)
    ? targetMessage.realtimeLogs
    : [];
  const previousExecutionLogTotal = Number(targetMessage.executionLogTotal || 0);
  const previousHasFirstStreamEvent = targetMessage.hasFirstStreamEvent === true;
  const [normalizedWorkflowMessage] = foldConversationMessages(
    [workflowMessageItem],
    (messageItem = {}) => ({ ...messageItem }),
  );
  Object.assign(targetMessage, normalizedWorkflowMessage || workflowMessageItem);
  targetMessage.content = stripInternalEventPlaceholderLines(targetMessage.content);
  targetMessage.pending = previousPending;
  targetMessage.statusLabel = previousStatusLabel;
  targetMessage.realtimeLogs = previousRealtimeLogs;
  targetMessage.hasFirstStreamEvent = previousHasFirstStreamEvent || workflowMessageItem?.hasFirstStreamEvent === true;
  targetMessage.executionLogTotal = Math.max(
    previousExecutionLogTotal,
    Number(workflowMessageItem?.executionLogTotal || 0),
    previousRealtimeLogs.length,
  );
  // Workflow DONE snapshots only patch the current pending/streaming overlay.
  // Do not turn that overlay into a standalone workflow completed message; the
  // completed display source is rebuilt from normalized session detail.
  delete targetMessage.workflowMessage;
  delete targetMessage.workflowMeta;
  return true;
}

export function normalizeExecutionLogForRealtime(logItem = {}) {
  const data = logItem?.data && typeof logItem.data === "object" ? logItem.data : {};
  const rawEvent = normalizeTrimmedString(logItem?.event);
  const text = sanitizeExecutionLogText(
    data?.text ||
      logItem?.text ||
      data?.displayText ||
      logItem?.displayText ||
      data?.content ||
      logItem?.content,
  );
  return {
    ...logItem,
    ...data,
    event: normalizeTrimmedString(data?.event || rawEvent || logItem?.status || "execution_step") || "execution_step",
    type: normalizeTrimmedString(data?.type || logItem?.type || "execution") || "execution",
    category: normalizeTrimmedString(data?.category || logItem?.category || "execution") || "execution",
    dialogProcessId: normalizeTrimmedString(data?.dialogProcessId || logItem?.dialogProcessId),
    ts: normalizeTrimmedString(data?.ts || logItem?.ts) || nowIso(),
    text,
  };
}

export function normalizePendingInteractionPayloads(statePayload = {}) {
  const pendingInteractions = Array.isArray(statePayload?.pendingInteractions)
    ? statePayload.pendingInteractions
    : [];
  if (pendingInteractions.length) {
    return pendingInteractions.filter(
      (item) => item && typeof item === "object" && !Array.isArray(item),
    );
  }
  return statePayload?.pendingInteraction &&
    typeof statePayload.pendingInteraction === "object" &&
    !Array.isArray(statePayload.pendingInteraction)
    ? [statePayload.pendingInteraction]
    : [];
}

export function isInFlightConversationState(state = "") {
  return ["sending", "interaction_pending", "stopping", "reconnecting"].includes(
    normalizeTrimmedString(state),
  );
}

export function isTerminalConversationState(state = "") {
  return [
    "stopped",
    "completed",
    "error",
    "no_conversation",
    "expired",
    "cancelled",
  ].includes(normalizeTrimmedString(state));
}
