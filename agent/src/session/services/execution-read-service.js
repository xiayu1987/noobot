/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { buildExecutionTree, normalizeExecutionIdentity } from "@noobot/shared/execution-lifecycle-protocol";
import { deriveAuthoritativeTurnCapabilities } from "@noobot/shared/turn-lifecycle-protocol";
import { normalizeTurnLifecycleEntity, projectTurnLifecycleTiming } from "../entities/turn-lifecycle-entity.js";

const clean = (value) => String(value || "").trim();

function toExecutionProjection(turn = {}, session = {}) {
  const timedTurn = {
    ...projectTurnLifecycleTiming(turn, session.turnTimings),
    sessionId: clean(session.sessionId),
  };
  const identity = normalizeExecutionIdentity({
    ...timedTurn,
    sessionId: session.sessionId,
    parentSessionId: session.parentSessionId,
  });
  return {
    ...identity,
    commandId: clean(timedTurn.commandId),
    action: clean(timedTurn.action),
    state: clean(timedTurn.state),
    phase: clean(timedTurn.phase),
    executionState: clean(timedTurn.executionState).toLowerCase(),
    revision: Number(timedTurn.revision || 0),
    sequence: Number(timedTurn.sequence || 0),
    summaryVersion: Number(timedTurn.summaryVersion || 0),
    capabilities: deriveAuthoritativeTurnCapabilities(timedTurn),
    failure: timedTurn.failure && typeof timedTurn.failure === "object" ? { ...timedTurn.failure } : null,
    startedAt: clean(timedTurn.startedAt),
    finishedAt: clean(timedTurn.finishedAt),
    createdAt: clean(timedTurn.createdAt),
    updatedAt: clean(timedTurn.updatedAt),
  };
}

function isNewer(left, right) {
  const leftUpdatedAt = Date.parse(left?.updatedAt || "") || 0;
  const rightUpdatedAt = Date.parse(right?.updatedAt || "") || 0;
  if (leftUpdatedAt !== rightUpdatedAt) return leftUpdatedAt > rightUpdatedAt;
  if (Number(left?.revision || 0) !== Number(right?.revision || 0)) {
    return Number(left?.revision || 0) > Number(right?.revision || 0);
  }
  return Number(left?.sequence || 0) > Number(right?.sequence || 0);
}

function stableObject(value) {
  if (Array.isArray(value)) return value.map(stableObject);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableObject(value[key])]));
}

function executionOwnershipFingerprint(execution = {}) {
  return JSON.stringify(stableObject({
    executionKind: clean(execution.executionKind).toLowerCase(),
    sessionId: clean(execution.sessionId),
    parentSessionId: clean(execution.parentSessionId),
    turnScopeId: clean(execution.turnScopeId),
    parentExecutionId: clean(execution.parentExecutionId),
    rootExecutionId: clean(execution.rootExecutionId),
    origin: execution.origin && typeof execution.origin === "object" ? execution.origin : {},
  }));
}

export class ExecutionReadService {
  constructor({ sessionCrudService, now = () => new Date().toISOString() } = {}) {
    this.sessionCrudService = sessionCrudService;
    this.now = now;
    this.readIndexByUser = new Map();
  }

  _summaryFingerprint(summaries = []) {
    return JSON.stringify((Array.isArray(summaries) ? summaries : [])
      .map((item = {}) => ({
        sessionId: clean(item.sessionId),
        parentSessionId: clean(item.parentSessionId),
        updatedAt: clean(item.updatedAt),
      }))
      .filter((item) => item.sessionId)
      .sort((left, right) => left.sessionId.localeCompare(right.sessionId)));
  }

  async _readIndexFingerprint(userId) {
    if (typeof this.sessionCrudService?.getAllSessionSummaries !== "function") return null;
    const summaries = await this.sessionCrudService.getAllSessionSummaries({ userId });
    return this._summaryFingerprint(summaries);
  }

  invalidate(userId = "") {
    const normalizedUserId = clean(userId);
    if (normalizedUserId) this.readIndexByUser.delete(normalizedUserId);
    else this.readIndexByUser.clear();
  }

