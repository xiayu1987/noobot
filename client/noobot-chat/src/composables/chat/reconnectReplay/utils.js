/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { RoleEnum } from "../../../shared/constants/chatConstants";

export function _trimStr(x) {
  return String(x || "").trim();
}

export function _ensureArray(x) {
  return Array.isArray(x) ? x : [];
}

export function _isAssistantRole(msg) {
  return _trimStr(msg?.role) === RoleEnum.ASSISTANT;
}

export function _matchesDialogProcessId(msg, dpId) {
  return _trimStr(msg?.dialogProcessId) === _trimStr(dpId);
}

export function normalizeExecutionLogForRealtime(logItem = {}) {
  const data = logItem?.data && typeof logItem.data === "object" ? logItem.data : {};
  const rawEvent = _trimStr(logItem?.event);
  const text = _trimStr(data?.text);
  return {
    ...data,
    event: String(data?.event || rawEvent || "system").trim() || "system",
    type: String(data?.type || logItem?.type || "system").trim() || "system",
    category: String(data?.category || logItem?.category || "system").trim() || "system",
    dialogProcessId: String(
      data?.dialogProcessId || logItem?.dialogProcessId || "",
    ).trim(),
    ts: _trimStr(data?.ts || logItem?.ts) || new Date().toISOString(),
    text: text || (rawEvent ? `[${rawEvent}]` : ""),
  };
}
