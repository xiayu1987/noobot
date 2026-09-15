/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { WORKFLOW_RUNTIME_EVENT } from "@noobot/event-protocol/workflow-runtime-event";
import { EVENT_FAMILY, validateProtocolEvent } from "@noobot/event-protocol";
import { logWorkflowDiagnostics } from "../../debug/loggers/workflowDiagnosticsLogger.js";
import {
  createWorkflowEventOperations,
  createWorkflowNodeStateRegistry,
} from "./workflowEventOperations.js";

export { createWorkflowNodeStateRegistry };

const text = (value) => String(value || "").trim();
function summarizeWorkflowRuntimeCanonical(canonical = {}, source = "unknown") {
  return {
    sessionId: text(canonical?.identity?.sessionId),
    dialogProcessId: text(canonical?.payload?.dialogProcessId),
    turnScopeId: text(canonical?.identity?.turnScopeId),
    workflowRunId: text(canonical?.payload?.workflowRunId),
    nodeExecutionId: text(canonical?.payload?.nodeExecutionId),
    source,
    runtimeEvent: text(canonical?.identity?.eventType),
    sequenceDomain: text(canonical?.ordering?.domain),
    authoritativeSequence: Number(canonical?.ordering?.sequence || 0),
  };
}
export function createWorkflowStore({
  workflowNodeStateRegistry,
  ensureSubSessionMessageContainer,
  reduceSubSessionSnapshot,
  removeSubSessionsByWorkflowRunIds,
}) {
  const { upsertWorkflowNodeStateEvent, upsertWorkflowPlanningEvent } =
    createWorkflowEventOperations({
      workflowNodeStateRegistry,
      ensureSubSessionMessageContainer,
    });
  function selectWorkflowNodeState(sessionId = "", turnScopeId = "") {
    const requestedSessionId = text(sessionId);
    const requestedTurnScopeId = text(turnScopeId);
    if (!requestedSessionId && !requestedTurnScopeId) return null;
    const workflows = workflowNodeStateRegistry.value?.workflows || {};
    const candidates = Object.values(workflows)
      .flatMap((workflow = {}) => Object.values(workflow.nodes || {}))
      .filter((node = {}) => {
        const nodeSessionId = text(node.nodeSessionId);
        const nodeTurnScopeId = text(node.turnScopeId);
        return (
          (!requestedSessionId || nodeSessionId === requestedSessionId) &&
          (!requestedTurnScopeId || nodeTurnScopeId === requestedTurnScopeId)
        );
      });
    return (
      candidates.sort((left, right) => {
        const sequenceDelta = Number(right.sequence || 0) - Number(left.sequence || 0);
        if (sequenceDelta) return sequenceDelta;
        return Number(right.revision || 0) - Number(left.revision || 0);
      })[0] || null
    );
  }

  function applyWorkflowRuntimeEvent(record = {}, { source = "unknown" } = {}) {
    const validation = validateProtocolEvent(record);
    const canonical = record;
    if (!validation.valid || validation.descriptor?.family !== EVENT_FAMILY.WORKFLOW_RUNTIME) {
      const result = {
        applied: false,
        reason: validation.errors?.[0] || "invalid_runtime_event",
        canonical,
      };
      logWorkflowDiagnostics("frontend.workflowStore.runtimeEventRejected", () => ({
        ...summarizeWorkflowRuntimeCanonical(canonical, source),
        reason: result.reason,
      }));
      return result;
    }
    const eventType = canonical.identity.eventType;
    const data = {
      ...canonical.payload,
      authoritySessionId: canonical.identity.sessionId,
      eventId: canonical.identity.eventId,
      sequenceDomain: canonical.ordering.domain,
      sequence: canonical.ordering.sequence,
      revision: canonical.ordering.revision,
      aggregateVersion: canonical.ordering.aggregateVersion,
    };
    let result;
    if (eventType === WORKFLOW_RUNTIME_EVENT.PLANNING) {
      result = upsertWorkflowPlanningEvent(data);
    } else if (eventType === WORKFLOW_RUNTIME_EVENT.NODE_STATE) {
      result = upsertWorkflowNodeStateEvent(data);
    } else if (eventType === WORKFLOW_RUNTIME_EVENT.SESSION_SNAPSHOT) {
      result = reduceSubSessionSnapshot({
        ...data,
        sessionId: canonical.payload.nodeSessionId,
        parentSessionId: canonical.identity.sessionId,
      }, {
        source,
        eventId: canonical.identity.eventId,
        sequenceDomain: canonical.ordering.domain,
        authoritativeSequence: canonical.ordering.sequence,
      });
    } else {
      result = { applied: false, reason: "unsupported_event" };
    }
    logWorkflowDiagnostics("frontend.workflowStore.runtimeEventReduced", () => ({
      ...summarizeWorkflowRuntimeCanonical(canonical, source),
      applied: result?.applied === true,
      reason: text(result?.reason),
    }));
    return { ...(result || {}), canonical };
  }
  function removeWorkflowOwnersForReplacedTurns({
    parentSessionId = "",
    replacedTurnScopeIds = [],
  } = {}) {
    const expectedParentSessionId = text(parentSessionId);
    const replacedScopes = new Set(
      (Array.isArray(replacedTurnScopeIds) ? replacedTurnScopeIds : []).map(text).filter(Boolean),
    );
    if (!expectedParentSessionId || !replacedScopes.size) {
      return { removedWorkflowRunIds: [], removedSessionIds: [] };
    }
    const registry = workflowNodeStateRegistry.value || createWorkflowNodeStateRegistry();
    const workflows = { ...(registry.workflows || {}) };
    const removedWorkflowRunIds = [];
    for (const [workflowRunId, workflow = {}] of Object.entries(workflows)) {
      const ownsParent =
        text(workflow.sessionId) === expectedParentSessionId ||
        Object.values(workflow.nodes || {}).some(
          (node = {}) => text(node.parentSessionId) === expectedParentSessionId,
        );
      if (!ownsParent) continue;
      const ownsReplacedTurn = replacedScopes.has(text(workflow.turnScopeId));
      if (!ownsReplacedTurn) continue;
      delete workflows[workflowRunId];
      removedWorkflowRunIds.push(workflowRunId);
    }
    if (removedWorkflowRunIds.length) {
      workflowNodeStateRegistry.value = { ...registry, workflows };
    }
    const subSessionResult = removeSubSessionsByWorkflowRunIds?.(removedWorkflowRunIds, {
      parentSessionId: expectedParentSessionId,
    }) || { removedSessionIds: [] };
    logWorkflowDiagnostics("frontend.workflowStore.replacedOwnersRemoved", () => ({
      sessionId: expectedParentSessionId,
      replacedTurnScopeIds: [...replacedScopes],
      removedWorkflowRunIds,
      removedSessionIds: subSessionResult.removedSessionIds || [],
    }));
    return {
      removedWorkflowRunIds,
      removedSessionIds: subSessionResult.removedSessionIds || [],
    };
  }
  return {
    applyWorkflowRuntimeEvent,
    removeWorkflowOwnersForReplacedTurns,
    selectWorkflowNodeState,
  };
}
