/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

function normalizeOperationId(value = "") {
  return String(value || "").trim();
}

function normalizeSessionId(value = "") {
  return String(value || "").trim();
}

function createOperationId(type = "op") {
  const randomPart = Math.random().toString(36).slice(2, 10);
  return `${type}-${Date.now().toString(36)}-${randomPart}`;
}

/**
 * Keeps transient message operations outside the persisted session object.
 * Session data can now be replaced by backend snapshots without losing the
 * resend transaction state that must be reconciled after send finalization.
 */
export function createPendingMessageOperationStore() {
  const operationsById = new Map();
  const activeOperationIdsBySessionId = new Map();

  function registerOperation(operation = {}) {
    const sessionId = normalizeSessionId(operation.sessionId);
    if (!sessionId) return null;
    const type = normalizeOperationId(operation.type || "operation");
    const opId = normalizeOperationId(operation.opId) || createOperationId(type);
    const normalizedOperation = {
      ...operation,
      type,
      opId,
      sessionId,
      status: operation.status || "pending",
      createdAt: operation.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    operationsById.set(opId, normalizedOperation);
    activeOperationIdsBySessionId.set(sessionId, opId);
    return normalizedOperation;
  }

  function updateOperation(opId = "", patch = {}) {
    const normalizedOpId = normalizeOperationId(opId);
    const current = operationsById.get(normalizedOpId);
    if (!current) return null;
    const updated = {
      ...current,
      ...patch,
      opId: current.opId,
      sessionId: current.sessionId,
      updatedAt: new Date().toISOString(),
    };
    operationsById.set(normalizedOpId, updated);
    return updated;
  }

  function getOperation(opId = "") {
    return operationsById.get(normalizeOperationId(opId)) || null;
  }

  function getActiveOperation(sessionId = "", type = "") {
    const normalizedSessionId = normalizeSessionId(sessionId);
    const opId = activeOperationIdsBySessionId.get(normalizedSessionId);
    const operation = opId ? operationsById.get(opId) : null;
    if (!operation) return null;
    const normalizedType = normalizeOperationId(type);
    if (normalizedType && operation.type !== normalizedType) return null;
    return operation;
  }

  function getLatestOperation(type = "") {
    const normalizedType = normalizeOperationId(type);
    const operations = [...operationsById.values()]
      .filter((operation) => !normalizedType || operation.type === normalizedType)
      .sort((left, right) => String(right.updatedAt || "").localeCompare(String(left.updatedAt || "")));
    return operations[0] || null;
  }

  function completeOperation(opId = "") {
    const normalizedOpId = normalizeOperationId(opId);
    const operation = operationsById.get(normalizedOpId);
    if (!operation) return false;
    operationsById.delete(normalizedOpId);
    if (activeOperationIdsBySessionId.get(operation.sessionId) === normalizedOpId) {
      activeOperationIdsBySessionId.delete(operation.sessionId);
    }
    return true;
  }

  function clearSession(sessionId = "") {
    const operation = getActiveOperation(sessionId);
    if (!operation) return false;
    return completeOperation(operation.opId);
  }

  return {
    registerOperation,
    updateOperation,
    getOperation,
    getActiveOperation,
    getLatestOperation,
    completeOperation,
    clearSession,
  };
}
