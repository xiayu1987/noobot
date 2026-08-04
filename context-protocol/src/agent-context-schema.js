/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

export const AGENT_CONTEXT_KIND = "noobot.agent-context";
export const AGENT_CONTEXT_PROTOCOL_VERSION = 1;
export const MODEL_CONTEXT_PROTOCOL_VERSION = 1;
export const HOOK_CONTEXT_PROTOCOL_VERSION = 1;

export const REQUIRED_AGENT_CONTEXT_IDENTITY_FIELDS = Object.freeze([
  "sessionId",
  "dialogProcessId",
  "turnScopeId",
]);
