/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

export function getMessageToolCalls(messageItem = {}) {
  if (Array.isArray(messageItem?.tool_calls)) return messageItem.tool_calls;
  if (Array.isArray(messageItem?.lc_kwargs?.tool_calls)) return messageItem.lc_kwargs.tool_calls;
  if (Array.isArray(messageItem?.additional_kwargs?.tool_calls)) {
    return messageItem.additional_kwargs.tool_calls;
  }
  return [];
}

export function resolveMessageRole(messageItem = {}) {
  const role = String(
    messageItem?.role || messageItem?.lc_kwargs?.role || "",
  )
    .trim()
    .toLowerCase();
  if (role) return role;
  const type = String(
    messageItem?.type ||
      messageItem?.lc_kwargs?.type ||
      (typeof messageItem?._getType === "function" ? messageItem._getType() : ""),
  )
    .trim()
    .toLowerCase();
  if (type === "ai") return "assistant";
  if (type === "human") return "user";
  if (type === "system") return "system";
  if (type === "tool") return "tool";
  return "";
}

export function isMessageSummarized(messageItem = {}) {
  if (!messageItem || typeof messageItem !== "object") return false;
  if (messageItem?.summarized === true) return true;
  if (messageItem?.lc_kwargs?.summarized === true) return true;
  return false;
}

function isInjectedMessage(messageItem = {}) {
  if (!messageItem || typeof messageItem !== "object") return false;
  if (messageItem?.injectedMessage === true) return true;
  if (messageItem?.lc_kwargs?.injectedMessage === true) return true;
  return false;
}

function resolveMessageDialogProcessId(messageItem = {}) {
  return String(
    messageItem?.dialogProcessId ||
      messageItem?.dialogId ||
      messageItem?.lc_kwargs?.dialogProcessId ||
      messageItem?.lc_kwargs?.dialogId ||
      "",
  ).trim();
}

function shouldKeepMessageForDialog(
  messageItem = {},
  currentDialogProcessId = "",
) {
  if (!isInjectedMessage(messageItem)) return true;
  const normalizedCurrentDialogProcessId = String(
    currentDialogProcessId || "",
  ).trim();
  if (!normalizedCurrentDialogProcessId) return true;
  return (
    resolveMessageDialogProcessId(messageItem) ===
    normalizedCurrentDialogProcessId
  );
}

export function filterInjectedMessagesForDialog(
  messages = [],
  currentDialogProcessId = "",
) {
  return (Array.isArray(messages) ? messages : []).filter((messageItem) =>
    shouldKeepMessageForDialog(messageItem, currentDialogProcessId),
  );
}

export function shouldKeepForModelContext(messageItem = {}) {
  return !isMessageSummarized(messageItem);
}

export function filterForModelContext(messages = []) {
  const source = (Array.isArray(messages) ? messages : []).filter((messageItem) =>
    shouldKeepForModelContext(messageItem),
  );
  const assistantCallIds = new Set();
  const toolResultIds = new Set();

  for (const messageItem of source) {
    const role = resolveMessageRole(messageItem);
    if (role === "assistant") {
      const toolCalls = getMessageToolCalls(messageItem);
      for (const toolCall of toolCalls) {
        const id = String(
          toolCall?.id ??
            toolCall?.tool_call_id ??
            toolCall?.toolCallId ??
            toolCall?.call_id ??
            "",
        ).trim();
        if (id) assistantCallIds.add(id);
      }
      continue;
    }
    if (role === "tool") {
      const id = String(
        messageItem?.tool_call_id ??
          messageItem?.toolCallId ??
          messageItem?.lc_kwargs?.tool_call_id ??
          "",
      ).trim();
      if (id) toolResultIds.add(id);
    }
  }

  const validPairIds = new Set(
    [...assistantCallIds].filter((id) => toolResultIds.has(id)),
  );

  return source.filter((messageItem) => {
    const role = resolveMessageRole(messageItem);
    if (role === "tool") {
      const id = String(
        messageItem?.tool_call_id ??
          messageItem?.toolCallId ??
          messageItem?.lc_kwargs?.tool_call_id ??
          "",
      ).trim();
      return id && validPairIds.has(id);
    }
    if (role !== "assistant") return true;
    const toolCalls = getMessageToolCalls(messageItem);
    if (!toolCalls.length) return true;
    const ids = toolCalls
      .map((toolCall) =>
        String(
          toolCall?.id ??
            toolCall?.tool_call_id ??
            toolCall?.toolCallId ??
            toolCall?.call_id ??
            "",
        ).trim(),
      )
      .filter(Boolean);
    if (!ids.length) return false;
    return ids.every((id) => validPairIds.has(id));
  });
}

export function shouldMarkCurrentTurnSummarizedByPolicy(messageItem = {}) {
  const role = resolveMessageRole(messageItem);
  if (role === "user") return false;
  if (role === "assistant") return getMessageToolCalls(messageItem).length > 0;
  if (role === "tool" || role === "system") return true;
  return false;
}

export function shouldMarkCurrentTurnModelSummarizedByPolicy(messageItem = {}) {
  const role = resolveMessageRole(messageItem);
  if (role === "user") return false;
  if (role === "assistant") return getMessageToolCalls(messageItem).length > 0;
  if (role === "tool" || role === "system") return true;
  return false;
}
