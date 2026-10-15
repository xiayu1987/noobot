/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { createPluginArtifactCommitRequest } from "@noobot/event-protocol/plugin-artifact-event";
import { getRuntimeFromAgentContext } from "../../context/agent-context-accessor.js";
import { AGENT_RUN_EVENT } from "../../events/run-event.js";
import { text } from "@noobot/shared/value";

export async function commitPluginArtifact({
  pluginId = "",
  artifact = {},
  toolContext = {},
} = {}) {
  const runtime = getRuntimeFromAgentContext(toolContext?.agentContext);
  const system = runtime?.systemRuntime || {};
  const userId = text(system.userId);
  const sessionId = text(system.sessionId);
  if (!userId) {
    throw new TypeError("plugin artifact commit requires execution identity");
  }
  const request = createPluginArtifactCommitRequest({
    pluginId,
    artifactType: artifact?.artifactType,
    artifactId: artifact?.artifactId,
    sessionId,
    turnScopeId: text(system.turnScopeId),
    data: artifact?.data,
    operation: text(artifact?.operation) || "created",
    baseRevision: artifact?.baseRevision == null ? null : Number(artifact.baseRevision),
  });
  if (typeof runtime?.sessionManager?.commitAuthorityEvent !== "function") {
    throw new Error("plugin artifact commit port is unavailable");
  }
  const committed = await runtime.sessionManager.commitAuthorityEvent({
    ...request,
    userId,
    sessionId,
    parentSessionId: text(system.parentSessionId),
    persistenceScope: system.persistenceScope || null,
  });
  if (!committed?.committed || !committed.envelope) {
    return Object.freeze({
      committed: false,
      reason: text(committed?.reason) || "commit_failed",
      code: text(committed?.code) || "ARTIFACT_COMMIT_FAILED",
      currentRevision: Math.max(0, Number(committed?.currentRevision) || 0),
    });
  }
  await runtime?.eventListener?.onEvent?.({
    event: AGENT_RUN_EVENT.AUTHORITY_EVENT_COMMITTED,
    data: {
      envelope: committed.envelope,
      persistenceScope: system.persistenceScope || null,
    },
    ts: new Date().toISOString(),
  });
  return Object.freeze({
    committed: true,
    eventId: committed.envelope.identity.eventId,
    operation: committed.envelope.payload.operation,
    revision: committed.envelope.payload.revision,
  });
}

export async function getPluginArtifact({ pluginId = "", artifact = {}, toolContext = {} } = {}) {
  const runtime = getRuntimeFromAgentContext(toolContext?.agentContext);
  const system = runtime?.systemRuntime || {};
  if (typeof runtime?.sessionManager?.getPluginArtifact !== "function")
    throw new Error("plugin artifact query port is unavailable");
  return runtime.sessionManager.getPluginArtifact({
    userId: text(system.userId),
    sessionId: text(system.sessionId),
    parentSessionId: text(system.parentSessionId),
    persistenceScope: system.persistenceScope || null,
    pluginId,
    artifactType: text(artifact?.artifactType),
    artifactId: text(artifact?.artifactId),
  });
}
