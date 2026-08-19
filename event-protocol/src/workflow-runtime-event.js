/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { canonicalizeTurnScopeId } from "@noobot/session-protocol/turn-scope-identity";
import { validateTurnLifecycleSnapshot } from "@noobot/session-protocol";
import { createEventEnvelope } from "./envelope.js";

export const WORKFLOW_RUNTIME_EVENT = Object.freeze({
  PLANNING: "workflow_planning_message_prepared",
  NODE_STATE: "workflow_node_state_committed",
  SESSION_SNAPSHOT: "workflow_session_snapshot_loaded",
});

export const WORKFLOW_SEQUENCE_DOMAIN = Object.freeze({
  PLANNING: "workflow-planning",
  NODE_STATE: "workflow-node-state",
  SESSION_SNAPSHOT: "workflow-session-snapshot",
});

const text = (value) => String(value || "").trim();
const isRecord = (value) => Boolean(value && typeof value === "object" && !Array.isArray(value));

export function workflowSequenceDomainForEvent(eventType = "") {
  if (eventType === WORKFLOW_RUNTIME_EVENT.PLANNING) return WORKFLOW_SEQUENCE_DOMAIN.PLANNING;
  if (eventType === WORKFLOW_RUNTIME_EVENT.NODE_STATE) return WORKFLOW_SEQUENCE_DOMAIN.NODE_STATE;
  if (eventType === WORKFLOW_RUNTIME_EVENT.SESSION_SNAPSHOT)
    return WORKFLOW_SEQUENCE_DOMAIN.SESSION_SNAPSHOT;
  return "";
}

export function createWorkflowRuntimeEnvelope({
  eventType = "",
  authoritySessionId = "",
  turnScopeId = "",
  messageId = "",
  executionId = "",
  eventId = "",
  workflowRunId = "",
  sequence = 0,
  revision,
  aggregateVersion,
  occurredAt = "",
  producer = {},
  causality = {},
  payload = {},
} = {}) {
  const envelope = createEventEnvelope({
    family: "workflow.runtime",
    identity: {
      eventId: text(eventId),
      eventType: text(eventType),
      sessionId: text(authoritySessionId),
      turnScopeId: canonicalizeTurnScopeId(turnScopeId),
      messageId: text(messageId),
      executionId: text(executionId),
    },
    causality,
    ordering: {
      domain: workflowSequenceDomainForEvent(eventType),
      scopeId: text(workflowRunId),
      sequence: Number(sequence),
      ...(revision === undefined ? {} : { revision: Number(revision) }),
      ...(aggregateVersion === undefined ? {} : { aggregateVersion: Number(aggregateVersion) }),
    },
    producer,
    occurredAt: text(occurredAt),
    payload,
  });
  const validation = validateWorkflowRuntimeEnvelope(envelope);
  if (!validation.valid) {
    throw new TypeError(`invalid workflow runtime envelope: ${validation.errors.join(",")}`);
  }
  return envelope;
}

