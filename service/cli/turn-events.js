/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { TURN_LIFECYCLE_WIRE_EVENT, isTerminalTurnEvent } from "@noobot/session-protocol";
import {
  EVENT_FAMILY,
  INTERACTION_EVENT_TYPE,
  readProtocolEventPayload,
} from "@noobot/event-protocol";
import {
  MESSAGE_CONTENT_EFFECT,
  MESSAGE_EVENT_TYPE,
  MESSAGE_EVENT_WIRE_EVENT,
  projectMessageEventContent,
} from "@noobot/event-protocol/message-event";

const CLI_PROTOCOL_EVENT_FAMILY = Object.freeze({
  [TURN_LIFECYCLE_WIRE_EVENT]: EVENT_FAMILY.TURN_LIFECYCLE,
  [MESSAGE_EVENT_WIRE_EVENT]: EVENT_FAMILY.MESSAGE_TIMELINE,
  [INTERACTION_EVENT_TYPE.REQUEST]: EVENT_FAMILY.INTERACTION_REQUEST,
});

export function readCliTurnEvent({ event, data }) {
  if (!Object.hasOwn(CLI_PROTOCOL_EVENT_FAMILY, event)) return null;
  const read = readProtocolEventPayload(data, {
    wireEvent: event,
    family: CLI_PROTOCOL_EVENT_FAMILY[event],
  });
  if (!read.valid) return Object.freeze({ event, valid: false, errors: read.errors });
  return Object.freeze({ event, valid: true, payload: read.payload });
}

export function createTurnTracker({ sessionId, turnScopeId }) {
  const state = {
    sessionId,
    turnScopeId,
    dialogProcessId: "",
    executionId: "",
    revision: 0,
    lifecycleEvent: "",
    terminal: false,
    content: "",
    contentLocked: false,
    failure: null,
  };

  function applyLifecycle(payload) {
    if (payload.turnScopeId !== turnScopeId) return;
    if (payload.revision > state.revision) state.revision = payload.revision;
    state.dialogProcessId = payload.dialogProcessId;
    if (payload.executionId) state.executionId = payload.executionId;
    state.lifecycleEvent = payload.eventType;
    if (payload.failure) state.failure = payload.failure;
    if (isTerminalTurnEvent(state.lifecycleEvent)) state.terminal = true;
  }

  function applyMessage(payload) {
    const projection = projectMessageEventContent(payload);
    if (projection.effect === MESSAGE_CONTENT_EFFECT.APPEND) {
      if (!state.contentLocked) state.content += projection.content;
    } else if (projection.effect === MESSAGE_CONTENT_EFFECT.REPLACE) {
      state.content = projection.content;
      if (payload.eventType === MESSAGE_EVENT_TYPE.AUTHORITATIVE_FINAL_CONTENT) {
        state.contentLocked = true;
      }
    }
  }

  return {
    state,
    apply({ event, payload }) {
      if (event === TURN_LIFECYCLE_WIRE_EVENT) applyLifecycle(payload);
      else if (event === MESSAGE_EVENT_WIRE_EVENT) applyMessage(payload);
    },
    content: () => state.content,
  };
}

export function readInteractionRequest({ event, payload }) {
  return event === INTERACTION_EVENT_TYPE.REQUEST ? payload : null;
}

export function readMessageDelta({ event, payload }) {
  if (event !== MESSAGE_EVENT_WIRE_EVENT) return null;
  const projection = projectMessageEventContent(payload);
  return projection.effect === MESSAGE_CONTENT_EFFECT.APPEND ? projection.content : null;
}

export function readToolFrame({ event, payload }) {
  if (event !== MESSAGE_EVENT_WIRE_EVENT) return null;
  if (payload.eventType === MESSAGE_EVENT_TYPE.TOOL_CALL_START) {
    return { phase: "start", name: payload.tool };
  }
  if (payload.eventType === MESSAGE_EVENT_TYPE.TOOL_CALL_END) {
    return { phase: "end", name: payload.tool, success: payload.success };
  }
  return null;
}
