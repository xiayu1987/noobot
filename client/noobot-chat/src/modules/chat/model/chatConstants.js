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
  DELTA: "delta",
  DONE: "done",
  ERROR: "error",
  USER_STOPPED: "user_stopped",
  INTERACTION_REQUEST: "interaction_request",
  CONNECTOR_STATUS: "connector_status",
  ATTACHMENTS: "attachments",
  ATTACHMENT_PARSED: "attachment_parsed",
  CHANNEL_STATE: "channel_state",
  TURN_LIFECYCLE: "turn_lifecycle",
  TURN_SNAPSHOT: "turn_snapshot",
  EXECUTION_SNAPSHOT: "execution_snapshot",
  EXECUTION_CHILDREN: "execution_children",
  EXECUTION_TREE: "execution_tree",
  RECONNECT_DATA: "reconnect_data",
  RECONNECT_COMPLETE: "reconnect_complete",
});
