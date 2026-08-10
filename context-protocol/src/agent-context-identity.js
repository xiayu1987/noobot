/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { REQUIRED_AGENT_CONTEXT_IDENTITY_FIELDS } from "./agent-context-schema.js";

function text(value) {
  return String(value || "").trim();
}

export function normalizeAgentContextIdentity(identity = {}) {
  return {
    userId: text(identity?.userId),
    sessionId: text(identity?.sessionId),
    rootSessionId: text(identity?.rootSessionId),
    parentSessionId: text(identity?.parentSessionId),
    dialogProcessId: text(identity?.dialogProcessId),
    turnScopeId: text(identity?.turnScopeId),
    runId: text(identity?.runId),
    messageId: text(identity?.messageId),
  };
}

export function validateAgentContextIdentity(identity = {}) {
  const normalized = normalizeAgentContextIdentity(identity);
  const errors = REQUIRED_AGENT_CONTEXT_IDENTITY_FIELDS
    .filter((field) => !normalized[field])
    .map((field) => `identity.${field} is required`);
  return { success: errors.length === 0, errors, identity: normalized };
}

export function resolveAgentContextIdentity(context = {}) {
  return normalizeAgentContextIdentity(context?.identity);
}
