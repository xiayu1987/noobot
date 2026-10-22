/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { createEventEnvelope, createEventId } from "./envelope.js";
import { nullishText as text } from "./normalize.js";

export const PLUGIN_ARTIFACT_EVENT = "plugin.artifact.committed";
export const PLUGIN_ARTIFACT_FAMILY = "plugin.artifact";
export const PLUGIN_ARTIFACT_SEQUENCE_DOMAIN = "plugin-artifact";

export const PLUGIN_ARTIFACT_SCHEMA_VERSION = 2;
export const PLUGIN_ARTIFACT_OPERATIONS = Object.freeze(["created", "replaced"]);
export const PLUGIN_ARTIFACT_ERROR_CODE = Object.freeze({
  REVISION_CONFLICT: "ARTIFACT_REVISION_CONFLICT",
  ALREADY_EXISTS: "ARTIFACT_ALREADY_EXISTS",
  NOT_FOUND: "ARTIFACT_NOT_FOUND",
});
export const PLUGIN_ARTIFACT_REJECTION_REASON = Object.freeze({
  [PLUGIN_ARTIFACT_ERROR_CODE.REVISION_CONFLICT]: "revision_conflict",
  [PLUGIN_ARTIFACT_ERROR_CODE.ALREADY_EXISTS]: "artifact_exists",
  [PLUGIN_ARTIFACT_ERROR_CODE.NOT_FOUND]: "artifact_not_found",
});

const tokenPattern = /^[A-Za-z][A-Za-z0-9_.-]{0,159}$/;

function collectCommitRequestErrors({ keys, sessionId, turnScopeId, data, baseRevision }) {
  const errors = [];
  pushIf(errors, !text(sessionId), "missing_session_id");
  pushIf(errors, !text(turnScopeId), "missing_turn_scope_id");
  pushIf(errors, !tokenPattern.test(keys.pluginId), "invalid_plugin_id");
  pushIf(errors, !tokenPattern.test(keys.artifactType), "invalid_artifact_type");
  pushIf(errors, !tokenPattern.test(keys.artifactId), "invalid_artifact_id");
  pushIf(errors, !PLUGIN_ARTIFACT_OPERATIONS.includes(keys.operation), "invalid_operation");
  pushIf(errors, !data || typeof data !== "object", "invalid_artifact_data");
  pushIf(errors, keys.operation === "created" && baseRevision !== null, "invalid_created_revision");
  pushIf(
    errors,
    keys.operation === "replaced" && !isIntegerAtLeast(baseRevision, 1),
    "invalid_replaced_revision",
  );
  return errors;
}

export function createPluginArtifactCommitRequest({
  pluginId,
  artifactType,
  artifactId,
  sessionId,
  turnScopeId,
  data,
  operation,
  baseRevision,
}) {
  const keys = {
    pluginId: text(pluginId),
    artifactType: text(artifactType),
    artifactId: text(artifactId),
    operation: text(operation),
  };
  const errors = collectCommitRequestErrors({ keys, sessionId, turnScopeId, data, baseRevision });
  if (errors.length > 0) {
    throw new TypeError(`invalid plugin artifact commit request: ${errors.join(",")}`);
  }
  return Object.freeze({
    family: PLUGIN_ARTIFACT_FAMILY,
    identity: { eventType: PLUGIN_ARTIFACT_EVENT, turnScopeId: text(turnScopeId) },
    causality: { correlationId: text(turnScopeId) },
    ordering: {
      domain: PLUGIN_ARTIFACT_SEQUENCE_DOMAIN,
      scopeId: `${text(sessionId)}:${keys.pluginId}:${keys.artifactType}:${keys.artifactId}`,
    },
    producer: { type: "plugin", id: keys.pluginId },
    payload: { ...keys, data, baseRevision },
  });
}

export function createPluginArtifactEnvelope({
  sessionId,
  sequence,
  revision,
  occurredAt,
  ...request
}) {
  const commitRequest = createPluginArtifactCommitRequest({ ...request, sessionId });
  const envelope = createEventEnvelope({
    ...commitRequest,
    schemaVersion: PLUGIN_ARTIFACT_SCHEMA_VERSION,
    identity: {
      ...commitRequest.identity,
      eventId: createEventId(),
      sessionId: text(sessionId),
    },
    ordering: { ...commitRequest.ordering, sequence, revision },
    occurredAt,
    payload: { ...commitRequest.payload, revision },
  });
  const validation = validatePluginArtifactEnvelope(envelope);
  if (!validation.valid) {
    throw new TypeError(`invalid plugin artifact envelope: ${validation.errors.join(",")}`);
  }
  return envelope;
}

