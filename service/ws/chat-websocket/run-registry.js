/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { TIME_THRESHOLDS } from "@noobot/shared/time-thresholds";

const PENDING_STOP_TTL_MS = TIME_THRESHOLDS.agent.pendingStopTtlMs;

const activeRunRegistry = new Map();
const pendingStopRegistry = new Map();
let nextTransportBindingId = 0;

export function normalizeRunIdentityPart(value = "") {
  return String(value || "").trim();
}

export function buildRunRegistryKeys({ userId = "", sessionId = "", turnScopeId = "", dialogProcessId = "" } = {}) {
  const normalizedUserId = normalizeRunIdentityPart(userId);
  const normalizedSessionId = normalizeRunIdentityPart(sessionId);
  const normalizedTurnScopeId = normalizeRunIdentityPart(turnScopeId);
  const normalizedDialogProcessId = normalizeRunIdentityPart(dialogProcessId);
  const keys = [];
  const owner = normalizedUserId ? `user:${normalizedUserId}:` : "";
  if (normalizedSessionId && normalizedTurnScopeId) keys.push(`${owner}session:${normalizedSessionId}:turn:${normalizedTurnScopeId}`);
  if (normalizedSessionId && normalizedDialogProcessId) keys.push(`${owner}session:${normalizedSessionId}:dialog:${normalizedDialogProcessId}`);
  if (normalizedDialogProcessId) keys.push(`${owner}dialog:${normalizedDialogProcessId}`);
  return [...new Set(keys)];
}

export function registerActiveRun(handle = {}) {
  const keys = buildRunRegistryKeys(handle);
  handle.registryKeys = [...new Set([...(handle.registryKeys || []), ...keys])];
  for (const key of keys) activeRunRegistry.set(key, handle);
  return handle;
}

export function attachRunTransport(handle = {}, send = null) {
  if (!handle || typeof send !== "function") return null;
  const binding = Object.freeze({ id: ++nextTransportBindingId, send });
  handle.transportBinding = binding;
  return binding;
}

export function detachRunTransport(handle = {}, binding = null) {
  if (!handle || !binding || handle.transportBinding !== binding) return false;
  handle.transportBinding = null;
  return true;
}

export function isRunTransportAttached(handle = {}, binding = null) {
  return Boolean(handle && binding && handle.transportBinding === binding);
}

export function publishRunEvent(handle = {}, eventName, data = {}) {
  const binding = handle?.transportBinding;
  if (!binding || typeof binding.send !== "function") return false;
  binding.send(eventName, data);
  return true;
}

export function unregisterActiveRun(handle = {}) {
  for (const key of handle.registryKeys || []) {
    if (activeRunRegistry.get(key) === handle) activeRunRegistry.delete(key);
  }
  handle.registryKeys = [];
}

export function findActiveRun(identity = {}) {
  for (const key of buildRunRegistryKeys(identity)) {
    const handle = activeRunRegistry.get(key);
    if (handle) return handle;
  }
  return null;
}

export function rememberPendingStop(identity = {}, stopPayload = {}) {
  const expiresAtMs = Date.now() + PENDING_STOP_TTL_MS;
  for (const key of buildRunRegistryKeys(identity)) {
    const previousEntry = pendingStopRegistry.get(key);
    if (previousEntry?.timer) clearTimeout(previousEntry.timer);
    const timer = setTimeout(() => {
      const currentEntry = pendingStopRegistry.get(key);
      if (currentEntry?.expiresAtMs === expiresAtMs) pendingStopRegistry.delete(key);
    }, PENDING_STOP_TTL_MS);
    timer?.unref?.();
    pendingStopRegistry.set(key, { payload: stopPayload, expiresAtMs, timer });
  }
}

function deletePendingStopKeys(keys = []) {
  for (const key of keys) {
    const entry = pendingStopRegistry.get(key);
    if (entry?.timer) clearTimeout(entry.timer);
    pendingStopRegistry.delete(key);
  }
}

export function consumePendingStop(identity = {}) {
  const nowMs = Date.now();
  for (const key of buildRunRegistryKeys(identity)) {
    const entry = pendingStopRegistry.get(key);
    if (!entry) continue;
    if (Number(entry?.expiresAtMs || 0) <= nowMs) {
      deletePendingStopKeys([key]);
      continue;
    }
    if (entry?.payload) {
      deletePendingStopKeys(buildRunRegistryKeys(identity));
      return entry.payload;
    }
  }
  return null;
}