  async _scanAuthoritative(userId) {
    const sessions = await this.sessionCrudService.getAllSessionsData({ userId });
    const byId = new Map();
    const conflicts = new Map();
    for (const session of Array.isArray(sessions) ? sessions : []) {
      const lifecycle = normalizeTurnLifecycleEntity(session?.turnLifecycle || {});
      for (const turn of Object.values(lifecycle.turns)) {
        const execution = toExecutionProjection(turn, session);
        if (!execution.executionId) continue;
        const current = byId.get(execution.executionId);
        if (!current) {
          byId.set(execution.executionId, execution);
          continue;
        }
        if (executionOwnershipFingerprint(current) !== executionOwnershipFingerprint(execution)) {
          conflicts.set(execution.executionId, {
            executionId: execution.executionId,
            reason: "execution_identity_conflict",
            identities: [current, execution].map((item) => ({
              executionKind: item.executionKind,
              sessionId: item.sessionId,
              parentSessionId: item.parentSessionId,
              turnScopeId: item.turnScopeId,
              parentExecutionId: item.parentExecutionId,
              rootExecutionId: item.rootExecutionId,
              origin: item.origin,
            })),
          });
          byId.delete(execution.executionId);
          continue;
        }
        if (!conflicts.has(execution.executionId) && isNewer(execution, current)) byId.set(execution.executionId, execution);
      }
    }
    return { executions: [...byId.values()], conflicts };
  }

  async _readAll(userId) {
    const normalizedUserId = clean(userId);
    if (!normalizedUserId) return { executions: [], conflicts: new Map() };
    let fingerprint = null;
    try {
      fingerprint = await this._readIndexFingerprint(normalizedUserId);
      const indexed = this.readIndexByUser.get(normalizedUserId);
      if (fingerprint !== null && indexed?.fingerprint === fingerprint) return indexed.readModel;
    } catch {
      fingerprint = null;
    }
    const readModel = await this._scanAuthoritative(normalizedUserId);
    if (fingerprint !== null) {
      this.readIndexByUser.set(normalizedUserId, { fingerprint, readModel });
    }
    return readModel;
  }

  async getExecution({ userId, executionId } = {}) {
    const normalizedExecutionId = clean(executionId);
    if (!userId || !normalizedExecutionId) return { found: false, reason: "missing_execution" };
    const readModel = await this._readAll(userId);
    const conflict = readModel.conflicts.get(normalizedExecutionId);
    if (conflict) return { found: false, reason: conflict.reason, conflict };
    const execution = readModel.executions.find((item) => item.executionId === normalizedExecutionId);
    return execution
      ? { found: true, execution, generatedAt: this.now() }
      : { found: false, reason: "execution_not_found" };
  }

  async getExecutionChildren({ userId, executionId } = {}) {
    const result = await this.getExecutionTree({ userId, executionId });
    if (!result.found) return result;
    return {
      found: true,
      execution: result.execution,
      children: result.execution.childExecutionIds.map((id) => result.tree.executions[id]),
      generatedAt: result.generatedAt,
    };
  }

  async getExecutionTree({ userId, executionId = "", rootExecutionId = "" } = {}) {
    if (!userId) return { found: false, reason: "missing_user" };
    const readModel = await this._readAll(userId);
    const executions = readModel.executions;
    const requestedExecutionId = clean(executionId);
    const requestedRootId = clean(rootExecutionId);
    const requestedConflict = readModel.conflicts.get(requestedExecutionId || requestedRootId);
    if (requestedConflict) {
      return { found: false, reason: requestedConflict.reason, conflict: requestedConflict };
    }
    const selected = requestedExecutionId
      ? executions.find((item) => item.executionId === requestedExecutionId)
      : executions.find((item) => item.executionId === requestedRootId || item.rootExecutionId === requestedRootId);
    if ((requestedExecutionId || requestedRootId) && !selected) {
      return { found: false, reason: "execution_not_found" };
    }
    const rootId = requestedRootId || selected?.rootExecutionId || selected?.executionId || "";
    const scoped = rootId
      ? executions.filter((item) => item.executionId === rootId || item.rootExecutionId === rootId)
      : executions;
    const tree = buildExecutionTree(scoped);
    return {
      found: true,
      execution: requestedExecutionId ? tree.executions[requestedExecutionId] || null : tree.executions[rootId] || null,
      rootExecutionId: rootId,
      tree,
      generatedAt: this.now(),
    };
  }
}