function isIntegerAtLeast(value, min) {
  return Number.isInteger(value) && value >= min;
}

function pushIf(errors, condition, code) {
  if (condition) errors.push(code);
}

function collectProtocolHeaderErrors(errors, { protocol, identity, ordering }) {
  pushIf(errors, protocol?.family !== PLUGIN_ARTIFACT_FAMILY, "plugin_artifact_family_mismatch");
  pushIf(
    errors,
    protocol?.schemaVersion !== PLUGIN_ARTIFACT_SCHEMA_VERSION,
    "plugin_artifact_schema_version_mismatch",
  );
  pushIf(errors, identity?.eventType !== PLUGIN_ARTIFACT_EVENT, "unsupported_event");
  pushIf(errors, ordering?.domain !== PLUGIN_ARTIFACT_SEQUENCE_DOMAIN, "sequence_domain_mismatch");
}

function collectIdentityTokenErrors(errors, { identity }, keys) {
  pushIf(errors, !tokenPattern.test(keys.pluginId), "invalid_plugin_id");
  pushIf(errors, !tokenPattern.test(keys.artifactType), "invalid_artifact_type");
  pushIf(errors, !tokenPattern.test(keys.artifactId), "invalid_artifact_id");
  pushIf(errors, !text(identity?.turnScopeId), "missing_turn_scope_id");
  pushIf(errors, !PLUGIN_ARTIFACT_OPERATIONS.includes(keys.operation), "invalid_operation");
}

function collectRevisionErrors(errors, { payload, ordering }, operation) {
  const revision = payload?.revision;
  const baseRevision = payload?.baseRevision;
  pushIf(errors, !isIntegerAtLeast(revision, 1), "invalid_revision");
  pushIf(errors, Number(ordering?.revision) !== Number(revision), "ordering_revision_mismatch");
  pushIf(
    errors,
    baseRevision !== null && !isIntegerAtLeast(baseRevision, 0),
    "invalid_base_revision",
  );
  pushIf(
    errors,
    operation === "created" && (baseRevision !== null || revision !== 1),
    "invalid_created_revision",
  );
  pushIf(
    errors,
    operation === "replaced" &&
      (!isIntegerAtLeast(baseRevision, 1) || revision !== baseRevision + 1),
    "invalid_replaced_revision",
  );
}

function collectOwnershipErrors(errors, { payload, ordering, producer }, keys) {
  const { pluginId, artifactType, artifactId, sessionId } = keys;
  pushIf(
    errors,
    producer?.type !== "plugin" || text(producer?.id) !== pluginId,
    "plugin_producer_mismatch",
  );
  pushIf(
    errors,
    ordering?.scopeId !== `${sessionId}:${pluginId}:${artifactType}:${artifactId}`,
    "sequence_scope_mismatch",
  );
  pushIf(errors, !payload?.data || typeof payload.data !== "object", "invalid_artifact_data");
}

export function validatePluginArtifactEnvelope(envelope = {}) {
  const parts = {
    protocol: envelope?.protocol,
    identity: envelope?.identity,
    ordering: envelope?.ordering,
    payload: envelope?.payload,
    producer: envelope?.producer,
  };
  const keys = {
    pluginId: text(parts.payload?.pluginId),
    artifactType: text(parts.payload?.artifactType),
    artifactId: text(parts.payload?.artifactId),
    sessionId: text(parts.identity?.sessionId),
    operation: text(parts.payload?.operation),
  };
  const errors = [];
  collectProtocolHeaderErrors(errors, parts);
  collectIdentityTokenErrors(errors, parts, keys);
  collectRevisionErrors(errors, parts, keys.operation);
  collectOwnershipErrors(errors, parts, keys);
  return { valid: errors.length === 0, errors };
}

export function pluginArtifactKey({ pluginId, artifactType, artifactId }) {
  const parts = [pluginId, artifactType, artifactId].map(text);
  if (parts.some((part) => !part)) {
    throw new TypeError("plugin artifact key requires pluginId, artifactType and artifactId");
  }
  return parts.join(":");
}

