/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  EXECUTION_CHILDREN_WIRE_EVENT,
  EXECUTION_SNAPSHOT_WIRE_EVENT,
  EXECUTION_TREE_WIRE_EVENT,
  validateExecutionRecord,
} from "@noobot/session-protocol";
import { isPlainObject, text } from "@noobot/shared/value";
import { createEventEnvelope } from "./envelope.js";

export const EXECUTION_QUERY_SEQUENCE_DOMAIN = "execution";
export const EXECUTION_QUERY_SCHEMA_VERSION = 1;

const EXECUTION_QUERY_PRODUCER = Object.freeze({ type: "domain-service", id: "execution-query" });

export const EXECUTION_QUERY_FAMILY = Object.freeze({
  SNAPSHOT: "execution.snapshot",
  CHILDREN: "execution.children",
  TREE: "execution.tree",
});

const CONTRACT = Object.freeze({
  [EXECUTION_SNAPSHOT_WIRE_EVENT]: Object.freeze({
    family: EXECUTION_QUERY_FAMILY.SNAPSHOT,
    keys: Object.freeze(["execution"]),
  }),
  [EXECUTION_CHILDREN_WIRE_EVENT]: Object.freeze({
    family: EXECUTION_QUERY_FAMILY.CHILDREN,
    keys: Object.freeze(["execution", "children"]),
  }),
  [EXECUTION_TREE_WIRE_EVENT]: Object.freeze({
    family: EXECUTION_QUERY_FAMILY.TREE,
    keys: Object.freeze(["rootExecutionId", "tree"]),
  }),
});

export const EXECUTION_QUERY_WIRE_EVENT_BY_FAMILY = Object.freeze(
  Object.fromEntries(
    Object.entries(CONTRACT).map(([wireEvent, contract]) => [contract.family, wireEvent]),
  ),
);

function recordErrors(execution, path) {
  if (!isPlainObject(execution)) return [`${path}_not_object`];
  return validateExecutionRecord(execution).errors.map((error) => `${path}:${error}`);
}

function childrenErrors({ execution, children }) {
  if (!Array.isArray(children)) return ["children_not_array"];
  return children.flatMap((child, index) => [
    ...recordErrors(child, `children.${index}`),
    ...(child?.parentExecutionId === execution?.executionId
      ? []
      : [`child_parent_mismatch:${index}`]),
  ]);
}

function treeErrors({ rootExecutionId, tree }) {
  if (!text(rootExecutionId)) return ["missing_root_execution_id"];
  if (!isPlainObject(tree) || !isPlainObject(tree.executions)) return ["tree_not_object"];
  return Object.entries(tree.executions).flatMap(([id, item]) => [
    ...recordErrors(item, `tree.${id}`),
    ...(item?.executionId === id ? [] : [`tree_key_mismatch:${id}`]),
    ...(item?.executionId === rootExecutionId || item?.rootExecutionId === rootExecutionId
      ? []
      : [`tree_root_conflict:${id}`]),
  ]);
}

export function validateExecutionQueryPayload(wireEvent, payload) {
  const contract = CONTRACT[wireEvent];
  if (!contract) return { valid: false, errors: ["unsupported_execution_query_event"] };
  if (!isPlainObject(payload)) return { valid: false, errors: ["payload_not_object"] };
  const errors = Object.keys(payload)
    .filter((key) => !contract.keys.includes(key))
    .map((key) => `unknown_field:${key}`);
  if (wireEvent === EXECUTION_TREE_WIRE_EVENT) {
    errors.push(...treeErrors(payload));
  } else {
    errors.push(...recordErrors(payload.execution, "execution"));
  }
  if (wireEvent === EXECUTION_CHILDREN_WIRE_EVENT) {
    errors.push(...childrenErrors(payload));
  }
  return { valid: errors.length === 0, errors };
}

export function readExecutionQueryFocus(wireEvent, payload, executionId) {
  if (wireEvent === EXECUTION_TREE_WIRE_EVENT) return payload?.tree?.executions?.[executionId];
  return payload?.execution;
}

export function validateExecutionQueryEnvelope(envelope) {
  const wireEvent = envelope?.identity?.eventType;
  const { errors } = validateExecutionQueryPayload(wireEvent, envelope?.payload);
  const execution = readExecutionQueryFocus(
    wireEvent,
    envelope?.payload,
    envelope?.identity?.executionId,
  );
  if (envelope?.protocol?.family !== CONTRACT[wireEvent]?.family)
    errors.push("execution_query_family_mismatch");
  if (!text(envelope?.causality?.commandId)) errors.push("missing_command_id");
  if (envelope?.ordering?.domain !== EXECUTION_QUERY_SEQUENCE_DOMAIN)
    errors.push("sequence_domain_mismatch");
  if (!isPlainObject(execution)) {
    errors.push("execution_focus_missing");
    return { valid: false, errors };
  }
  if (envelope.identity.executionId !== execution.executionId)
    errors.push("execution_identity_mismatch");
  if (envelope.identity.sessionId !== execution.sessionId)
    errors.push("execution_session_mismatch");
  if (envelope.ordering.scopeId !== execution.rootExecutionId)
    errors.push("sequence_scope_mismatch");
  if (envelope.ordering.sequence !== execution.sequence) errors.push("execution_sequence_mismatch");
  return { valid: errors.length === 0, errors };
}

export function createExecutionQueryEnvelope({
  wireEvent,
  commandId,
  executionId,
  payload,
  occurredAt,
}) {
  const validation = validateExecutionQueryPayload(wireEvent, payload);
  if (!validation.valid) {
    throw new TypeError(`invalid execution query payload: ${validation.errors.join(",")}`);
  }
  const execution = readExecutionQueryFocus(wireEvent, payload, executionId);
  if (!isPlainObject(execution) || execution.executionId !== executionId) {
    throw new TypeError("invalid execution query payload: execution_focus_missing");
  }
  const envelope = createEventEnvelope({
    family: CONTRACT[wireEvent].family,
    schemaVersion: EXECUTION_QUERY_SCHEMA_VERSION,
    identity: {
      eventId: `${commandId}:${wireEvent}`,
      eventType: wireEvent,
      sessionId: execution.sessionId,
      turnScopeId: execution.turnScopeId,
      executionId: execution.executionId,
    },
    causality: { commandId },
    ordering: {
      domain: EXECUTION_QUERY_SEQUENCE_DOMAIN,
      scopeId: execution.rootExecutionId,
      sequence: execution.sequence,
      revision: execution.revision,
    },
    producer: EXECUTION_QUERY_PRODUCER,
    occurredAt,
    payload,
  });
  const envelopeValidation = validateExecutionQueryEnvelope(envelope);
  if (!envelopeValidation.valid) {
    throw new TypeError(`invalid execution query envelope: ${envelopeValidation.errors.join(",")}`);
  }
  return envelope;
}
