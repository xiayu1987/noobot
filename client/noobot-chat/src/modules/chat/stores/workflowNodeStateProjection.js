/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  compareWorkflowRuntimeFacts,
  isWorkflowNodeTerminalStatus,
  WORKFLOW_SEQUENCE_DOMAIN,
} from "@noobot/event-protocol/workflow-runtime-event";

function supersedesCurrentFact(current, incoming) {
  if (!current) return true;
  const comparison = compareWorkflowRuntimeFacts(incoming, current);
  if (!comparison.comparable) return false;
  if (comparison.order !== 0) return comparison.order > 0;
  return incoming.eventId === current.eventId;
}

function terminalStateImmutable(current, incomingStatus) {
  return Boolean(
    current && isWorkflowNodeTerminalStatus(current.status) && incomingStatus !== current.status,
  );
}

export function evaluateWorkflowNodeStateGate({ eventData, current }) {
  if (eventData.sequenceDomain !== WORKFLOW_SEQUENCE_DOMAIN.NODE_STATE) {
    return { admitted: false, result: { applied: false, reason: "sequence_domain_mismatch" } };
  }
  if (terminalStateImmutable(current, eventData.status)) {
    return {
      admitted: false,
      result: { applied: false, reason: "terminal_state_immutable", current },
    };
  }
  if (!supersedesCurrentFact(current, eventData)) {
    return {
      admitted: false,
      result: { applied: false, reason: "stale", current },
      logStale: true,
    };
  }
  return { admitted: true };
}

export function buildWorkflowPlanningHeader({ currentWorkflow, eventData }) {
  return {
    ...currentWorkflow,
    workflowRunId: eventData.workflowRunId,
    sessionId: eventData.authoritySessionId,
    dialogProcessId: eventData.dialogProcessId,
    turnScopeId: eventData.turnScopeId,
    presentationMessageId: eventData.presentationMessageId,
    semanticText: eventData.semanticText,
    workflowPayload: eventData.workflowPayload,
  };
}

export function buildPlannedNodeStateEvent({ nodeSession, eventData }) {
  return {
    ...nodeSession,
    authoritySessionId: eventData.authoritySessionId,
    workflowRunId: eventData.workflowRunId,
    sequenceDomain: WORKFLOW_SEQUENCE_DOMAIN.NODE_STATE,
  };
}
