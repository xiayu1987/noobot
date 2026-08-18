/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { INTERACTION_EVENT_TYPE } from "@noobot/event-protocol";
import { ATTACHMENT_LIFECYCLE_WIRE_EVENT } from "@noobot/attachment-protocol";
import {
  EXECUTION_CHILDREN_WIRE_EVENT,
  EXECUTION_SNAPSHOT_WIRE_EVENT,
  EXECUTION_TREE_WIRE_EVENT,
  TURN_LIFECYCLE_WIRE_EVENT,
  TURN_SNAPSHOT_WIRE_EVENT,
} from "@noobot/session-protocol";
import { AGENT_TRANSPORT_EVENT } from "@noobot/agent-transport-protocol";

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
  INTERACTION_REQUEST: INTERACTION_EVENT_TYPE.REQUEST,
  CONNECTOR_STATUS: "connector_status",
  ATTACHMENTS: "attachments",
  ATTACHMENT_LIFECYCLE: ATTACHMENT_LIFECYCLE_WIRE_EVENT,
  CHANNEL_STATE: AGENT_TRANSPORT_EVENT.CHANNEL_STATE,
  TURN_LIFECYCLE: TURN_LIFECYCLE_WIRE_EVENT,
  TURN_SNAPSHOT: TURN_SNAPSHOT_WIRE_EVENT,
  EXECUTION_SNAPSHOT: EXECUTION_SNAPSHOT_WIRE_EVENT,
  EXECUTION_CHILDREN: EXECUTION_CHILDREN_WIRE_EVENT,
  EXECUTION_TREE: EXECUTION_TREE_WIRE_EVENT,
  RECONNECT_DATA: AGENT_TRANSPORT_EVENT.RECONNECT_DATA,
  RECONNECT_COMPLETE: AGENT_TRANSPORT_EVENT.RECONNECT_COMPLETE,
});
