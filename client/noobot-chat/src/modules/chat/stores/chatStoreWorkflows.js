/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { WORKFLOW_RUNTIME_EVENT } from "@noobot/event-protocol/workflow-runtime-event";
import { EVENT_FAMILY, validateProtocolEvent } from "@noobot/event-protocol";
import { logWorkflowDiagnostics } from "../../debug/loggers/workflowDiagnosticsLogger.js";
import { createWorkflowEventOperations } from "./workflowEventOperations.js";

function summarizeWorkflowRuntimeCanonical(canonical, source) {
  return {
    sessionId: canonical.identity?.sessionId,
    turnScopeId: canonical.identity?.turnScopeId,
    executionId: canonical.identity?.executionId,
    source,
    runtimeEvent: canonical.identity?.eventType,
    sequenceDomain: canonical.ordering?.domain,
    authoritativeSequence: canonical.ordering?.sequence,
  };
}

function mapSessionSnapshot(canonical, source) {
  const { identity, ordering, payload, occurredAt } = canonical;
  return {
    sessionId: payload.nodeSessionId,
    parentSessionId: identity.sessionId,
    dialogProcessId: payload.dialogProcessId,
    turnScopeId: identity.turnScopeId,
    workflowRunId: payload.workflowRunId,
    nodeExecutionId: payload.nodeExecutionId,
    messages: payload.messages,
    turnLifecycleSnapshot: payload.turnLifecycleSnapshot,
    turnTimings: payload.turnTimings,
    eventId: identity.eventId,
    aggregateVersion: ordering.aggregateVersion,
    occurredAt,
    source,
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
  function selectWorkflowNodeState(sessionId, turnScopeId) {
    const candidates = Object.values(workflowNodeStateRegistry.value.workflows)
      .flatMap((workflow) => Object.values(workflow.nodes))
      .filter((node) => node.nodeSessionId === sessionId && node.turnScopeId === turnScopeId);
    return (
      candidates.sort((left, right) => {
        const sequenceDelta = right.sequence - left.sequence;
        if (sequenceDelta) return sequenceDelta;
        return right.revision - left.revision;
      })[0] || null
    );
  }

  function rejectWorkflowRuntimeEvent(canonical, source, reason) {
    logWorkflowDiagnostics("frontend.workflowStore.runtimeEventRejected", () => ({
      ...summarizeWorkflowRuntimeCanonical(canonical, source),
      reason,
    }));
    return { applied: false, reason, canonical };
  }

  function applyWorkflowRuntimeEvent(canonical, { source }) {
    const validation = validateProtocolEvent(canonical);
    if (!validation.valid) {
      return rejectWorkflowRuntimeEvent(canonical, source, validation.errors[0]);
    }
    if (validation.descriptor.family !== EVENT_FAMILY.WORKFLOW_RUNTIME) {
      return rejectWorkflowRuntimeEvent(canonical, source, "event_family_mismatch");
    }
    const eventType = canonical.identity.eventType;
    let result;
    if (eventType === WORKFLOW_RUNTIME_EVENT.SESSION_SNAPSHOT) {
      result = reduceSubSessionSnapshot(mapSessionSnapshot(canonical, source));
      return finishWorkflowRuntimeEvent(canonical, source, result);
    }
    const data = {
      ...canonical.payload,
      authoritySessionId: canonical.identity.sessionId,
      eventId: canonical.identity.eventId,
      sequenceDomain: canonical.ordering.domain,
      sequence: canonical.ordering.sequence,
      revision: canonical.ordering.revision,
      aggregateVersion: canonical.ordering.aggregateVersion,
    };
    if (eventType === WORKFLOW_RUNTIME_EVENT.PLANNING) {
      result = upsertWorkflowPlanningEvent(data);
    } else if (eventType === WORKFLOW_RUNTIME_EVENT.NODE_STATE) {
      result = upsertWorkflowNodeStateEvent({
        ...data,
        nodeExecutionId: canonical.identity.executionId,
      });
    } else {
      result = { applied: false, reason: "unsupported_event" };
    }
    return finishWorkflowRuntimeEvent(canonical, source, result);
  }

  function finishWorkflowRuntimeEvent(canonical, source, result) {
    logWorkflowDiagnostics("frontend.workflowStore.runtimeEventReduced", () => ({
      ...summarizeWorkflowRuntimeCanonical(canonical, source),
      applied: result.applied,
      reason: result.reason,
    }));
    return { ...result, canonical };
  }
  function removeWorkflowOwnersForReplacedTurns({ parentSessionId, replacedTurnScopeIds }) {
    const expectedParentSessionId = parentSessionId;
    const replacedScopes = new Set(replacedTurnScopeIds);
    const registry = workflowNodeStateRegistry.value;
    const workflows = { ...registry.workflows };
    const removedWorkflowRunIds = [];
    for (const [workflowRunId, workflow] of Object.entries(workflows)) {
      const ownsParent =
        workflow.sessionId === expectedParentSessionId ||
        Object.values(workflow.nodes).some(
          (node) => node.authoritySessionId === expectedParentSessionId,
        );
      if (!ownsParent) continue;
      const ownsReplacedTurn = replacedScopes.has(workflow.turnScopeId);
      if (!ownsReplacedTurn) continue;
      delete workflows[workflowRunId];
      removedWorkflowRunIds.push(workflowRunId);
    }
    if (removedWorkflowRunIds.length) {
      workflowNodeStateRegistry.value = { ...registry, workflows };
    }
    const subSessionResult = removeSubSessionsByWorkflowRunIds(removedWorkflowRunIds, {
      parentSessionId: expectedParentSessionId,
    });
    logWorkflowDiagnostics("frontend.workflowStore.replacedOwnersRemoved", () => ({
      sessionId: expectedParentSessionId,
      replacedTurnScopeIds: [...replacedScopes],
      removedWorkflowRunIds,
      removedSessionIds: subSessionResult.removedSessionIds,
    }));
    return {
      removedWorkflowRunIds,
      removedSessionIds: subSessionResult.removedSessionIds,
    };
  }
  return {
    applyWorkflowRuntimeEvent,
    removeWorkflowOwnersForReplacedTurns,
    selectWorkflowNodeState,
  };
}
