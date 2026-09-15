/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { logWorkflowDiagnostics } from "../../debug/loggers/workflowDiagnosticsLogger.js";
import {
  resolveSessionTurnRuntime,
  selectSessionTurnRuntime,
  selectTurnMessageRuntime,
} from "../runtime/run-state-machine/turnRuntimeRegistry.js";
import { projectTurnRuntimeToMessages } from "../runtime/engine/turnProjectionStore.js";
import { buildSubSessionContainerIdentity } from "./subSessionEventProjection.js";
import {
  createSubSessionEventOperations,
  createSubSessionMessageRegistry,
} from "./subSessionEventOperations.js";

export { createSubSessionMessageRegistry };

function text(value) {
  return String(value || "").trim();
}

function buildSubSessionProjection({ session, turnRuntime, workflowNodeState }) {
  const sequenceByDomain = {
    ...(session.sequenceByDomain || {}),
    ...(workflowNodeState?.sequenceDomain && Number(workflowNodeState?.sequence) > 0
      ? { [workflowNodeState.sequenceDomain]: Number(workflowNodeState.sequence) }
      : {}),
  };
  return {
    ...session,
    sequenceByDomain,
    turnRuntime,
    workflowNodeState,
    status: turnRuntime?.terminal || turnRuntime?.displayState || "",
    turnTimings: undefined,
  };
}

function logSubSessionProjection({ id, session, projection, turnRuntime, workflowNodeState }) {
  logWorkflowDiagnostics("frontend.workflowSubSession.selectedProjection", () => ({
    sessionId: id,
    turnScopeId: text(session?.turnScopeId),
    messageCount: projection.messages.length,
    messages: projection.messages.map((message = {}) => ({
      messageId: text(message?.messageId || message?.id),
      role: text(message?.role),
      pending: message?.pending,
      contentLength: String(message?.content || "").length,
    })),
    turnRuntimeState: text(turnRuntime?.state || turnRuntime?.displayState),
    workflowNodeStatus: text(workflowNodeState?.status),
  }));
}

