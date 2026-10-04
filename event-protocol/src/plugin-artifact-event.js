/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { createEventEnvelope } from "./envelope.js";
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

const tokenPattern = /^[A-Za-z][A-Za-z0-9_.-]{0,159}$/;

export function createPluginArtifactEnvelope({
  pluginId = "",
  artifactType = "",
  artifactId = "",
  sessionId = "",
  turnScopeId = "",
  data = {},
  sequence = 1,
  operation = "created",
  revision = 1,
  baseRevision = null,
  occurredAt = new Date().toISOString(),
} = {}) {
  const envelope = createEventEnvelope({
    family: PLUGIN_ARTIFACT_FAMILY,
    schemaVersion: PLUGIN_ARTIFACT_SCHEMA_VERSION,
    identity: {
      eventId: `${PLUGIN_ARTIFACT_EVENT}:${text(sessionId)}:${text(pluginId)}:${text(artifactType)}:${text(artifactId)}:${sequence}`,
      eventType: PLUGIN_ARTIFACT_EVENT,
      sessionId: text(sessionId),
      turnScopeId: text(turnScopeId),
    },
    ordering: {
      domain: PLUGIN_ARTIFACT_SEQUENCE_DOMAIN,
      scopeId: `${text(sessionId)}:${text(pluginId)}:${text(artifactType)}:${text(artifactId)}`,
      sequence,
      revision,
    },
    producer: { type: "plugin", id: text(pluginId) },
    occurredAt,
    payload: {
      pluginId: text(pluginId),
      artifactType: text(artifactType),
      artifactId: text(artifactId),
      data,
      operation: text(operation),
      revision,
      baseRevision,
    },
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

export function pluginArtifactKey(value = {}) {
  const payload = value?.payload || value;
  return `${text(payload?.pluginId)}:${text(payload?.artifactType)}:${text(payload?.artifactId)}`;
}

export function reducePluginArtifact(current = null, envelope = {}) {
  const validation = validatePluginArtifactEnvelope(envelope);
  if (!validation.valid) return { applied: false, reason: "invalid_event", artifact: current };
  const payload = envelope.payload;
  if (payload.operation === "created" && current) {
    return { applied: false, reason: "artifact_exists", artifact: current };
  }
  if (payload.operation === "replaced" && (!current || current.revision !== payload.baseRevision)) {
    return {
      applied: false,
      reason: current ? "revision_conflict" : "artifact_not_found",
      artifact: current,
    };
  }
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

export function projectPluginArtifacts(events = []) {
  const artifacts = {};
  const orderedEvents = (Array.isArray(events) ? events : [])
    .map((envelope, index) => ({ envelope, index }))
    .sort((left, right) => {
      const sequenceDelta =
        Number(left.envelope?.ordering?.sequence || 0) -
        Number(right.envelope?.ordering?.sequence || 0);
      return sequenceDelta || left.index - right.index;
    })
    .map(({ envelope }) => envelope);
  for (const envelope of orderedEvents) {
    const key = pluginArtifactKey(envelope);
    const reduced = reducePluginArtifact(artifacts[key] || null, envelope);
    if (reduced.applied) artifacts[key] = reduced.artifact;
  }
  return artifacts;
}
