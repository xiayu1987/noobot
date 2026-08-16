/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
export const EVENT_DEFINITION_CATEGORY = Object.freeze({
  AUTHORITY: "authority",
  INTERACTION: "interaction",
  DATA: "data",
  TRANSPORT: "transport",
});

export const EVENT_TYPE = Object.freeze({
  TURN_LIFECYCLE: "turn_lifecycle",
  TURN_SNAPSHOT: "turn_snapshot",
  TRANSPORT_READY: "transport_ready",
  TRANSPORT_ERROR: "transport_error",
  RECONNECT_COMPLETE: "reconnect_complete",
  USER_STOPPED: "user_stopped",
  CONNECTOR_STATUS: "connector_status",
  ATTACHMENTS: "attachments",
  ATTACHMENT_PARSED: "attachment_parsed",
  EXECUTION_SNAPSHOT: "execution_snapshot",
  EXECUTION_CHILDREN: "execution_children",
  EXECUTION_TREE: "execution_tree",
  INTERACTION_REQUEST: "interaction_request",
  INTERACTION_RESPONSE: "interaction_response",
  CHANNEL_STATE: "channel_state",
  RECONNECT_DATA: "reconnect_data",
  MESSAGE: "message",
  MESSAGE_EVENT: "message_event",
  SUBAGENT_MESSAGE_EVENT: "subagent_message_event",
  DELTA: "delta",
  THINKING: "thinking",
  DONE: "done",
  ERROR: "error",
});

const definitions = new Map([
  [EVENT_TYPE.INTERACTION_REQUEST, {
    eventType: EVENT_TYPE.INTERACTION_REQUEST,
    category: EVENT_DEFINITION_CATEGORY.INTERACTION,
    authoritative: false,
  }],
  [EVENT_TYPE.INTERACTION_RESPONSE, {
    eventType: EVENT_TYPE.INTERACTION_RESPONSE,
    category: EVENT_DEFINITION_CATEGORY.INTERACTION,
    authoritative: false,
  }],
  ...[
    EVENT_TYPE.TRANSPORT_READY,
    EVENT_TYPE.CHANNEL_STATE,
    EVENT_TYPE.RECONNECT_DATA,
    EVENT_TYPE.RECONNECT_COMPLETE,
    EVENT_TYPE.TRANSPORT_ERROR,
  ].map((eventType) => [eventType, {
    eventType,
    category: EVENT_DEFINITION_CATEGORY.TRANSPORT,
    authoritative: false,
  }]),
  ...[
    EVENT_TYPE.MESSAGE,
    EVENT_TYPE.MESSAGE_EVENT,
    EVENT_TYPE.SUBAGENT_MESSAGE_EVENT,
    EVENT_TYPE.DELTA,
    EVENT_TYPE.THINKING,
    EVENT_TYPE.DONE,
    EVENT_TYPE.ERROR,
    EVENT_TYPE.USER_STOPPED,
    EVENT_TYPE.CONNECTOR_STATUS,
    EVENT_TYPE.ATTACHMENTS,
    EVENT_TYPE.ATTACHMENT_PARSED,
    EVENT_TYPE.EXECUTION_SNAPSHOT,
    EVENT_TYPE.EXECUTION_CHILDREN,
    EVENT_TYPE.EXECUTION_TREE,
  ].map((eventType) => [eventType, {
    eventType,
    category: EVENT_DEFINITION_CATEGORY.DATA,
    authoritative: false,
  }]),
]);

export function getEventDefinition(eventType = "") {
  return definitions.get(String(eventType || "").trim()) || null;
}

export function listEventDefinitions() {
  return [...definitions.values()].map((definition) => Object.freeze({ ...definition }));
}

export function validateEventType(eventType = "") {
  const definition = getEventDefinition(eventType);
  return definition
    ? { valid: true, definition, errors: [] }
    : { valid: false, definition: null, errors: ["unsupported_event_type"] };
}

export function validateRegisteredEvent(event = {}) {
  const eventType = event?.eventType || event?.identity?.eventType;
  const typeResult = validateEventType(eventType);
  if (!typeResult.valid) return typeResult;
  return { valid: true, errors: [], definition: typeResult.definition };
}