export function createSubSessionStore({
  subSessionMessageRegistry,
  subSessionMessageRegistryVersion,
  turnRuntimeRegistry,
  selectWorkflowNodeState = null,
  applyTurnLifecycleSnapshot = null,
  applyTurnTimingSnapshot = null,
}) {
  function ensureSubSessionMessageContainer(eventData = {}) {
    const sessionId = text(eventData?.sessionId || eventData?.subSessionId);
    if (!sessionId) return { applied: false, reason: "missing_session" };
    const registry = subSessionMessageRegistry.value || createSubSessionMessageRegistry();
    registry.sessions = registry.sessions || {};
    const currentSession = registry.sessions[sessionId] || {
      id: sessionId,
      sessionId,
      messages: [],
      eventsById: {},
      sequence: 0,
    };
    const nextSession = {
      ...currentSession,
      id: sessionId,
      sessionId,
      ...buildSubSessionContainerIdentity(eventData, currentSession),
    };
    registry.sessions[sessionId] = nextSession;
    subSessionMessageRegistry.value = { ...registry, sessions: { ...registry.sessions } };
    if (subSessionMessageRegistryVersion) subSessionMessageRegistryVersion.value += 1;
    logWorkflowDiagnostics("frontend.workflowSubSession.messageContainerEnsured", () => ({
      sessionId: nextSession.parentSessionId || sessionId,
      childSessionId: sessionId,
      parentSessionId: nextSession.parentSessionId,
      dialogProcessId: nextSession.dialogProcessId,
      turnScopeId: nextSession.turnScopeId,
      workflowRunId: nextSession.workflowRunId,
      nodeExecutionId: nextSession.nodeExecutionId,
    }));
    return { applied: true, session: nextSession };
  }

  function applyTurnRuntimeMessageProjection(turn = {}) {
    const sessionId = text(turn?.sessionId);
    if (!sessionId) return { applied: false, patchedMessageCount: 0, reason: "missing_session" };
    const session = subSessionMessageRegistry.value?.sessions?.[sessionId] || null;
    if (!session) return { applied: false, patchedMessageCount: 0, reason: "session_not_found" };
    const stateSnapshot = selectTurnMessageRuntime(turnRuntimeRegistry?.value, {
      sessionId,
      turnScopeId: turn?.turnScopeId,
      dialogProcessId: turn?.dialogProcessId,
    });
    const result = projectTurnRuntimeToMessages({ session, stateSnapshot, turn });
    if (result.applied) {
      const registry = subSessionMessageRegistry.value || createSubSessionMessageRegistry();
      subSessionMessageRegistry.value = { ...registry, sessions: { ...(registry.sessions || {}) } };
      if (subSessionMessageRegistryVersion) subSessionMessageRegistryVersion.value += 1;
    }
    return result;
  }

  const { upsertSubSessionEvent, reduceSubSessionSnapshot } = createSubSessionEventOperations({
    subSessionMessageRegistry,
    subSessionMessageRegistryVersion,
    applyTurnLifecycleSnapshot,
    applyTurnTimingSnapshot,
  });

  function selectSubSessionMessages(sessionId = "") {
    const id = text(sessionId);
    if (!id) return null;
    const session = subSessionMessageRegistry.value?.sessions?.[id] || null;
    if (!session) return null;
    const hasAuthoritativeTurn = Boolean(
      resolveSessionTurnRuntime(turnRuntimeRegistry?.value, id, session.turnScopeId),
    );
    const turnRuntime = hasAuthoritativeTurn
      ? selectSessionTurnRuntime(turnRuntimeRegistry?.value, id, session.turnScopeId)
      : null;
    const workflowNodeState =
      typeof selectWorkflowNodeState === "function"
        ? selectWorkflowNodeState(id, session.turnScopeId)
        : null;
    const projection = buildSubSessionProjection({ session, turnRuntime, workflowNodeState });
    logSubSessionProjection({ id, session, projection, turnRuntime, workflowNodeState });
    return projection;
  }

  function selectSubSessionTurnRuntime(sessionId = "", turnScopeId = "") {
    const id = text(sessionId);
    if (!id) return null;
    const session = subSessionMessageRegistry.value?.sessions?.[id];
    if (!session) return null;
    const scope = turnScopeId || session.turnScopeId;
    return resolveSessionTurnRuntime(turnRuntimeRegistry?.value, id, scope)
      ? selectSessionTurnRuntime(turnRuntimeRegistry?.value, id, scope)
      : null;
  }

  function removeSubSessionsByWorkflowRunIds(workflowRunIds = [], { parentSessionId = "" } = {}) {
    const owners = new Set(
      (Array.isArray(workflowRunIds) ? workflowRunIds : []).map(text).filter(Boolean),
    );
    if (!owners.size) return { removedSessionIds: [] };
    const expectedParentSessionId = text(parentSessionId);
    const registry = subSessionMessageRegistry.value || createSubSessionMessageRegistry();
    const sessions = { ...(registry.sessions || {}) };
    const removedSessionIds = [];
    for (const [sessionId, session = {}] of Object.entries(sessions)) {
      if (!owners.has(text(session.workflowRunId))) continue;
      if (expectedParentSessionId && text(session.parentSessionId) !== expectedParentSessionId)
        continue;
      delete sessions[sessionId];
      removedSessionIds.push(sessionId);
    }
    if (removedSessionIds.length) {
      subSessionMessageRegistry.value = { ...registry, sessions };
      if (subSessionMessageRegistryVersion) subSessionMessageRegistryVersion.value += 1;
    }
    return { removedSessionIds };
  }

  return {
    ensureSubSessionMessageContainer,
    applyTurnRuntimeMessageProjection,
    reduceSubSessionMessageEvent: upsertSubSessionEvent,
    reduceSubSessionSnapshot,
    selectSubSessionMessages,
    selectSubSessionTurnRuntime,
    removeSubSessionsByWorkflowRunIds,
  };
}
