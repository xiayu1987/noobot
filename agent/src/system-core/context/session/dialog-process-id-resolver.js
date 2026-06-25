/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

export function resolveMessageDialogProcessId(messageItem = {}) {
  return String(
    messageItem?.dialogProcessId ||
      messageItem?.dialogId ||
      messageItem?.additional_kwargs?.dialogProcessId ||
      messageItem?.additional_kwargs?.dialogId ||
      messageItem?.lc_kwargs?.dialogProcessId ||
      messageItem?.lc_kwargs?.dialogId ||
      messageItem?.lc_kwargs?.additional_kwargs?.dialogProcessId ||
      messageItem?.lc_kwargs?.additional_kwargs?.dialogId ||
      "",
  ).trim();
}

export function resolveDialogProcessIdFromContext(ctx = {}) {
  const candidates = [
    ctx?.dialogProcessId,
    ctx?.currentDialogProcessId,
    ctx?.runtime?.dialogProcessId,
    ctx?.runtime?.systemRuntime?.dialogProcessId,
    ctx?.runtime?.systemRuntime?.currentDialogProcessId,
    ctx?.systemRuntime?.dialogProcessId,
    ctx?.systemRuntime?.currentDialogProcessId,
    ctx?.agentContext?.execution?.dialogProcessId,
    ctx?.agentContext?.execution?.controllers?.runtime?.dialogProcessId,
    ctx?.agentContext?.execution?.controllers?.runtime?.systemRuntime?.dialogProcessId,
    ctx?.agentContext?.execution?.controllers?.runtime?.systemRuntime?.currentDialogProcessId,
    ctx?.agentContext?.execution?.controllers?.runtime?.upstream?.dialogProcessId,
  ];
  for (const candidate of candidates) {
    const normalized = String(candidate || "").trim();
    if (normalized) return normalized;
  }
  return "";
}

export function resolveDialogProcessId({
  ctx = {},
  messages = [],
  fallback = "",
} = {}) {
  const fromContext = resolveDialogProcessIdFromContext(ctx);
  if (fromContext) return fromContext;
  const list = Array.isArray(messages) ? messages : [];
  for (let index = list.length - 1; index >= 0; index -= 1) {
    const fromMessage = resolveMessageDialogProcessId(list[index] || {});
    if (fromMessage) return fromMessage;
  }
  return String(fallback || "").trim();
}
