/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { createEventEnvelope } from "./envelope.js";

export const PLUGIN_ARTIFACT_EVENT = "plugin.artifact.committed";
export const PLUGIN_ARTIFACT_FAMILY = "plugin.artifact";
export const PLUGIN_ARTIFACT_SEQUENCE_DOMAIN = "plugin-artifact";
// Revision and operation fields are part of the wire contract.  Keep the
// artifact family versioned independently so consumers cannot silently accept
// the pre-revision payload shape.
export const PLUGIN_ARTIFACT_SCHEMA_VERSION = 2;
export const PLUGIN_ARTIFACT_OPERATIONS = Object.freeze(["created", "replaced"]);
export const PLUGIN_ARTIFACT_ERROR_CODE = Object.freeze({
  REVISION_CONFLICT: "ARTIFACT_REVISION_CONFLICT",
  ALREADY_EXISTS: "ARTIFACT_ALREADY_EXISTS",
  NOT_FOUND: "ARTIFACT_NOT_FOUND",
});

const text = (value) => String(value ?? "").trim();
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

export function validatePluginArtifactEnvelope(envelope = {}) {
  const errors = [];
  const pluginId = text(envelope?.payload?.pluginId);
  const artifactType = text(envelope?.payload?.artifactType);
  const artifactId = text(envelope?.payload?.artifactId);
  const sessionId = text(envelope?.identity?.sessionId);
  const operation = text(envelope?.payload?.operation);
  if (envelope?.protocol?.family !== PLUGIN_ARTIFACT_FAMILY) {
    errors.push("plugin_artifact_family_mismatch");
  }
  if (envelope?.protocol?.schemaVersion !== PLUGIN_ARTIFACT_SCHEMA_VERSION) {
    errors.push("plugin_artifact_schema_version_mismatch");
  }
  if (envelope?.identity?.eventType !== PLUGIN_ARTIFACT_EVENT) {
    errors.push("unsupported_event");
  }
  if (envelope?.ordering?.domain !== PLUGIN_ARTIFACT_SEQUENCE_DOMAIN) {
    errors.push("sequence_domain_mismatch");
  }
  if (!tokenPattern.test(pluginId)) errors.push("invalid_plugin_id");
  if (!tokenPattern.test(artifactType)) errors.push("invalid_artifact_type");
  if (!tokenPattern.test(artifactId)) errors.push("invalid_artifact_id");
  if (!text(envelope?.identity?.turnScopeId)) errors.push("missing_turn_scope_id");
  if (!PLUGIN_ARTIFACT_OPERATIONS.includes(operation)) errors.push("invalid_operation");
  if (!Number.isInteger(envelope?.payload?.revision) || envelope.payload.revision < 1)
    errors.push("invalid_revision");
  if (Number(envelope?.ordering?.revision) !== Number(envelope?.payload?.revision)) {
    errors.push("ordering_revision_mismatch");
  }
  if (
    envelope?.payload?.baseRevision !== null &&
    (!Number.isInteger(envelope?.payload?.baseRevision) || envelope.payload.baseRevision < 0)
  ) {
    errors.push("invalid_base_revision");
  }
  if (
    operation === "created" &&
    (envelope?.payload?.baseRevision !== null || envelope?.payload?.revision !== 1)
  ) {
    errors.push("invalid_created_revision");
  }
  if (
    operation === "replaced" &&
    (!Number.isInteger(envelope?.payload?.baseRevision) ||
      envelope.payload.baseRevision < 1 ||
      envelope.payload.revision !== envelope.payload.baseRevision + 1)
  ) {
    errors.push("invalid_replaced_revision");
  }
  if (envelope?.producer?.type !== "plugin" || text(envelope?.producer?.id) !== pluginId) {
    errors.push("plugin_producer_mismatch");
  }
  if (envelope?.ordering?.scopeId !== `${sessionId}:${pluginId}:${artifactType}:${artifactId}`) {
    errors.push("sequence_scope_mismatch");
  }
  if (!envelope?.payload?.data || typeof envelope.payload.data !== "object") {
    errors.push("invalid_artifact_data");
  }
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
