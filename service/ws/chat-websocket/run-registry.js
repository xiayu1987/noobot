/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
const activeRunRegistry = new Map();
let nextRunHandleId = 0;
let nextTransportBindingId = 0;

function initializeInterjectionQueue(handle) {
  if (!Array.isArray(handle.userInterjectionQueue)) handle.userInterjectionQueue = [];
  if (!(handle.userInterjectionCommandIds instanceof Set)) {
    handle.userInterjectionCommandIds = new Set();
  }
  if (typeof handle.userInterjectionQueueOpen !== "boolean") {
    handle.userInterjectionQueueOpen = true;
  }
  if (!handle.userInterjectionConsumptionTail) {
    handle.userInterjectionConsumptionTail = Promise.resolve();
  }
  if (!handle.userInterjectionAcceptanceTail) {
    handle.userInterjectionAcceptanceTail = Promise.resolve();
  }
  if (!(handle.userInterjectionAcceptanceByCommandId instanceof Map)) {
    handle.userInterjectionAcceptanceByCommandId = new Map();
  }
  if (!Number.isInteger(handle.userInterjectionPendingAcceptanceCount)) {
    handle.userInterjectionPendingAcceptanceCount = 0;
  }
  if (!Number.isInteger(handle.userInterjectionSequence)) {
    handle.userInterjectionSequence = 0;
  }
}

export function normalizeRunIdentityPart(value = "") {
  return String(value || "").trim();
}

export function buildRunRegistryKeys({
  userId = "",
  sessionId = "",
  turnScopeId = "",
  dialogProcessId = "",
} = {}) {
  const normalizedUserId = normalizeRunIdentityPart(userId);
  const normalizedSessionId = normalizeRunIdentityPart(sessionId);
  const normalizedTurnScopeId = normalizeRunIdentityPart(turnScopeId);
  const normalizedDialogProcessId = normalizeRunIdentityPart(dialogProcessId);
  const keys = [];
  const owner = normalizedUserId ? `user:${normalizedUserId}:` : "";
  if (normalizedSessionId && normalizedTurnScopeId)
    keys.push(`${owner}session:${normalizedSessionId}:turn:${normalizedTurnScopeId}`);
  if (normalizedSessionId && normalizedDialogProcessId)
    keys.push(`${owner}session:${normalizedSessionId}:dialog:${normalizedDialogProcessId}`);
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
  initializeInterjectionQueue(handle);
  const keys = buildRunRegistryKeys(handle);
  handle.registryKeys = [...new Set([...(handle.registryKeys || []), ...keys])];
  for (const key of keys) activeRunRegistry.set(key, handle);
  return handle;
}

export function enqueueUserInterjection(handle = {}, interjection = {}, commitAuthority) {
  initializeInterjectionQueue(handle);
  if (!handle.userInterjectionQueueOpen) {
    const error = new Error("active turn is stopping");
    error.code = "active_turn_stopping";
    throw error;
  }
  const commandId = normalizeRunIdentityPart(interjection.commandId);
  const message = String(interjection.message || "").trim();
  if (!commandId || !message) throw new TypeError("invalid_user_interjection");
  if (typeof commitAuthority !== "function") {
    throw new TypeError("user interjection authority commit is required");
  }
  const pendingAcceptance = handle.userInterjectionAcceptanceByCommandId.get(commandId);
  if (pendingAcceptance) return pendingAcceptance.then(() => null);
  if (handle.userInterjectionCommandIds.has(commandId)) return Promise.resolve(null);
  const receivedAt = String(interjection.receivedAt || new Date().toISOString());
  handle.userInterjectionCommandIds.add(commandId);
  handle.userInterjectionPendingAcceptanceCount += 1;
  const acceptance = handle.userInterjectionAcceptanceTail.then(async () => {
    try {
      const interjectionSequence = handle.userInterjectionSequence + 1;
      const item = Object.freeze({
        commandId,
        messageUid: `user-interjection:${commandId}`,
        message,
        receivedAt,
        interjectionSequence,
      });
      await commitAuthority(item);
      handle.userInterjectionSequence = interjectionSequence;
      handle.userInterjectionQueue.push(item);
      return item;
    } catch (error) {
      handle.userInterjectionCommandIds.delete(commandId);
      throw error;
    } finally {
      handle.userInterjectionPendingAcceptanceCount -= 1;
      handle.userInterjectionAcceptanceByCommandId.delete(commandId);
    }
  });
  handle.userInterjectionAcceptanceByCommandId.set(commandId, acceptance);
  handle.userInterjectionAcceptanceTail = acceptance.then(
    () => undefined,
    () => undefined,
  );
  return acceptance;
}

export function closeUserInterjectionQueue(handle = {}) {
  initializeInterjectionQueue(handle);
  handle.userInterjectionQueueOpen = false;
}

export function sealUserInterjectionQueueIfEmpty(handle = {}) {
  initializeInterjectionQueue(handle);
  if (!handle.userInterjectionQueueOpen) return true;
  if (handle.userInterjectionQueue.length || handle.userInterjectionPendingAcceptanceCount > 0) {
    return false;
  }
  handle.userInterjectionQueueOpen = false;
  return true;
}

export function consumeUserInterjections(handle = {}, consumer) {
  initializeInterjectionQueue(handle);
  if (typeof consumer !== "function") {
    return Promise.reject(new TypeError("user interjection consumer is required"));
  }
  const consume = async () => {
    await handle.userInterjectionAcceptanceTail;
    const batch = handle.userInterjectionQueue.slice();
    if (!batch.length) return [];
    await consumer(batch);
    const consumedIds = new Set(batch.map((item) => item.commandId));
    while (
      handle.userInterjectionQueue.length &&
      consumedIds.has(handle.userInterjectionQueue[0].commandId)
    ) {
      handle.userInterjectionQueue.shift();
    }
    return batch;
  };
  const result = handle.userInterjectionConsumptionTail.then(consume, consume);
  handle.userInterjectionConsumptionTail = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
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
    const delivered =
      (await binding.send(eventName, data, {
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
