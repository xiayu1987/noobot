/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  createPluginArtifactCommitReceipt,
  createPluginArtifactCommitRequest,
} from "@noobot/event-protocol/plugin-artifact-event";
import {
  getRuntimeFromAgentContext,
  getSystemRuntimeFromRuntime,
} from "../../context/agent-context-accessor.js";
import { AGENT_RUN_EVENT } from "../../events/run-event.js";
import { emitEvent } from "../../events/emitter.js";

function resolveArtifactScope(toolContext) {
  const runtime = getRuntimeFromAgentContext(toolContext.agentContext);
  const system = getSystemRuntimeFromRuntime(runtime);
  return { runtime, system };
}

export async function commitPluginArtifact({ pluginId, artifact, toolContext }) {
  const { runtime, system } = resolveArtifactScope(toolContext);
  const request = createPluginArtifactCommitRequest({
    pluginId,
    artifactType: artifact.artifactType,
    artifactId: artifact.artifactId,
    sessionId: system.sessionId,
    turnScopeId: system.turnScopeId,
    data: artifact.data,
    operation: artifact.operation,
    baseRevision: artifact.baseRevision,
  });
  const result = await runtime.sessionManager.commitAuthorityEvent({
    ...request,
    userId: system.userId,
    sessionId: system.sessionId,
    persistenceScope: system.persistenceScope,
  });
  if (result.committed === false) return result;
  const receipt = createPluginArtifactCommitReceipt(result.envelope);
  await emitEvent(runtime.eventListener, AGENT_RUN_EVENT.AUTHORITY_EVENT_COMMITTED, {
    envelope: result.envelope,
    persistenceScope: system.persistenceScope,
  });
  return receipt;
}

export async function getPluginArtifact({ pluginId, artifact, toolContext }) {
  const { runtime, system } = resolveArtifactScope(toolContext);
  return runtime.sessionManager.getPluginArtifact({
    userId: system.userId,
    sessionId: system.sessionId,
    persistenceScope: system.persistenceScope,
    pluginId,
    artifactType: artifact.artifactType,
    artifactId: artifact.artifactId,
  });
}
