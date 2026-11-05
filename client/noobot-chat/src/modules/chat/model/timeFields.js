/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { text } from "@noobot/shared/value";

function trim(value = "") {
  return text(value);
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
  if (typeof value === "number")
    return Number.isFinite(value) && value > 0 ? normalizeEpochMs(value) : 0;
  const inputText = trim(value);
  if (!inputText) return 0;
  const asNumber = Number(inputText);
  if (Number.isFinite(asNumber) && asNumber > 0) return normalizeEpochMs(asNumber);
  const parsed = new Date(inputText).getTime();
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function normalizeEpochMs(value = 0) {
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue) || numberValue <= 0) return 0;
  return numberValue > 1e11 ? numberValue : numberValue * 1000;
}

export function resolveTimeMs(...values) {
  for (const value of values) {
    const ms = parseTimeMs(value);
    if (ms > 0) return ms;
  }
  return 0;
}

export function formatLocalTime(value, options = {}) {
  const ms = parseTimeMs(value);
  if (ms <= 0) return "";
  return new Date(ms).toLocaleString([], {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    ...options,
  });
}

export function formatDurationMs(ms = 0) {
  if (!Number.isFinite(ms) || ms < 0) {
    throw new RangeError(`duration must be a non-negative finite number: ${ms}`);
  }
  const total = Math.floor(ms / 1000);
  const hourValue = Math.floor(total / 3600);
  const minuteValue = Math.floor((total % 3600) / 60);
  const secondValue = total % 60;
  if (hourValue > 0) {
    return `${String(hourValue).padStart(2, "0")}:${String(minuteValue).padStart(2, "0")}:${String(secondValue).padStart(2, "0")}`;
  }
  return `${String(minuteValue).padStart(2, "0")}:${String(secondValue).padStart(2, "0")}`;
}

export function resolveThinkingDurationMs({
  messageStartedAt = 0,
  messageFinishedAt = 0,
  now = null,
  running = false,
} = {}) {
  const startMs = resolveTimeMs(messageStartedAt);
  if (startMs <= 0) return null;
  const finishedMs = resolveTimeMs(messageFinishedAt);
  if (finishedMs > 0) {
    return finishedMs >= startMs ? finishedMs - startMs : null;
  }
  if (!running) return null;
  const currentMs = parseTimeMs(now);
  if (currentMs <= 0 || currentMs < startMs) return null;
  return currentMs - startMs;
}
