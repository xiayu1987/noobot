/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
const activeRunRegistry = new Map();
let nextRunHandleId = 0;
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
  if (!normalizeRunIdentityPart(handle.runHandleId)) {
    Object.defineProperty(handle, "runHandleId", {
      value: `run-handle-${++nextRunHandleId}`,
      enumerable: true,
      configurable: false,
      writable: false,
    });
  }
  const keys = buildRunRegistryKeys(handle);
  handle.registryKeys = [...new Set([...(handle.registryKeys || []), ...keys])];
  for (const key of keys) activeRunRegistry.set(key, handle);
  return handle;
}

export function attachRunTransport(handle = {}, send = null, { onDiagnostic = null } = {}) {
  if (!handle || typeof send !== "function") return null;
  const binding = Object.freeze({
    id: `run-transport-${++nextTransportBindingId}`,
    send,
    onDiagnostic: typeof onDiagnostic === "function" ? onDiagnostic : null,
  });
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

export async function publishRunEvent(handle = {}, eventName, data = {}) {
  const binding = handle?.transportBinding;
  const diagnostic = {
    eventId: String(data?.event?.eventId || data?.eventId || "").trim(),
    eventType: String(data?.event?.eventType || data?.eventType || eventName || "").trim(),
    messageId: String(data?.event?.messageId || data?.messageId || "").trim(),
    presentationMessageId: String(
      data?.event?.presentationMessageId || data?.presentationMessageId || "",
    ).trim(),
    runHandleId: String(handle?.runHandleId || "").trim(),
    bindingId: String(binding?.id || "").trim(),
    bindingCurrent: Boolean(binding && handle?.transportBinding === binding),
  };
  if (!binding || typeof binding.send !== "function") return false;
  binding.onDiagnostic?.({ ...diagnostic, stage: "publish_started" });
  try {
    const delivered = (await binding.send(eventName, data, {
      runHandleId: diagnostic.runHandleId,
      bindingId: diagnostic.bindingId,
    })) === true;
    binding.onDiagnostic?.({
      ...diagnostic,
      stage: delivered ? "publish_completed" : "publish_rejected",
      bindingCurrent: handle?.transportBinding === binding,
    });
    return delivered;
  } catch (error) {
    binding.onDiagnostic?.({
      ...diagnostic,
      stage: "publish_failed",
      bindingCurrent: handle?.transportBinding === binding,
      error: error?.message || String(error || "transport_publish_failed"),
    });
    throw error;
  }
}

export function unregisterActiveRun(handle = {}) {
  for (const key of handle.registryKeys || []) {
    if (activeRunRegistry.get(key) === handle) activeRunRegistry.delete(key);
  }
  handle.registryKeys = [];
  handle.transportBinding = null;
}

export function findActiveRun(identity = {}) {
  for (const key of buildRunRegistryKeys(identity)) {
    const handle = activeRunRegistry.get(key);
    if (handle) return handle;
  }
  return null;
}
