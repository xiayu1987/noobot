/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { nowMs, parseTimeMs, toIsoTime } from "../infra/timeFields";

export const THINKING_TIMING_STORAGE_KEY = "noobot_thinking_timing_v1";
const TIMING_TTL_MS = 48 * 60 * 60 * 1000;

function trim(value) {
  return String(value || "").trim();
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
    turnScopeId: trim(entry.turnScopeId),
    startedAtMs,
    startedAt: trim(entry.startedAt) || toIsoTime(startedAtMs),
    updatedAtMs: parseTimeMs(entry.updatedAtMs) || startedAtMs,
    finishedAtMs: finishedAtMs || 0,
    finishedAt: finishedAtMs > 0 ? (trim(entry.finishedAt) || toIsoTime(finishedAtMs)) : "",
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

function hasSameSessionOrMissing(entrySessionId = "", sessionId = "") {
  return !sessionId || !entrySessionId || entrySessionId === sessionId;
}

function identityScore(entry = {}, scope = {}, options = {}) {
  const sessionId = trim(scope.sessionId);
  const dialogProcessId = trim(scope.dialogProcessId);
  const turnScopeId = trim(scope.turnScopeId);
  const allowSessionPromotionByTurnScope = options.allowSessionPromotionByTurnScope === true;
  const entrySessionId = trim(entry.sessionId);
  const entryDialogProcessId = trim(entry.dialogProcessId);
  const entryTurnScopeId = trim(entry.turnScopeId);

  const sameSession = Boolean(sessionId && entrySessionId && entrySessionId === sessionId);
  if (turnScopeId) {
    if (!entryTurnScopeId || entryTurnScopeId !== turnScopeId) return 0;
    if (!hasSameSessionOrMissing(entrySessionId, sessionId) && !allowSessionPromotionByTurnScope) {
      return 0;
    }
    return sameSession ? 100 : 60;
  }
  const turnIdentityConflict = Boolean(
    turnScopeId && entryTurnScopeId && entryTurnScopeId !== turnScopeId,
  );
  const processIdentityConflict = Boolean(
    dialogProcessId && entryDialogProcessId && entryDialogProcessId !== dialogProcessId,
  );
  if (turnIdentityConflict || processIdentityConflict) return 0;
  if (dialogProcessId && entryDialogProcessId === dialogProcessId) return sameSession ? 40 : 30;
  if (sessionId && entrySessionId && entrySessionId !== sessionId) return 0;
  if (sessionId && entrySessionId === sessionId && !dialogProcessId && !turnScopeId) return 5;
  return 0;
}

function findBestEntry(entries = [], scope = {}, options = {}) {
  let best = null;
  let bestScore = 0;
  for (const entry of entries) {
    const score = identityScore(entry, scope, options);
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
    turnScopeId: trim(patch.turnScopeId) || trim(existing?.turnScopeId),
    startedAtMs,
    startedAt: toIsoTime(startedAtMs),
    updatedAtMs: parseTimeMs(patch.updatedAtMs) || nowMs(),
    finishedAtMs,
    finishedAt: finishedAtMs > 0 ? (trim(patch.finishedAt) || trim(existing?.finishedAt) || toIsoTime(finishedAtMs)) : "",
  };
}

export function rememberThinkingStarted(scope = {}) {
  const sessionId = trim(scope.sessionId);
  const dialogProcessId = trim(scope.dialogProcessId);
  const turnScopeId = trim(scope.turnScopeId);
  if (!sessionId && !dialogProcessId && !turnScopeId) return null;
  const entries = readEntries();
  const existing = findBestEntry(
    entries,
    { sessionId, dialogProcessId, turnScopeId },
    { allowSessionPromotionByTurnScope: true },
  );
  const nextEntry = mergeEntry(existing, {
    sessionId,
    dialogProcessId,
    turnScopeId,
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
  const turnScopeId = trim(scope.turnScopeId);
  if (!dialogProcessId || (!sessionId && !turnScopeId)) return null;
  const entries = readEntries();
  const existing =
    findBestEntry(
      entries,
      { sessionId, turnScopeId },
      { allowSessionPromotionByTurnScope: true },
    ) ||
    findBestEntry(entries, { sessionId, dialogProcessId });
  const nextEntry = mergeEntry(existing, { sessionId, dialogProcessId, turnScopeId });
  const nextEntries = existing ? entries.map((entry) => (entry === existing ? nextEntry : entry)) : [...entries, nextEntry];
  writeEntries(nextEntries);
  return nextEntry;
}

export function rememberThinkingFinished(scope = {}) {
  const sessionId = trim(scope.sessionId);
  const dialogProcessId = trim(scope.dialogProcessId);
  const turnScopeId = trim(scope.turnScopeId);
  if (!sessionId && !dialogProcessId && !turnScopeId) return null;
  const entries = readEntries();
  const existing = findBestEntry(
    entries,
    { sessionId, dialogProcessId, turnScopeId },
    { allowSessionPromotionByTurnScope: true },
  );
  if (!existing) return null;
  const finishedAtMs = parseTimeMs(scope.finishedAtMs || scope.finishedAt) || nowMs();
  const nextEntry = mergeEntry(existing, { sessionId, dialogProcessId, turnScopeId, finishedAtMs, updatedAtMs: finishedAtMs });
  writeEntries(entries.map((entry) => (entry === existing ? nextEntry : entry)));
  return nextEntry;
}

export function resolveThinkingTiming(scope = {}) {
  const entry = findBestEntry(readEntries(), {
    sessionId: trim(scope.sessionId),
    dialogProcessId: trim(scope.dialogProcessId),
    turnScopeId: trim(scope.turnScopeId),
  });
  return entry ? { ...entry } : null;
}

export function clearThinkingTiming(scope = {}) {
  const entries = readEntries();
  const nextEntries = entries.filter((entry) => identityScore(entry, scope) <= 0);
  writeEntries(nextEntries);
}
