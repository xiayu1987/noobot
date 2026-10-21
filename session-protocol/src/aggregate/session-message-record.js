/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { text } from "@noobot/shared/value";

export const SESSION_AUTO_TITLE_MAX_LENGTH = 20;

export function isSummarizedSessionMessageRecord(record = {}) {
  return record?.summarized === true;
}

export function isInjectedSessionMessageRecord(record = {}) {
  return record?.injectedMessage === true;
}

export function isPluginSessionMessageRecord(record = {}) {
  return record?.pluginMessage === true;
}

export function isInjectedOrPluginSessionMessageRecord(record = {}) {
  return isInjectedSessionMessageRecord(record) || isPluginSessionMessageRecord(record);
}

export function resolveSessionMessageRecordDialogProcessId(record = {}) {
  return text(record?.dialogProcessId);
}

export function resolveSessionMessageRecordInjectedType(record = {}) {
  return isInjectedSessionMessageRecord(record) ? text(record?.injectedMessageType) : "";
}

export function resolveSessionMessageRecordInternalMessageType(record = {}) {
  return text(record?.noobotInternalMessageType);
}

export function isDialogAnchorMessageRecord(record = {}) {
  if (text(record?.role) !== "user") return false;
  if (isInjectedOrPluginSessionMessageRecord(record)) return false;
  return text(record?.messageOrigin).toLowerCase() !== "internal";
}

export function resolveSessionAutoTitle(record = {}) {
  if (isInjectedSessionMessageRecord(record)) return "";
  if (text(record?.role).toLowerCase() !== "user") return "";
  if (!text(record?.content)) return "";
  return String(record.content).slice(0, SESSION_AUTO_TITLE_MAX_LENGTH);
}

export function deriveSessionAutoTitle(records = []) {
  for (const record of Array.isArray(records) ? records : []) {
    const title = resolveSessionAutoTitle(record);
    if (title) return title;
  }
  return "";
}
