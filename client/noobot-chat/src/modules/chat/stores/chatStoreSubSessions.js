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
import { createSubSessionEventOperations } from "./subSessionEventOperations.js";
import { createEmptySubSession } from "./subSessionRegistry.js";

function buildSubSessionProjection({ session, turnRuntime, workflowNodeState }) {
  return {
    ...session,
    turnRuntime,
    workflowNodeState,
    status: turnRuntime?.terminal || turnRuntime?.displayState || "",
    turnTimings: undefined,
  };
}

function logSubSessionProjection({ id, session, projection, turnRuntime, workflowNodeState }) {
  logWorkflowDiagnostics("frontend.workflowSubSession.selectedProjection", () => ({
    sessionId: id,
    turnScopeId: session.turnScopeId,
    messageCount: projection.messages.length,
    messages: projection.messages.map((message) => ({
      messageUid: message.messageUid,
      role: message.role,
      pending: message.pending,
    })),
    turnRuntimeState: turnRuntime?.state,
    workflowNodeStatus: workflowNodeState?.status,
  }));
}

export function createSubSessionStore({
  subSessionMessageRegistry,
  subSessionMessageRegistryVersion,
  turnRuntimeRegistry,
  selectWorkflowNodeState,
  applyTurnLifecycleSnapshot,
  applyTurnTimingSnapshot,
}) {
  function ensureSubSessionMessageContainer(ownership) {
    const { sessionId } = ownership;
    const registry = subSessionMessageRegistry.value;
    const currentSession = registry.sessions[sessionId] || createEmptySubSession(sessionId);
    const nextSession = { ...currentSession, ...ownership };
    registry.sessions[sessionId] = nextSession;
    subSessionMessageRegistry.value = { ...registry, sessions: { ...registry.sessions } };
    subSessionMessageRegistryVersion.value += 1;
    logWorkflowDiagnostics("frontend.workflowSubSession.messageContainerEnsured", () => ({
      sessionId: nextSession.parentSessionId,
      childSessionId: sessionId,
      parentSessionId: nextSession.parentSessionId,
      dialogProcessId: nextSession.dialogProcessId,
      turnScopeId: nextSession.turnScopeId,
      workflowRunId: nextSession.workflowRunId,
      nodeExecutionId: nextSession.nodeExecutionId,
    }));
    return { applied: true, session: nextSession };
  }

  function applyTurnRuntimeMessageProjection(turn) {
    const { sessionId } = turn;
    const session = subSessionMessageRegistry.value.sessions[sessionId];
    if (!session) return { applied: false, patchedMessageCount: 0, reason: "session_not_found" };
    const stateSnapshot = selectTurnMessageRuntime(turnRuntimeRegistry.value, {
      sessionId,
      turnScopeId: turn.turnScopeId,
      dialogProcessId: turn.dialogProcessId,
    });
    const result = projectTurnRuntimeToMessages({ session, stateSnapshot, turn });
    if (result.applied) {
      const registry = subSessionMessageRegistry.value;
      subSessionMessageRegistry.value = { ...registry, sessions: { ...registry.sessions } };
      subSessionMessageRegistryVersion.value += 1;
    }
    return result;
  }

  const { upsertSubSessionEvent, reduceSubSessionSnapshot } = createSubSessionEventOperations({
    subSessionMessageRegistry,
    subSessionMessageRegistryVersion,
    applyTurnLifecycleSnapshot,
    applyTurnTimingSnapshot,
  });

  function selectSubSessionMessages(id) {
    const session = subSessionMessageRegistry.value.sessions[id];
    if (!session) return null;
    const turnRuntime = resolveSessionTurnRuntime(
      turnRuntimeRegistry.value,
      id,
      session.turnScopeId,
    )
      ? selectSessionTurnRuntime(turnRuntimeRegistry.value, id, session.turnScopeId)
      : null;
    const workflowNodeState = selectWorkflowNodeState(id, session.turnScopeId);
    const projection = buildSubSessionProjection({ session, turnRuntime, workflowNodeState });
    logSubSessionProjection({ id, session, projection, turnRuntime, workflowNodeState });
    return projection;
  }

  function removeSubSessionsByWorkflowRunIds(workflowRunIds, { parentSessionId }) {
    const owners = new Set(workflowRunIds);
    if (!owners.size) return { removedSessionIds: [] };
    const registry = subSessionMessageRegistry.value;
    const sessions = { ...registry.sessions };
    const removedSessionIds = [];
    for (const [sessionId, session] of Object.entries(sessions)) {
      if (!owners.has(session.workflowRunId)) continue;
      if (session.parentSessionId !== parentSessionId) continue;
      delete sessions[sessionId];
      removedSessionIds.push(sessionId);
    }
    if (removedSessionIds.length) {
      subSessionMessageRegistry.value = { ...registry, sessions };
      subSessionMessageRegistryVersion.value += 1;
    }
    return { removedSessionIds };
  }

  return {
    ensureSubSessionMessageContainer,
    applyTurnRuntimeMessageProjection,
    reduceSubSessionMessageEvent: upsertSubSessionEvent,
    reduceSubSessionSnapshot,
    selectSubSessionMessages,
    removeSubSessionsByWorkflowRunIds,
  };
}
