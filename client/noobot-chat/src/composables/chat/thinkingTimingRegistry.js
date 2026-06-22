/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

export const THINKING_TIMING_STORAGE_KEY = "noobot_thinking_timing_v1";
const TIMING_TTL_MS = 48 * 60 * 60 * 1000;

function trim(value) {
  return String(value || "").trim();
}

function nowMs() {
  return Date.now();
}

function parseTimeMs(value) {
  if (value === null || value === undefined || value === "") return 0;
  if (typeof value === "number") return Number.isFinite(value) && value > 0
    ? (value > 1e11 ? value : value * 1000)
    : 0;
  const asNumber = Number(value);
  if (Number.isFinite(asNumber) && asNumber > 0) return asNumber > 1e11 ? asNumber : asNumber * 1000;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function storage() {
  try {
    return globalThis?.localStorage || null;
  } catch {
    return null;
  }
}

function normalizeEntry(entry = {}) {
  const startedAtMs = parseTimeMs(entry?.startedAtMs || entry?.startedAt);
  if (startedAtMs <= 0) return null;
  const finishedAtMs = parseTimeMs(entry?.finishedAtMs || entry?.finishedAt);
  return {
    sessionId: trim(entry.sessionId),
    dialogProcessId: trim(entry.dialogProcessId),
    clientTurnId: trim(entry.clientTurnId),
    startedAtMs,
    startedAt: trim(entry.startedAt) || new Date(startedAtMs).toISOString(),
    updatedAtMs: parseTimeMs(entry.updatedAtMs) || startedAtMs,
    finishedAtMs: finishedAtMs || 0,
    finishedAt: finishedAtMs > 0 ? (trim(entry.finishedAt) || new Date(finishedAtMs).toISOString()) : "",
  };
}

function readEntries(timestamp = nowMs()) {
  try {
    const rawValue = storage()?.getItem(THINKING_TIMING_STORAGE_KEY);
    const parsed = rawValue ? JSON.parse(rawValue) : [];
    const items = Array.isArray(parsed) ? parsed : [];
    return items
      .map((item) => normalizeEntry(item))
      .filter(Boolean)
      .filter((item) => timestamp - Number(item.updatedAtMs || item.startedAtMs || 0) <= TIMING_TTL_MS);
  } catch {
    return [];
  }
}

function writeEntries(entries = []) {
  try {
    const targetStorage = storage();
    if (!targetStorage) return;
    targetStorage.setItem(THINKING_TIMING_STORAGE_KEY, JSON.stringify(entries.map(normalizeEntry).filter(Boolean)));
  } catch {}
}

function identityScore(entry = {}, scope = {}) {
  const sessionId = trim(scope.sessionId);
  const dialogProcessId = trim(scope.dialogProcessId);
  const clientTurnId = trim(scope.clientTurnId);
  const entrySessionId = trim(entry.sessionId);
  const entryDialogProcessId = trim(entry.dialogProcessId);
  const entryClientTurnId = trim(entry.clientTurnId);

  const sameSession = Boolean(sessionId && entrySessionId && entrySessionId === sessionId);
  if (dialogProcessId && entryDialogProcessId === dialogProcessId) return sameSession ? 40 : 30;
  if (clientTurnId && entryClientTurnId === clientTurnId) return sameSession ? 35 : 25;
  if (dialogProcessId && entryDialogProcessId && entryDialogProcessId !== dialogProcessId) return 0;
  if (clientTurnId && entryClientTurnId && entryClientTurnId !== clientTurnId) return 0;
  if (sessionId && entrySessionId && entrySessionId !== sessionId) return 0;
  if (sessionId && entrySessionId === sessionId && !dialogProcessId && !clientTurnId) return 5;
  return 0;
}

function findBestEntry(entries = [], scope = {}) {
  let best = null;
  let bestScore = 0;
  for (const entry of entries) {
    const score = identityScore(entry, scope);
    if (score > bestScore) {
      best = entry;
      bestScore = score;
    }
  }
  return best;
}

function mergeEntry(existing = null, patch = {}) {
  const patchStartedAtMs = parseTimeMs(patch.startedAtMs || patch.startedAt) || 0;
  const existingStartedAtMs = Number(existing?.startedAtMs || 0);
  const startedAtMs = existingStartedAtMs && patchStartedAtMs
    ? Math.min(existingStartedAtMs, patchStartedAtMs)
    : existingStartedAtMs || patchStartedAtMs || nowMs();
  const finishedAtMs = parseTimeMs(patch.finishedAtMs || patch.finishedAt) || Number(existing?.finishedAtMs || 0);
  return {
    sessionId: trim(patch.sessionId) || trim(existing?.sessionId),
    dialogProcessId: trim(patch.dialogProcessId) || trim(existing?.dialogProcessId),
    clientTurnId: trim(patch.clientTurnId) || trim(existing?.clientTurnId),
    startedAtMs,
    startedAt: new Date(startedAtMs).toISOString(),
    updatedAtMs: parseTimeMs(patch.updatedAtMs) || nowMs(),
    finishedAtMs,
    finishedAt: finishedAtMs > 0 ? (trim(patch.finishedAt) || trim(existing?.finishedAt) || new Date(finishedAtMs).toISOString()) : "",
  };
}

export function rememberThinkingStarted(scope = {}) {
  const sessionId = trim(scope.sessionId);
  const dialogProcessId = trim(scope.dialogProcessId);
  const clientTurnId = trim(scope.clientTurnId);
  if (!sessionId && !dialogProcessId && !clientTurnId) return null;
  const entries = readEntries();
  const existing = findBestEntry(entries, { sessionId, dialogProcessId, clientTurnId });
  const nextEntry = mergeEntry(existing, {
    sessionId,
    dialogProcessId,
    clientTurnId,
    startedAtMs: parseTimeMs(scope.startedAtMs || scope.startedAt) || nowMs(),
    updatedAtMs: scope.updatedAtMs,
  });
  const nextEntries = existing ? entries.map((entry) => (entry === existing ? nextEntry : entry)) : [...entries, nextEntry];
  writeEntries(nextEntries);
  return nextEntry;
}

export function bindThinkingDialogProcess(scope = {}) {
  const sessionId = trim(scope.sessionId);
  const dialogProcessId = trim(scope.dialogProcessId);
  const clientTurnId = trim(scope.clientTurnId);
  if (!dialogProcessId || (!sessionId && !clientTurnId)) return null;
  const entries = readEntries();
  const existing = findBestEntry(entries, { sessionId, clientTurnId }) || findBestEntry(entries, { sessionId, dialogProcessId });
  const nextEntry = mergeEntry(existing, { sessionId, dialogProcessId, clientTurnId });
  const nextEntries = existing ? entries.map((entry) => (entry === existing ? nextEntry : entry)) : [...entries, nextEntry];
  writeEntries(nextEntries);
  return nextEntry;
}

export function rememberThinkingFinished(scope = {}) {
  const sessionId = trim(scope.sessionId);
  const dialogProcessId = trim(scope.dialogProcessId);
  const clientTurnId = trim(scope.clientTurnId);
  if (!sessionId && !dialogProcessId && !clientTurnId) return null;
  const entries = readEntries();
  const existing = findBestEntry(entries, { sessionId, dialogProcessId, clientTurnId });
  if (!existing) return null;
  const finishedAtMs = parseTimeMs(scope.finishedAtMs || scope.finishedAt) || nowMs();
  const nextEntry = mergeEntry(existing, { sessionId, dialogProcessId, clientTurnId, finishedAtMs, updatedAtMs: finishedAtMs });
  writeEntries(entries.map((entry) => (entry === existing ? nextEntry : entry)));
  return nextEntry;
}

export function resolveThinkingTiming(scope = {}) {
  const entry = findBestEntry(readEntries(), {
    sessionId: trim(scope.sessionId),
    dialogProcessId: trim(scope.dialogProcessId),
    clientTurnId: trim(scope.clientTurnId),
  });
  return entry ? { ...entry } : null;
}

export function clearThinkingTiming(scope = {}) {
  const entries = readEntries();
  const nextEntries = entries.filter((entry) => identityScore(entry, scope) <= 0);
  writeEntries(nextEntries);
}
