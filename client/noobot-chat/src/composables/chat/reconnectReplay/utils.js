/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { RoleEnum } from "../../../shared/constants/chatConstants";
import { getMessageDialogProcessId, getMessageRole } from "../../infra/messageIdentity";
import { nowIso } from "../../infra/timeFields";

export function _trimStr(x) {
  return String(x || "").trim();
}

export function _ensureArray(x) {
  return Array.isArray(x) ? x : [];
}

export function _isAssistantRole(msg) {
  return getMessageRole(msg) === RoleEnum.ASSISTANT;
}

export function _matchesDialogProcessId(msg, dpId) {
  return getMessageDialogProcessId(msg) === _trimStr(dpId);
}

export function normalizeExecutionLogForRealtime(logItem = {}) {
  const data = logItem?.data && typeof logItem.data === "object" ? logItem.data : {};
  const rawEvent = _trimStr(logItem?.event);
  const text = _trimStr(data?.text || logItem?.text);
  return {
    ...data,
    event: String(data?.event || rawEvent || logItem?.status || "execution_step").trim() || "execution_step",
    type: String(data?.type || logItem?.type || "execution").trim() || "execution",
    category: String(data?.category || logItem?.category || "execution").trim() || "execution",
    dialogProcessId: String(
      data?.dialogProcessId || logItem?.dialogProcessId || "",
    ).trim(),
    ts: _trimStr(data?.ts || logItem?.ts) || nowIso(),
    text,
  };
}
