/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  PLUGIN_ARTIFACT_EVENT,
  PLUGIN_ARTIFACT_FAMILY,
  PLUGIN_ARTIFACT_SCHEMA_VERSION,
  PLUGIN_ARTIFACT_SEQUENCE_DOMAIN,
} from "@noobot/event-protocol/plugin-artifact-event";
import { getRuntimeFromAgentContext } from "../../context/agent-context-accessor.js";
import { AGENT_RUN_EVENT } from "../../events/run-event.js";

const text = (value) => String(value || "").trim();

export async function commitPluginArtifact({
  pluginId = "",
  artifact = {},
  toolContext = {},
} = {}) {
  const runtime = getRuntimeFromAgentContext(toolContext?.agentContext);
  const system = runtime?.systemRuntime || {};
  const identity = {
    userId: text(runtime?.userId || system.userId),
    sessionId: text(system.sessionId),
    parentSessionId: text(system.parentSessionId),
    turnScopeId: text(system.turnScopeId || system.config?.turnScopeId),
  };
  const type = text(artifact?.artifactType);
  const id = text(artifact?.artifactId);
  if (!identity.userId || !identity.sessionId || !identity.turnScopeId) {
    throw new TypeError("plugin artifact commit requires execution identity");
  }
  if (!type || !id || !artifact?.data || typeof artifact.data !== "object") {
    throw new TypeError("plugin artifact commit requires type, id and data");
  }
  if (typeof runtime?.sessionManager?.commitAuthorityEvent !== "function") {
    throw new Error("plugin artifact commit port is unavailable");
  }
  const committed = await runtime.sessionManager.commitAuthorityEvent({
    userId: identity.userId,
    sessionId: identity.sessionId,
    parentSessionId: identity.parentSessionId,
    family: PLUGIN_ARTIFACT_FAMILY,
    schemaVersion: PLUGIN_ARTIFACT_SCHEMA_VERSION,
    identity: { eventType: PLUGIN_ARTIFACT_EVENT, turnScopeId: identity.turnScopeId },
    causality: { correlationId: identity.turnScopeId },
    ordering: {
      domain: PLUGIN_ARTIFACT_SEQUENCE_DOMAIN,
      scopeId: `${identity.sessionId}:${pluginId}:${id}`,
    },
    producer: { type: "plugin", id: pluginId },
    payload: {
      pluginId, artifactType: type, artifactId: id, data: artifact.data,
      operation: text(artifact.operation) || "created",
      baseRevision: artifact.baseRevision == null ? null : Number(artifact.baseRevision),
      revision: artifact.revision == null ? 1 : Number(artifact.revision),
    },
    persistenceContext: runtime.persistenceContext || null,
  });
  if (!committed?.committed || !committed.envelope) {
    throw new Error(`plugin artifact commit failed: ${committed?.reason || "unknown"}`);
  }
  await runtime?.eventListener?.onEvent?.({
    event: AGENT_RUN_EVENT.AUTHORITY_EVENT_COMMITTED,
    data: { envelope: committed.envelope },
    ts: new Date().toISOString(),
  });
  return committed.envelope;
}

export async function getPluginArtifact({ pluginId = "", artifact = {}, toolContext = {} } = {}) {
  const runtime = getRuntimeFromAgentContext(toolContext?.agentContext);
  const system = runtime?.systemRuntime || {};
  if (typeof runtime?.sessionManager?.getPluginArtifact !== "function")
    throw new Error("plugin artifact query port is unavailable");
  return runtime.sessionManager.getPluginArtifact({
    userId: text(runtime?.userId || system.userId), sessionId: text(system.sessionId),
    parentSessionId: text(system.parentSessionId), persistenceContext: runtime.persistenceContext || null,
    pluginId, artifactType: text(artifact?.artifactType), artifactId: text(artifact?.artifactId),
  });
}

export async function replacePluginArtifact({ pluginId = "", artifact = {}, toolContext = {} } = {}) {
  const runtime = getRuntimeFromAgentContext(toolContext?.agentContext);
  const system = runtime?.systemRuntime || {};
  if (typeof runtime?.sessionManager?.replacePluginArtifact !== "function")
    throw new Error("plugin artifact replace port is unavailable");
  return runtime.sessionManager.replacePluginArtifact({
    userId: text(runtime?.userId || system.userId), sessionId: text(system.sessionId),
    parentSessionId: text(system.parentSessionId), turnScopeId: text(system.turnScopeId || system.config?.turnScopeId),
    family: PLUGIN_ARTIFACT_FAMILY, schemaVersion: PLUGIN_ARTIFACT_SCHEMA_VERSION,
    identity: { eventType: PLUGIN_ARTIFACT_EVENT, turnScopeId: text(system.turnScopeId || system.config?.turnScopeId) },
    causality: { correlationId: text(system.turnScopeId || system.config?.turnScopeId) },
    ordering: { domain: PLUGIN_ARTIFACT_SEQUENCE_DOMAIN, scopeId: `${system.sessionId}:${pluginId}:${text(artifact.artifactId)}` },
    producer: { type: "plugin", id: pluginId },
    payload: {
      pluginId, artifactType: text(artifact.artifactType), artifactId: text(artifact.artifactId),
      data: artifact.data, operation: "replaced",
      revision: Number(artifact.baseRevision || 0) + 1,
    },
    baseRevision: artifact.baseRevision == null ? null : Number(artifact.baseRevision),
    persistenceContext: runtime.persistenceContext || null,
  });
}
