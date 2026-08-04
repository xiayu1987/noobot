/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { emitEvent } from "../events/index.js";

export const AGENT_CONTEXT_DEBUG_TYPE = "agent-context";

function messageBlockCounts(modelContext = {}) {
  const blocks = modelContext?.messageBlocks || {};
  return {
    system: Array.isArray(blocks.system) ? blocks.system.length : 0,
    history: Array.isArray(blocks.history) ? blocks.history.length : 0,
    incremental: Array.isArray(blocks.incremental) ? blocks.incremental.length : 0,
  };
}

function isJsonSerializable(value) {
  try {
    JSON.stringify(value);
    return true;
  } catch {
    return false;
  }
}

export function buildAgentContextDebugData(scope = {}) {
  const context = scope?.context || {};
  const bindings = scope?.bindings || {};
  const identity = context?.identity || {};
  const tools = Array.isArray(bindings.tools) ? bindings.tools : [];
  const extensions = bindings?.extensions && typeof bindings.extensions === "object"
    ? bindings.extensions
    : {};
  return {
    debugType: AGENT_CONTEXT_DEBUG_TYPE,
    userId: String(identity.userId || "").trim(),
    sessionId: String(identity.sessionId || "").trim(),
    rootSessionId: String(identity.rootSessionId || "").trim(),
    parentSessionId: String(identity.parentSessionId || "").trim(),
    dialogProcessId: String(identity.dialogProcessId || "").trim(),
    turnScopeId: String(identity.turnScopeId || "").trim(),
    runId: String(identity.runId || "").trim(),
    envelope: {
      kind: String(context?.kind || "").trim(),
      protocolVersion: Number(context?.protocolVersion || 0),
      keys: Object.keys(context),
      workspace: {
        cwd: String(context?.environment?.workspace?.cwd || "").trim(),
        basePath: String(context?.environment?.workspace?.basePath || "").trim(),
      },
      caller: String(context?.execution?.caller || "").trim(),
      modelContextProtocolVersion: Number(context?.modelContext?.protocolVersion || 0),
      activeTurnIdentity: { ...(context?.modelContext?.activeTurnIdentity || {}) },
      messageBlockCounts: messageBlockCounts(context?.modelContext),
    },
    bindings: {
      keys: Object.keys(bindings),
      runtimeBound: Boolean(bindings?.runtime && typeof bindings.runtime === "object"),
      toolCount: tools.length,
      toolNames: tools.map((tool = {}) => String(tool?.name || "").trim()).filter(Boolean),
      extensionNames: Object.keys(extensions),
    },
    separation: {
      envelopeJsonSerializable: isJsonSerializable(context),
      runtimeOutsideEnvelope:
        !Object.prototype.hasOwnProperty.call(context, "runtime") &&
        context?.execution?.controllers == null,
      toolsOutsideEnvelope: context?.payload?.tools == null,
    },
  };
}

export function emitAgentContextDebug(eventListener, scope = {}) {
  return emitEvent(
    eventListener,
    "agent.context.executionScopeCreated",
    buildAgentContextDebugData(scope),
  );
}
