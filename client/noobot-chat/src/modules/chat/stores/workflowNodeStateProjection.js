/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  compareWorkflowRuntimeFacts,
  WORKFLOW_SEQUENCE_DOMAIN,
} from "@noobot/event-protocol/workflow-runtime-event";

const text = (value) => String(value || "").trim();
const field = (source, key) => text(source?.[key]);
const textOr = (value, fallback) => text(value) || fallback;
const numberOr = (value, fallback) => Number(value || fallback);
const preferText = (primary, fallback, key) => text(primary?.[key] || fallback?.[key]);
const preferNumber = (primary, fallback, key) => Number(primary?.[key] ?? fallback?.[key] ?? 0);
const resolveNodeStatus = (primary, fallback) =>
  text(primary?.status || primary?.stepStatus || fallback?.status || fallback?.stepStatus);

const WORKFLOW_NODE_TERMINAL_STATUSES = new Set([
  "succeeded",
  "completed",
  "failed",
  "cancelled",
  "canceled",
  "stopped",
  "aborted",
  "error",
  "expired",
  "timeout",
]);

export function isWorkflowNodeTerminalStatus(value) {
  return WORKFLOW_NODE_TERMINAL_STATUSES.has(text(value).toLowerCase());
}

export function shouldApplyWorkflowNodeStateEvent(current, incoming) {
  if (!current) return true;
  const c = compareWorkflowRuntimeFacts(incoming, current, {
    defaultDomain: WORKFLOW_SEQUENCE_DOMAIN.NODE_STATE,
  });
  if (!c.comparable) return false;
  if (c.order !== 0) return c.order > 0;
  return text(incoming.eventId) === text(current.eventId);
}

function terminalStateImmutable(current, currentStatus, incomingStatus) {
  return Boolean(
    current &&
      isWorkflowNodeTerminalStatus(currentStatus) &&
      incomingStatus &&
      incomingStatus !== currentStatus,
  );
}

export function evaluateWorkflowNodeStateGate({ eventData = {}, current = null, sequenceDomain }) {
  if (sequenceDomain !== WORKFLOW_SEQUENCE_DOMAIN.NODE_STATE) {
    return { admitted: false, result: { applied: false, reason: "sequence_domain_mismatch" } };
  }
  const currentStatus = text(current?.status).toLowerCase();
  const incomingStatus = text(eventData?.status || eventData?.stepStatus).toLowerCase();
  if (terminalStateImmutable(current, currentStatus, incomingStatus)) {
    return {
      admitted: false,
      result: { applied: false, reason: "terminal_state_immutable", current },
    };
  }
  if (!shouldApplyWorkflowNodeStateEvent(current, eventData)) {
    return { admitted: false, result: { applied: false, reason: "stale", current }, logStale: true };
  }
  return { admitted: true };
}

export function buildNextWorkflowNodeFact({
  eventData = {},
  current = null,
  workflowRunId,
  nodeExecutionId,
  sequenceDomain,
}) {
  const { stepStatus: _incomingStepStatus, ...incomingFact } = eventData || {};
  const { stepStatus: _currentStepStatus, ...currentFact } = current || {};
  return {
    ...currentFact,
    ...incomingFact,
    workflowRunId,
    nodeExecutionId,
    commandId: preferText(eventData, current, "commandId"),
    nodeSessionId: preferText(eventData, current, "nodeSessionId"),
    authoritySessionId: preferText(eventData, current, "authoritySessionId"),
    dialogProcessId: preferText(eventData, current, "dialogProcessId"),
    turnScopeId: preferText(eventData, current, "turnScopeId"),
    status: resolveNodeStatus(eventData, current),
    eventId: preferText(eventData, current, "eventId"),
    revision: preferNumber(eventData, current, "revision"),
    sequence: preferNumber(eventData, current, "sequence"),
    sequenceDomain,
  };
}

export function buildWorkflowPlanningHeader({ currentWorkflow = {}, eventData = {}, workflowRunId, workflowPayload }) {
  return {
    ...currentWorkflow,
    workflowRunId,
    sessionId: text(currentWorkflow.sessionId || eventData?.authoritySessionId),
    dialogProcessId: text(currentWorkflow.dialogProcessId || eventData?.dialogProcessId),
    turnScopeId: text(currentWorkflow.turnScopeId || eventData?.turnScopeId),
    presentationMessageId: text(
      currentWorkflow.presentationMessageId || eventData?.presentationMessageId,
    ),
    semanticText: text(eventData?.semanticText || currentWorkflow.semanticText),
    workflowPayload,
    plannedAt: eventData?.createdAt || currentWorkflow.plannedAt || new Date().toISOString(),
  };
}

export function buildPlannedNodeStateEvent({ nodeSession = {}, eventData = {}, workflowRunId, index }) {
  const nodeExecutionId = field(nodeSession, "nodeExecutionId");
  return {
    ...(nodeSession || {}),
    nodeSessionId: field(nodeSession, "nodeSessionId"),
    authoritySessionId: field(eventData, "authoritySessionId"),
    workflowRunId: textOr(field(nodeSession, "workflowRunId"), workflowRunId),
    nodeExecutionId,
    status: resolveNodeStatus(nodeSession, null),
    revision: numberOr(nodeSession?.revision, 1),
    sequence: numberOr(nodeSession?.sequence, index + 1),
    eventId: textOr(field(nodeSession, "eventId"), `workflow-plan:${nodeExecutionId}`),
    sequenceDomain: textOr(
      field(nodeSession, "sequenceDomain"),
      WORKFLOW_SEQUENCE_DOMAIN.NODE_STATE,
    ),
  };
}

export function resolvePlanningPayload(eventData = {}) {
  const candidate = eventData?.workflowPayload;
  const valid = candidate && typeof candidate === "object" && !Array.isArray(candidate);
  return valid ? candidate : null;
}
