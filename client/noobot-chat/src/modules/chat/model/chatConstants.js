/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { EVENT_TYPE } from "@noobot/event-protocol";

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
  DELTA: EVENT_TYPE.DELTA,
  DONE: EVENT_TYPE.DONE,
  ERROR: EVENT_TYPE.ERROR,
  USER_STOPPED: "user_stopped",
  INTERACTION_REQUEST: EVENT_TYPE.INTERACTION_REQUEST,
  CONNECTOR_STATUS: "connector_status",
  ATTACHMENTS: "attachments",
  ATTACHMENT_LIFECYCLE: EVENT_TYPE.ATTACHMENT_LIFECYCLE,
  CHANNEL_STATE: EVENT_TYPE.CHANNEL_STATE,
  TURN_LIFECYCLE: EVENT_TYPE.TURN_LIFECYCLE,
  TURN_SNAPSHOT: EVENT_TYPE.TURN_SNAPSHOT,
  EXECUTION_SNAPSHOT: "execution_snapshot",
  EXECUTION_CHILDREN: "execution_children",
  EXECUTION_TREE: "execution_tree",
  RECONNECT_DATA: EVENT_TYPE.RECONNECT_DATA,
  RECONNECT_COMPLETE: "reconnect_complete",
});
