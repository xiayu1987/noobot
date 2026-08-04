/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { AGENT_CONTEXT_KIND, AGENT_CONTEXT_PROTOCOL_VERSION } from "./agent-context-schema.js";
import { normalizeAgentContextIdentity } from "./agent-context-identity.js";
import { assertValidAgentContextEnvelope } from "./agent-context-validation.js";

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
