/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

export const AGENT_CONTEXT_KIND = "noobot.agent-context";
export const AGENT_CONTEXT_PROTOCOL_VERSION = 1;
export const MODEL_CONTEXT_PROTOCOL_VERSION = 3;

export const AGENT_CONTEXT_ENVELOPE_KEYS = Object.freeze([
  "kind",
  "protocolVersion",
  "identity",
  "environment",
  "execution",
  "modelContext",
]);

export const MESSAGE_BLOCK_LANES = Object.freeze(["system", "history", "incremental"]);

export const AGENT_CONTEXT_MODEL_CONTEXT_SHAPE = Object.freeze({
  protocolVersion: "modelContextProtocolVersion",
  messageBlocks: Object.freeze(
    Object.fromEntries(MESSAGE_BLOCK_LANES.map((lane) => [lane, "array"])),
  ),
});

export const AGENT_CONTEXT_IDENTITY_SHAPE = Object.freeze({
  userId: "nonEmptyString",
  sessionId: "nonEmptyString",
  rootSessionId: "nonEmptyString",
  parentSessionId: "string",
  dialogProcessId: "nonEmptyString",
  turnScopeId: "nonEmptyString",
  runId: "nonEmptyString",
  presentationMessageId: "nonEmptyString",
});

export const AGENT_CONTEXT_ENVIRONMENT_SHAPE = Object.freeze({
  os: Object.freeze({
    platform: "string",
    arch: "string",
    timezone: "string",
    nodeVersion: "string",
  }),
  workspace: Object.freeze({
    cwd: "string",
    basePath: "string",
    workspaceDirectories: "array",
    globalDefaults: "object",
  }),
  permissions: Object.freeze({ isSuperUser: "boolean" }),
});

export const AGENT_CONTEXT_EXECUTION_SHAPE = Object.freeze({
  timestamp: "string",
  caller: "string",
  flags: Object.freeze({ allowUserInteraction: "boolean", safeConfirm: "boolean" }),
  model: Object.freeze({ runtimeModel: "string", allEnabledProviders: "object" }),
  selectedConnectorIds: "array",
});
