/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { SESSION_RUN_EVENT, SESSION_RUN_STATE, STOP_REQUEST_STORAGE_KEY, STOP_REQUEST_TTL_MS } from "./constants";
import { normalizeSessionRunEvent } from "./core";
import { trim } from "./normalize";
import { nowMs } from "../../infra/timeFields";

export function readStopRequests() {
  try {
    const storage = globalThis?.localStorage;
    if (!storage) return [];
    const rawValue = storage.getItem(STOP_REQUEST_STORAGE_KEY);
    const parsed = rawValue ? JSON.parse(rawValue) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function writeStopRequests(entries = []) {
  try {
    const storage = globalThis?.localStorage;
    if (!storage) return;
    storage.setItem(STOP_REQUEST_STORAGE_KEY, JSON.stringify(entries));
  } catch {}
}

export function isFreshStopRequest(entry = {}, timestamp = nowMs()) {
  return Number(timestamp || 0) - Number(entry?.timestamp || 0) <= STOP_REQUEST_TTL_MS;
}

export function rememberStopRequestedEvent(rawEvent = {}) {
  const event = normalizeSessionRunEvent({
    ...rawEvent,
    type: SESSION_RUN_EVENT.LOCAL_STOP_REQUESTED,
    state: SESSION_RUN_STATE.STOP_REQUESTED,
  });
  if (!event.sessionId) return event;
  const entries = readStopRequests().filter((entry) => {
    if (!isFreshStopRequest(entry, event.timestamp)) return false;
    if (trim(entry.sessionId) !== event.sessionId) return true;
    const entryDialogProcessId = trim(entry.dialogProcessId);
    return Boolean(entryDialogProcessId && event.dialogProcessId && entryDialogProcessId !== event.dialogProcessId);
  });
  entries.push({
    sessionId: event.sessionId,
    dialogProcessId: event.dialogProcessId,
    turnScopeId: event.turnScopeId,
    seq: event.seq,
    timestamp: event.timestamp,
  });
  writeStopRequests(entries);
  return event;
}

export function resolveRememberedStopRequestedEvent({ sessionId = "", dialogProcessId = "", turnScopeId = "" } = {}) {
  const normalizedSessionId = trim(sessionId);
  const normalizedDialogProcessId = trim(dialogProcessId);
  const normalizedTurnScopeId = trim(turnScopeId);
  if (!normalizedSessionId) return null;
  const timestamp = nowMs();
  const entries = readStopRequests();
  const freshEntries = entries.filter((entry) => isFreshStopRequest(entry, timestamp));
  if (freshEntries.length !== entries.length) writeStopRequests(freshEntries);
  if (!normalizedTurnScopeId) return null;
  const match = freshEntries.find((entry) => {
    if (trim(entry.sessionId) !== normalizedSessionId) return false;
    const entryTurnScopeId = trim(entry.turnScopeId);
    return Boolean(entryTurnScopeId && entryTurnScopeId === normalizedTurnScopeId);
  });
  if (!match) return null;
  return normalizeSessionRunEvent({
    type: SESSION_RUN_EVENT.LOCAL_STOP_REQUESTED,
    state: SESSION_RUN_STATE.STOP_REQUESTED,
    sessionId: normalizedSessionId,
    dialogProcessId: normalizedDialogProcessId || trim(match.dialogProcessId),
    turnScopeId: trim(match.turnScopeId),
    seq: Number(match.seq || 0),
    timestamp: Number(match.timestamp || timestamp),
    source: "remembered_stop_request",
  });
}

export function clearRememberedStopRequests({ sessionId = "", dialogProcessId = "", turnScopeId = "" } = {}) {
  const normalizedSessionId = trim(sessionId);
  const normalizedDialogProcessId = trim(dialogProcessId);
  const normalizedTurnScopeId = trim(turnScopeId);
  if (!normalizedSessionId) return;
  const entries = readStopRequests().filter((entry) => {
    if (trim(entry.sessionId) !== normalizedSessionId) return true;
    const entryTurnScopeId = trim(entry.turnScopeId);
    if (normalizedTurnScopeId || entryTurnScopeId) {
      return !(normalizedTurnScopeId && entryTurnScopeId && normalizedTurnScopeId === entryTurnScopeId);
    }
    const entryDialogProcessId = trim(entry.dialogProcessId);
    if (!normalizedDialogProcessId || !entryDialogProcessId) return false;
    return entryDialogProcessId !== normalizedDialogProcessId;
  });
  writeStopRequests(entries);
}
