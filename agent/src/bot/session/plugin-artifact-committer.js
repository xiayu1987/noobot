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
    payload: { pluginId, artifactType: type, artifactId: id, data: artifact.data },
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
