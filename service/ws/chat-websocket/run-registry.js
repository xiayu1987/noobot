/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { text, isFunction } from "@noobot/shared/value";
import { createMessageUid } from "@noobot/session-protocol/message-identity";

const activeRunRegistry = new Map();
let nextRunHandleId = 0;
let nextTransportBindingId = 0;

function initializeInterjectionQueue(handle) {
  handle.userInterjectionQueue = [];
  handle.userInterjectionCommandIds = new Set();
  handle.userInterjectionQueueOpen = true;
  handle.userInterjectionConsumptionTail = Promise.resolve();
  handle.userInterjectionAcceptanceTail = Promise.resolve();
  handle.userInterjectionAcceptanceByCommandId = new Map();
  handle.userInterjectionPendingAcceptanceCount = 0;
  handle.userInterjectionSequence = 0;
}

function requireInterjectionQueue(handle) {
  const valid = [
    Array.isArray(handle.userInterjectionQueue),
    handle.userInterjectionCommandIds instanceof Set,
    typeof handle.userInterjectionQueueOpen === "boolean",
    handle.userInterjectionConsumptionTail instanceof Promise,
    handle.userInterjectionAcceptanceTail instanceof Promise,
    handle.userInterjectionAcceptanceByCommandId instanceof Map,
    Number.isSafeInteger(handle.userInterjectionPendingAcceptanceCount),
    handle.userInterjectionPendingAcceptanceCount >= 0,
    Number.isSafeInteger(handle.userInterjectionSequence),
    handle.userInterjectionSequence >= 0,
  ];
  if (!valid.every(Boolean)) throw new TypeError("invalid_run_interjection_state");
}

function normalizeRunIdentityPart(value = "") {
  return text(value);
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
    initializeInterjectionQueue(handle);
  }
  requireInterjectionQueue(handle);
  const keys = buildRunRegistryKeys(handle);
  handle.registryKeys = [...new Set([...(handle.registryKeys || []), ...keys])];
  for (const key of keys) activeRunRegistry.set(key, handle);
  return handle;
}

export function enqueueUserInterjection(handle = {}, interjection = {}, commitAuthority) {
  requireInterjectionQueue(handle);
  if (!handle.userInterjectionQueueOpen) {
    const error = new Error("active turn is stopping");
    error.code = "active_turn_stopping";
    throw error;
  }
  const commandId = normalizeRunIdentityPart(interjection.commandId);
  const message = text(interjection.message);
  if (!commandId || !message) throw new TypeError("invalid_user_interjection");
  if (!isFunction(commitAuthority)) {
    throw new TypeError("user interjection authority commit is required");
  }
  const pendingAcceptance = handle.userInterjectionAcceptanceByCommandId.get(commandId);
  if (pendingAcceptance) return pendingAcceptance.then(() => null);
  if (handle.userInterjectionCommandIds.has(commandId)) return Promise.resolve(null);
  const receivedAt = new Date().toISOString();
  handle.userInterjectionCommandIds.add(commandId);
  handle.userInterjectionPendingAcceptanceCount += 1;
  const acceptance = handle.userInterjectionAcceptanceTail.then(async () => {
    try {
      const interjectionSequence = handle.userInterjectionSequence + 1;
      const item = Object.freeze({
        commandId,
        messageUid: createMessageUid(),
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
  requireInterjectionQueue(handle);
  handle.userInterjectionQueueOpen = false;
}

export function sealUserInterjectionQueueIfEmpty(handle = {}) {
  requireInterjectionQueue(handle);
  if (!handle.userInterjectionQueueOpen) return true;
  if (handle.userInterjectionQueue.length || handle.userInterjectionPendingAcceptanceCount > 0) {
    return false;
  }
  handle.userInterjectionQueueOpen = false;
  return true;
}

export function consumeUserInterjections(handle = {}, consumer) {
  requireInterjectionQueue(handle);
  if (!isFunction(consumer)) {
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

export function attachRunTransport(handle, send, { onDiagnostic = null } = {}) {
  if (!handle || !isFunction(send)) throw new TypeError("run transport requires a handle and send");
  if (onDiagnostic !== null && !isFunction(onDiagnostic)) {
    throw new TypeError("run transport onDiagnostic must be a function or null");
  }
  const binding = Object.freeze({
    id: `run-transport-${++nextTransportBindingId}`,
    send,
    onDiagnostic,
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

export async function publishRunEvent(handle, eventName, data) {
  const binding = handle.transportBinding;
  const diagnostic = {
    eventName,
    runHandleId: text(handle?.runHandleId),
    bindingId: text(binding?.id),
    bindingCurrent: Boolean(binding && handle?.transportBinding === binding),
  };
  if (!binding) return false;
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

export function createExecutionLivenessInspector({ userId, sessionId, now }) {
  if (!isFunction(now)) {
    throw new TypeError("execution liveness inspector requires now function");
  }
  return ({ turnScopeId, dialogProcessId }) => ({
    alive: Boolean(findActiveRun({ userId, sessionId, turnScopeId, dialogProcessId })),
    observedAtMs: now(),
  });
}
