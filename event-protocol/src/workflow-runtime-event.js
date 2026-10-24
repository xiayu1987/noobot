/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { isCanonicalText, isPlainObject } from "@noobot/shared/value";
import { isCanonicalTurnScopeId } from "@noobot/session-protocol/turn-scope-identity";
import { validateTurnLifecycleSnapshot } from "@noobot/session-protocol";
import { createEventEnvelope } from "./envelope.js";
import { resolveMessageViewKey } from "./message-event.js";

export const WORKFLOW_RUNTIME_FAMILY = "workflow.runtime";
export const WORKFLOW_RUNTIME_SCHEMA_VERSION = 1;

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

export const WORKFLOW_NODE_STATUS = Object.freeze({
  PENDING: "pending",
  READY: "ready",
  RUNNING: "running",
  SUCCEEDED: "succeeded",
  FAILED: "failed",
  STOPPED: "stopped",
  SKIPPED: "skipped",
});

const WORKFLOW_NODE_TERMINAL_STATUSES = Object.freeze(
  new Set([
    WORKFLOW_NODE_STATUS.SUCCEEDED,
    WORKFLOW_NODE_STATUS.FAILED,
    WORKFLOW_NODE_STATUS.STOPPED,
    WORKFLOW_NODE_STATUS.SKIPPED,
  ]),
);

const WORKFLOW_NODE_STATUSES = Object.freeze(new Set(Object.values(WORKFLOW_NODE_STATUS)));

export function normalizeWorkflowNodeStatus(value) {
  return WORKFLOW_NODE_STATUSES.has(value) ? value : "";
}

export function isWorkflowNodeTerminalStatus(value) {
  return WORKFLOW_NODE_TERMINAL_STATUSES.has(value);
}

export function workflowSequenceDomainForEvent(eventType) {
  if (eventType === WORKFLOW_RUNTIME_EVENT.PLANNING) return WORKFLOW_SEQUENCE_DOMAIN.PLANNING;
  if (eventType === WORKFLOW_RUNTIME_EVENT.NODE_STATE) return WORKFLOW_SEQUENCE_DOMAIN.NODE_STATE;
  if (eventType === WORKFLOW_RUNTIME_EVENT.SESSION_SNAPSHOT)
    return WORKFLOW_SEQUENCE_DOMAIN.SESSION_SNAPSHOT;
  return "";
}

export function createWorkflowRuntimeEnvelope({
  eventType,
  authoritySessionId,
  turnScopeId,
  executionId,
  eventId,
  workflowRunId,
  sequence,
  revision,
  aggregateVersion,
  occurredAt,
  producer,
  causality,
  payload,
}) {
  const envelope = createEventEnvelope({
    family: WORKFLOW_RUNTIME_FAMILY,
    schemaVersion: WORKFLOW_RUNTIME_SCHEMA_VERSION,
    identity: {
      eventId,
      eventType,
      sessionId: authoritySessionId,
      turnScopeId,
      executionId,
    },
    causality,
    ordering: {
      domain: workflowSequenceDomainForEvent(eventType),
      scopeId: workflowRunId,
      sequence,
      ...(revision === undefined ? {} : { revision }),
      ...(aggregateVersion === undefined ? {} : { aggregateVersion }),
    },
    producer,
    occurredAt,
    payload,
  });
  const validation = validateWorkflowRuntimeEnvelope(envelope);
  if (!validation.valid) {
    throw new TypeError(`invalid workflow runtime envelope: ${validation.errors.join(",")}`);
  }
  return envelope;
}

function isPositiveInteger(value) {
  return Number.isInteger(value) && value >= 1;
}

const WORKFLOW_NODE_FACT_FIELDS = Object.freeze([
  "workflowRunId",
  "commandId",
  "nodeSessionId",
  "dialogProcessId",
  "turnScopeId",
  "nodeId",
  "nodeName",
  "status",
  "failure",
  "activeChildExecutionId",
  "attemptExecutionIds",
  "startedAt",
  "completedAt",
  "createdAt",
  "updatedAt",
]);

const NODE_STATE_PAYLOAD_FIELDS = Object.freeze(new Set(WORKFLOW_NODE_FACT_FIELDS));

const PLANNING_NODE_FIELDS = Object.freeze(
  new Set([
    ...WORKFLOW_NODE_FACT_FIELDS,
    "nodeExecutionId",
    "attempt",
    "dependencies",
    "revision",
    "sequence",
    "eventId",
  ]),
);

function hasOnlyFields(value, fields) {
  return Object.keys(value).every((key) => fields.has(key));
}

const PLANNING_PAYLOAD_FIELDS = Object.freeze(
  new Set([
    "sessionId",
    "dialogProcessId",
    "turnScopeId",
    "presentationMessageId",
    "workflowRunId",
    "semanticText",
    "workflowPayload",
    "sourceMessage",
  ]),
);

function hasSessionOwnershipField(payload) {
  return Object.hasOwn(payload, "sessionId") || Object.hasOwn(payload, "parentSessionId");
}

function validateEnvelopeIdentity(envelope, eventType, payload, errors) {
  const expectedDomain = workflowSequenceDomainForEvent(eventType);
  if (!expectedDomain) errors.push("unsupported_event");
  if (envelope?.ordering?.domain !== expectedDomain) errors.push("sequence_domain_mismatch");
  const workflowRunId = payload.workflowRunId;
  if (!isCanonicalText(workflowRunId)) errors.push("missing_workflow_run");
  else if (envelope?.ordering?.scopeId !== workflowRunId) errors.push("sequence_scope_mismatch");
  if (!isCanonicalText(envelope?.identity?.executionId)) errors.push("missing_execution_id");
  const turnScopeId = envelope?.identity?.turnScopeId;
  if (!isCanonicalTurnScopeId(turnScopeId)) errors.push("invalid_turn_scope_id");
  if (payload.turnScopeId !== turnScopeId) errors.push("turn_scope_identity_mismatch");
}

