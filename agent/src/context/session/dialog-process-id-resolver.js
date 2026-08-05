/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

export function resolveMessageDialogProcessId(messageItem = {}) {
  return String(
    messageItem?.dialogProcessId ||
      messageItem?.additional_kwargs?.dialogProcessId ||
      messageItem?.lc_kwargs?.dialogProcessId ||
      messageItem?.lc_kwargs?.additional_kwargs?.dialogProcessId ||
      "",
  ).trim();
}

export function resolveDialogProcessIdFromContext(ctx = {}) {
  return String(ctx?.dialogProcessId || "").trim();
}

export function resolveDialogProcessId({ ctx = {} } = {}) {
  return resolveDialogProcessIdFromContext(ctx);
}
