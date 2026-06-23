/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

function trim(value = "") {
  return String(value || "").trim();
}

export function nowMs() {
  return Date.now();
}

export function toIsoTime(value = "") {
  const ms = parseTimeMs(value);
  return ms > 0 ? new Date(ms).toISOString() : "";
}

export function nowIso() {
  return new Date(nowMs()).toISOString();
}

export function parseTimeMs(value) {
  if (value === null || value === undefined || value === "") return 0;
  if (typeof value === "number") return Number.isFinite(value) && value > 0 ? normalizeEpochMs(value) : 0;
  const text = trim(value);
  if (!text) return 0;
  const asNumber = Number(text);
  if (Number.isFinite(asNumber) && asNumber > 0) return normalizeEpochMs(asNumber);
  const parsed = new Date(text).getTime();
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function normalizeEpochMs(value = 0) {
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue) || numberValue <= 0) return 0;
  return numberValue > 1e11 ? numberValue : numberValue * 1000;
}

export function firstTimeValue(...values) {
  for (const value of values) {
    if (value === null || value === undefined || value === "") continue;
    if (typeof value === "number" && Number.isFinite(value) && value > 0) return value;
    const text = trim(value);
    if (text) return text;
  }
  return "";
}

export function resolveTimeMs(...values) {
  for (const value of values) {
    const ms = parseTimeMs(value);
    if (ms > 0) return ms;
  }
  return 0;
}

export function resolveTimeIso(...values) {
  for (const value of values) {
    const text = trim(value);
    if (text && !Number.isFinite(Number(text))) {
      const ms = parseTimeMs(text);
      if (ms > 0) return new Date(ms).toISOString();
    }
    const ms = parseTimeMs(value);
    if (ms > 0) return new Date(ms).toISOString();
  }
  return "";
}

export function normalizeTimePair(source = {}, { fallbackMs = 0, nowFallback = false } = {}) {
  const fallback = Number(fallbackMs || 0) > 0 ? Number(fallbackMs) : nowFallback ? nowMs() : 0;
  const createdAtMs = resolveTimeMs(source?.createdAtMs, source?.createdAt, source?.createdAtIso) || fallback;
  const updatedAtMs = resolveTimeMs(
    source?.updatedAtMs,
    source?.updatedAt,
    source?.updatedAtIso,
    source?.timestamp,
    createdAtMs,
  ) || fallback;
  const createdAt = resolveTimeIso(source?.createdAt, source?.createdAtIso, createdAtMs);
  const updatedAt = resolveTimeIso(source?.updatedAt, source?.updatedAtIso, updatedAtMs);
  return { createdAtMs, updatedAtMs, createdAt, updatedAt };
}

export function getMessageTimestamp(messageItem = {}) {
  return firstTimeValue(
    messageItem?.ts,
    messageItem?.timestamp,
    messageItem?.createdAt,
    messageItem?.created_at,
    messageItem?.updatedAt,
    messageItem?.updated_at,
  );
}

export function getConnectorTimestamp(connectorItem = {}) {
  return firstTimeValue(
    connectorItem?.checkedAt,
    connectorItem?.checked_at,
    connectorItem?.connectedAt,
    connectorItem?.connected_at,
  );
}

export function formatLocalTime(value, options = {}) {
  const ms = parseTimeMs(value);
  if (ms <= 0) return "";
  return new Date(ms).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    ...options,
  });
}

export function getThinkingStartedAt(messageItem = {}) {
  return resolveTimeIso(messageItem?.thinkingStartedAt, messageItem?.thinking_started_at);
}

export function getThinkingFinishedAt(messageItem = {}) {
  return resolveTimeIso(messageItem?.thinkingFinishedAt, messageItem?.thinking_finished_at);
}

export function setThinkingStartedAt(messageItem = {}, value = "") {
  const iso = resolveTimeIso(value);
  if (!messageItem || !iso) return "";
  messageItem.thinkingStartedAt = iso;
  delete messageItem.thinking_started_at;
  return iso;
}

export function setThinkingFinishedAt(messageItem = {}, value = "") {
  const iso = resolveTimeIso(value);
  if (!messageItem || !iso) return "";
  messageItem.thinkingFinishedAt = iso;
  delete messageItem.thinking_finished_at;
  return iso;
}

export function preserveThinkingTimes(targetMessage = {}, sourceMessage = {}) {
  const startedAt = getThinkingStartedAt(targetMessage);
  const finishedAt = getThinkingFinishedAt(targetMessage);
  if (startedAt && !getThinkingStartedAt(sourceMessage)) setThinkingStartedAt(targetMessage, startedAt);
  if (finishedAt && !getThinkingFinishedAt(sourceMessage)) setThinkingFinishedAt(targetMessage, finishedAt);
}