function validatePlanningFields(payload, errors) {
  if (!hasOnlyFields(payload, PLANNING_PAYLOAD_FIELDS)) errors.push("unknown_planning_field");
  if (!isCanonicalText(payload.presentationMessageId)) errors.push("missing_planning_presentation");
  if (!isPlainObject(payload.workflowPayload)) {
    errors.push("missing_planning_workflow_payload");
    return;
  }
  const { nodeSessions } = payload.workflowPayload;
  if (!Array.isArray(nodeSessions) || !nodeSessions.length) errors.push("missing_planning_nodes");
  else if (!nodeSessions.every(isCanonicalPlanningNode)) errors.push("invalid_planning_node");
}

function isCanonicalPlanningNode(node) {
  return (
    isPlainObject(node) &&
    hasOnlyFields(node, PLANNING_NODE_FIELDS) &&
    isCanonicalText(node.nodeExecutionId) &&
    isCanonicalText(node.eventId) &&
    WORKFLOW_NODE_STATUSES.has(node.status) &&
    isPositiveInteger(node.revision) &&
    isPositiveInteger(node.sequence)
  );
}

function validateNodeStateFields(envelope, payload, errors) {
  if (!hasOnlyFields(payload, NODE_STATE_PAYLOAD_FIELDS)) errors.push("unknown_node_state_field");
  if (!WORKFLOW_NODE_STATUSES.has(payload.status)) errors.push("missing_node_status");
  if (!isPositiveInteger(envelope?.ordering?.revision)) errors.push("invalid_node_revision");
}

function validateSnapshotLifecycle(payload, errors) {
  const lifecycleValidation = validateTurnLifecycleSnapshot(payload?.turnLifecycleSnapshot);
  if (!lifecycleValidation.valid) {
    errors.push("invalid_turn_lifecycle_snapshot");
    return;
  }
  if (payload.turnLifecycleSnapshot.sessionId !== payload.nodeSessionId) {
    errors.push("snapshot_lifecycle_session_mismatch");
  }
}

const SNAPSHOT_MESSAGE_FORBIDDEN_FIELDS = Object.freeze([
  "sessionId",
  "messageId",
  "thinking",
  "toolCall",
  "toolResult",
  "rawEvents",
  "eventId",
  "sequence",
  "firstSequence",
  "revision",
  "sequenceDomain",
  "sequenceScopeId",
]);

function isCanonicalSnapshotMessage(message) {
  return (
    isPlainObject(message) &&
    isCanonicalText(message.messageUid) &&
    isCanonicalText(resolveMessageViewKey(message)) &&
    SNAPSHOT_MESSAGE_FORBIDDEN_FIELDS.every((field) => !Object.hasOwn(message, field))
  );
}

function validateSessionSnapshotFields(envelope, payload, errors) {
  if (!isCanonicalText(payload.nodeExecutionId)) errors.push("missing_snapshot_node_execution");
  if (!isCanonicalText(payload.nodeSessionId)) errors.push("missing_snapshot_node_session");
  if (hasSessionOwnershipField(payload)) errors.push("invalid_snapshot_session_field");
  if (!isPositiveInteger(envelope?.ordering?.aggregateVersion))
    errors.push("invalid_aggregate_version");
  if (!Array.isArray(payload.messages)) errors.push("invalid_snapshot_messages");
  else if (payload.messages.some((message) => !isCanonicalSnapshotMessage(message)))
    errors.push("missing_snapshot_message_identity");
  validateSnapshotLifecycle(payload, errors);
  if (!Array.isArray(payload?.turnTimings)) errors.push("invalid_turn_timings");
}

export function validateWorkflowRuntimeEnvelope(envelope) {
  const errors = [];
  const eventType = envelope?.identity?.eventType;
  const payload = envelope?.payload;
  if (!isPlainObject(payload)) {
    return Object.freeze({ valid: false, errors: Object.freeze(["payload_not_object"]) });
  }
  validateEnvelopeIdentity(envelope, eventType, payload, errors);
  if (eventType === WORKFLOW_RUNTIME_EVENT.PLANNING) {
    validatePlanningFields(payload, errors);
  }
  if (eventType === WORKFLOW_RUNTIME_EVENT.NODE_STATE) {
    validateNodeStateFields(envelope, payload, errors);
  }
  if (eventType === WORKFLOW_RUNTIME_EVENT.SESSION_SNAPSHOT) {
    validateSessionSnapshotFields(envelope, payload, errors);
  }
  return Object.freeze({ valid: errors.length === 0, errors: Object.freeze(errors) });
}

export function compareWorkflowRuntimeFacts(incoming, current) {
  const incomingDomain = incoming.sequenceDomain;
  const currentDomain = current.sequenceDomain;
  if (!isCanonicalText(incomingDomain) || incomingDomain !== currentDomain) {
    return Object.freeze({ comparable: false, order: 0, incomingDomain, currentDomain });
  }
  const order = Math.sign(
    incoming.revision - current.revision || incoming.sequence - current.sequence,
  );
  return Object.freeze({ comparable: true, order, incomingDomain, currentDomain });
}
