/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

export const RoleEnum = Object.freeze({
  USER: "user",
  ASSISTANT: "assistant",
  TOOL: "tool",
});

export const ConnectorTypeEnum = Object.freeze({
  DATABASE: "database",
  TERMINAL: "terminal",
  EMAIL: "email",
});

export const CONNECTOR_TYPES = Object.freeze([
  ConnectorTypeEnum.DATABASE,
  ConnectorTypeEnum.TERMINAL,
  ConnectorTypeEnum.EMAIL,
]);

export const StreamEventEnum = Object.freeze({
  THINKING: "thinking",
  DELTA: "delta",
  DONE: "done",
  ERROR: "error",
  STOPPED: "stopped",
  INTERACTION_REQUEST: "interaction_request",
});