export function validateWorkflowRuntimeEnvelope(envelope = {}) {
  const errors = [];
  const eventType = text(envelope?.identity?.eventType);
  const payload = envelope?.payload;
  if (!isRecord(payload)) return Object.freeze({ valid: false, errors: ["payload_not_object"] });
  const expectedDomain = workflowSequenceDomainForEvent(eventType);
  if (!expectedDomain) errors.push("unsupported_event");
  if (text(envelope?.ordering?.domain) !== expectedDomain) errors.push("sequence_domain_mismatch");
  const workflowRunId = text(payload?.workflowRunId);
  if (!workflowRunId) errors.push("missing_workflow_run");
  if (workflowRunId && text(envelope?.ordering?.scopeId) !== workflowRunId)
    errors.push("sequence_scope_mismatch");
  const envelopeTurnScopeId = canonicalizeTurnScopeId(envelope?.identity?.turnScopeId);
  const payloadTurnScopeId = canonicalizeTurnScopeId(payload?.turnScopeId);
  if (payloadTurnScopeId && payloadTurnScopeId !== envelopeTurnScopeId)
    errors.push("turn_scope_identity_mismatch");

  if (eventType === WORKFLOW_RUNTIME_EVENT.PLANNING) {
    if (!envelopeTurnScopeId) errors.push("missing_planning_turn_scope");
    if (!text(envelope?.identity?.messageId)) errors.push("missing_planning_message_identity");
    if (!text(payload?.presentationMessageId)) errors.push("missing_planning_presentation");
    if (!isRecord(payload?.workflowPayload)) errors.push("missing_planning_workflow_payload");
    if (!Array.isArray(payload?.nodeSessions) || !payload.nodeSessions.length)
      errors.push("missing_planning_nodes");
  }
  if (eventType === WORKFLOW_RUNTIME_EVENT.NODE_STATE) {
    if (!text(payload?.nodeExecutionId)) errors.push("missing_node_execution");
    if (Object.hasOwn(payload, "sessionId") || Object.hasOwn(payload, "parentSessionId"))
      errors.push("invalid_node_session_field");
    if (!text(payload?.status)) errors.push("missing_node_status");
    if (
      !Number.isInteger(Number(envelope?.ordering?.revision)) ||
      Number(envelope.ordering.revision) < 1
    )
      errors.push("invalid_node_revision");
  }
  if (eventType === WORKFLOW_RUNTIME_EVENT.SESSION_SNAPSHOT) {
    if (!text(payload?.nodeExecutionId)) errors.push("missing_snapshot_node_execution");
    if (!text(payload?.nodeSessionId)) errors.push("missing_snapshot_node_session");
    if (Object.hasOwn(payload, "sessionId") || Object.hasOwn(payload, "parentSessionId"))
      errors.push("invalid_snapshot_session_field");
    if (
      !Number.isInteger(Number(envelope?.ordering?.aggregateVersion)) ||
      Number(envelope.ordering.aggregateVersion) < 1
    )
      errors.push("invalid_aggregate_version");
    if (
      (Array.isArray(payload?.messages) ? payload.messages : []).some(
        (message) => !text(message?.messageId),
      )
    )
      errors.push("missing_snapshot_message_identity");
    const lifecycleValidation = validateTurnLifecycleSnapshot(payload?.turnLifecycleSnapshot);
    if (!lifecycleValidation.valid) errors.push("invalid_turn_lifecycle_snapshot");
    if (
      lifecycleValidation.valid &&
      text(payload.turnLifecycleSnapshot.sessionId) !== text(payload.nodeSessionId)
    ) {
      errors.push("snapshot_lifecycle_session_mismatch");
    }
    if (!Array.isArray(payload?.turnTimings)) errors.push("invalid_turn_timings");
  }
  return Object.freeze({ valid: errors.length === 0, errors: Object.freeze(errors) });
}

export function workflowRuntimeEventComparable(left = {}, right = {}) {
  const leftDomain = text(left?.sequenceDomain);
  const rightDomain = text(right?.sequenceDomain);
  return Boolean(leftDomain && rightDomain && leftDomain === rightDomain);
}

export function compareWorkflowRuntimeFacts(
  incoming = {},
  current = {},
  { defaultDomain = "" } = {},
) {
  const incomingDomain = text(incoming?.sequenceDomain) || text(defaultDomain);
  const currentDomain = text(current?.sequenceDomain) || text(defaultDomain);
  if (!incomingDomain || !currentDomain || incomingDomain !== currentDomain) {
    return Object.freeze({ comparable: false, order: 0, incomingDomain, currentDomain });
  }
  const incomingRevision = Number(incoming?.revision || 0);
  const currentRevision = Number(current?.revision || 0);
  if (incomingRevision !== currentRevision) {
    return Object.freeze({
      comparable: true,
      order: incomingRevision > currentRevision ? 1 : -1,
      incomingDomain,
      currentDomain,
    });
  }
  const incomingSequence = Number(incoming?.sequence || 0);
  const currentSequence = Number(current?.sequence || 0);
  return Object.freeze({
    comparable: true,
    order: incomingSequence === currentSequence ? 0 : incomingSequence > currentSequence ? 1 : -1,
    incomingDomain,
    currentDomain,
  });
}
