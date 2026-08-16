/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import {
  AGENT_CONTEXT_KIND,
  AGENT_CONTEXT_PROTOCOL_VERSION,
  MODEL_CONTEXT_PROTOCOL_VERSION,
} from "./agent-context-schema.js";
import { normalizeAgentContextIdentity } from "./agent-context-identity.js";
import { assertValidAgentContextEnvelope } from "./agent-context-validation.js";
import { createContextBuildReceipt } from "../assembly/context-build-receipt.js";

function plainObject(value, fallback = {}) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : fallback;
}

export function createAgentContextEnvelope({
  identity = {},
  environment = {},
  execution = {},
  modelContext = null,
} = {}) {
  const envelope = {
    kind: AGENT_CONTEXT_KIND,
    protocolVersion: AGENT_CONTEXT_PROTOCOL_VERSION,
    identity: normalizeAgentContextIdentity(identity),
    environment: plainObject(environment),
    execution: plainObject(execution),
    modelContext,
  };
  return assertValidAgentContextEnvelope(envelope);
}

export function createAgentContextBuildEnvelope({
  identity = {},
  environment = {},
  execution = {},
  messageBlocks = {},
  contextBuild = {},
} = {}) {
  const normalizedIdentity = normalizeAgentContextIdentity(identity);
  const blocks = {
    system: Array.isArray(messageBlocks.system) ? messageBlocks.system : [],
    history: Array.isArray(messageBlocks.history) ? messageBlocks.history : [],
    incremental: Array.isArray(messageBlocks.incremental) ? messageBlocks.incremental : [],
  };
  return createAgentContextEnvelope({
    identity: normalizedIdentity,
    environment,
    execution: {
      ...plainObject(execution),
      contextBuild: createContextBuildReceipt({
        ...plainObject(contextBuild),
        scope: {
          sessionId: normalizedIdentity.sessionId,
          dialogProcessId: normalizedIdentity.dialogProcessId,
          turnScopeId: normalizedIdentity.turnScopeId,
        },
        messageCount: blocks.history.length,
      }),
    },
    modelContext: {
      protocolVersion: MODEL_CONTEXT_PROTOCOL_VERSION,
      activeTurnIdentity: {
        dialogProcessId: normalizedIdentity.dialogProcessId,
        turnScopeId: normalizedIdentity.turnScopeId,
      },
      messageBlocks: blocks,
    },
  });
}