function rejectArtifactCommit(code, currentRevision) {
  return Object.freeze({
    allowed: false,
    code,
    reason: PLUGIN_ARTIFACT_REJECTION_REASON[code],
    currentRevision,
  });
}

export function decidePluginArtifactCommit(current, { operation, baseRevision }) {
  if (current !== null && !isIntegerAtLeast(current?.revision, 1)) {
    throw new TypeError("plugin artifact commit decision requires a current artifact or null");
  }
  const currentRevision = current === null ? 0 : current.revision;
  if (operation === "created") {
    if (current !== null) {
      return rejectArtifactCommit(PLUGIN_ARTIFACT_ERROR_CODE.ALREADY_EXISTS, currentRevision);
    }
    return Object.freeze({ allowed: true, revision: 1 });
  }
  if (operation !== "replaced") {
    throw new TypeError(`invalid plugin artifact operation: ${operation}`);
  }
  if (current === null) {
    return rejectArtifactCommit(PLUGIN_ARTIFACT_ERROR_CODE.NOT_FOUND, currentRevision);
  }
  if (baseRevision !== currentRevision) {
    return rejectArtifactCommit(PLUGIN_ARTIFACT_ERROR_CODE.REVISION_CONFLICT, currentRevision);
  }
  return Object.freeze({ allowed: true, revision: currentRevision + 1 });
}

export function createPluginArtifactCommitReceipt(envelope) {
  const validation = validatePluginArtifactEnvelope(envelope);
  if (!validation.valid) {
    throw new TypeError(`invalid committed plugin artifact: ${validation.errors.join(",")}`);
  }
  return Object.freeze({
    committed: true,
    eventId: envelope.identity.eventId,
    operation: envelope.payload.operation,
    revision: envelope.payload.revision,
  });
}

export function createPluginArtifactCommitRejection(decision) {
  if (decision?.allowed !== false || !PLUGIN_ARTIFACT_REJECTION_REASON[decision.code]) {
    throw new TypeError("plugin artifact commit rejection requires a rejected commit decision");
  }
  if (!isIntegerAtLeast(decision.currentRevision, 0)) {
    throw new TypeError("plugin artifact commit rejection requires an integer currentRevision");
  }
  return Object.freeze({
    committed: false,
    code: decision.code,
    reason: decision.reason,
    currentRevision: decision.currentRevision,
  });
}

export function createPluginArtifactQueryResult(current) {
  if (current === null) {
    return Object.freeze({ found: false, artifact: null, revision: 0 });
  }
  if (!isIntegerAtLeast(current?.revision, 1) || !text(current.eventId)) {
    throw new TypeError("plugin artifact query requires a projected artifact or null");
  }
  return Object.freeze({
    found: true,
    revision: current.revision,
    operation: current.operation,
    artifact: current.data,
    eventId: current.eventId,
  });
}

export function reducePluginArtifact(current, envelope) {
  const validation = validatePluginArtifactEnvelope(envelope);
  if (!validation.valid) return { applied: false, reason: "invalid_event", artifact: current };
  const payload = envelope.payload;
  const decision = decidePluginArtifactCommit(current, payload);
  if (!decision.allowed) return { applied: false, reason: decision.reason, artifact: current };
  return {
    applied: true,
    artifact: Object.freeze({
      pluginId: payload.pluginId,
      artifactType: payload.artifactType,
      artifactId: payload.artifactId,
      revision: payload.revision,
      operation: payload.operation,
      data: payload.data,
      eventId: envelope.identity.eventId,
    }),
  };
}

export function projectPluginArtifacts(events) {
  if (!Array.isArray(events)) {
    throw new TypeError("plugin artifact projection requires session artifact events");
  }
  const artifacts = {};
  const orderedEvents = events
    .map((envelope, index) => ({ envelope, index }))
    .sort((left, right) => {
      const sequenceDelta = left.envelope.ordering.sequence - right.envelope.ordering.sequence;
      return sequenceDelta || left.index - right.index;
    })
    .map(({ envelope }) => envelope);
  for (const envelope of orderedEvents) {
    const key = pluginArtifactKey(envelope.payload);
    const reduced = reducePluginArtifact(artifacts[key] || null, envelope);
    if (reduced.applied) artifacts[key] = reduced.artifact;
  }
  return artifacts;
}
