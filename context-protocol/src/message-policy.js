/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

function text(value) {
  return String(value || "").trim();
}

export function readMessageField(message = {}, field = "") {
  const key = text(field);
  if (!key || !message || typeof message !== "object") return "";
  return text(
    message?.[key] ??
      message?.additional_kwargs?.[key] ??
      message?.lc_kwargs?.[key] ??
      message?.lc_kwargs?.additional_kwargs?.[key] ??
      "",
  );
}

export function resolveMessageId(message = {}) {
  return readMessageField(message, "noobotMessageId");
}

export function resolveMessageDialogProcessId(message = {}) {
  return readMessageField(message, "dialogProcessId") || readMessageField(message, "dialogId");
}

export function resolveMessageRole(message = {}) {
  const role = text(message?.role || message?.lc_kwargs?.role).toLowerCase();
  if (role) return role;
  const type = text(
    message?.type || message?.lc_kwargs?.type ||
      (typeof message?._getType === "function" ? message._getType() : ""),
  ).toLowerCase();
  return ({ ai: "assistant", human: "user", system: "system", tool: "tool" })[type] || "";
}

export function getMessageToolCalls(message = {}) {
  if (Array.isArray(message?.tool_calls)) return message.tool_calls;
  if (Array.isArray(message?.lc_kwargs?.tool_calls)) return message.lc_kwargs.tool_calls;
  if (Array.isArray(message?.additional_kwargs?.tool_calls)) return message.additional_kwargs.tool_calls;
  return [];
}

export function resolveToolCallId(value = {}) {
  return text(
    value?.id ?? value?.tool_call_id ?? value?.toolCallId ?? value?.call_id ??
      value?.lc_kwargs?.tool_call_id ?? value?.lc_kwargs?.toolCallId ?? "",
  );
}

export function isSystemLikeMessageRole(role = "") {
  const normalized = text(role).toLowerCase();
  return normalized === "system" || normalized === "developer";
}

export function isMessageSummarized(message = {}) {
  return message?.summarized === true || message?.lc_kwargs?.summarized === true ||
    message?.additional_kwargs?.summarized === true ||
    message?.lc_kwargs?.additional_kwargs?.summarized === true;
}

export function isCurrentSystemContextMessage(message = {}) {
  return readMessageField(message, "noobotInternalMessageType") === "system_context";
}

export function isInjectedMessage(message = {}) {
  if (!message || typeof message !== "object") return false;
  if (readMessageField(message, "injectedMessage").toLowerCase() === "true") return true;
  if (readMessageField(message, "injectedBy")) return true;
  return false;
}

export function resolveInjectedMessageType(message = {}) {
  if (!isInjectedMessage(message)) return "";
  const explicit = readMessageField(message, "injectedMessageType") ||
    readMessageField(message, "injected_message_type") ||
    readMessageField(message, "noobotInternalMessageType");
  if (explicit) return explicit;
  const generic = text(message?.type || message?.lc_kwargs?.type);
  if (generic && generic !== "message") return generic;
  return readMessageField(message, "injectedBy") || "injected_message";
}

export function shouldKeepForModelContext(message = {}) {
  if (isMessageSummarized(message) &&
      isSystemLikeMessageRole(resolveMessageRole(message)) &&
      isCurrentSystemContextMessage(message)) return true;
  return !isMessageSummarized(message);
}

export function filterForModelContext(messages = [], {
  recoverUnpairedToolResult = null,
} = {}) {
  const kept = (Array.isArray(messages) ? messages : []).filter((message) => {
    const placeholder = message?.turnStatusPlaceholder === true || Boolean(
      message?.synthetic === true && message?.placeholder === true &&
      message?.turnStatus && typeof message.turnStatus === "object",
    );
    return !placeholder && shouldKeepForModelContext(message);
  });
  const source = kept;
  const assistantIds = new Set();
  const resultIds = new Set();
  for (const message of source) {
    const role = resolveMessageRole(message);
    if (role === "assistant") getMessageToolCalls(message).map(resolveToolCallId).filter(Boolean).forEach((id) => assistantIds.add(id));
    if (role === "tool") {
      const id = resolveToolCallId(message);
      if (id) resultIds.add(id);
    }
  }
  const validIds = new Set([...assistantIds].filter((id) => resultIds.has(id)));
  const result = [];
  for (const message of source) {
    const role = resolveMessageRole(message);
    if (role === "tool") {
      const id = resolveToolCallId(message);
      if (id && validIds.has(id)) result.push(message);
      else if (typeof recoverUnpairedToolResult === "function") {
        const recovered = recoverUnpairedToolResult(message);
        if (recovered) result.push(recovered);
      }
      continue;
    }
    if (role !== "assistant") {
      result.push(message);
      continue;
    }
    const calls = getMessageToolCalls(message);
    if (!calls.length) {
      result.push(message);
      continue;
    }
    const ids = calls.map(resolveToolCallId).filter(Boolean);
    if (ids.length && ids.every((id) => validIds.has(id))) result.push(message);
  }
  return result;
}

export function shouldMarkCurrentTurnSummarizedByPolicy(message = {}) {
  const role = resolveMessageRole(message);
  if (role === "user") return false;
  if (role === "assistant") return getMessageToolCalls(message).length > 0;
  return role === "tool" || isSystemLikeMessageRole(role);
}
