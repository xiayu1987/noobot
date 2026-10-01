/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { TURN_LIFECYCLE_WIRE_EVENT, isTerminalTurnEvent } from "@noobot/session-protocol";
import { INTERACTION_EVENT_TYPE } from "@noobot/event-protocol";
import {
  MESSAGE_CONTENT_EFFECT,
  MESSAGE_EVENT_TYPE,
  MESSAGE_EVENT_WIRE_EVENT,
  projectMessageEventContent,
} from "@noobot/event-protocol/message-event";

const clean = (value) => String(value ?? "").trim();

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

  function applyLifecycle(envelope) {
    const payload = envelope?.payload || {};
    if (clean(payload.turnScopeId) && clean(payload.turnScopeId) !== turnScopeId) return;
    const revision = Number(payload.revision || envelope?.ordering?.revision || 0);
    if (Number.isInteger(revision) && revision > state.revision) state.revision = revision;
    state.dialogProcessId = clean(payload.dialogProcessId) || state.dialogProcessId;
    state.executionId = clean(payload.executionId) || state.executionId;
    state.lifecycleEvent = clean(payload.eventType) || state.lifecycleEvent;
    if (payload.failure) state.failure = payload.failure;
    if (isTerminalTurnEvent(state.lifecycleEvent)) state.terminal = true;
  }

  function applyMessage(envelope) {
    const payload = envelope?.payload || {};
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
    apply({ event, data } = {}) {
      if (event === TURN_LIFECYCLE_WIRE_EVENT) applyLifecycle(data);
      else if (event === MESSAGE_EVENT_WIRE_EVENT) applyMessage(data);
    },
    content: () => state.content,
  };
}

export function readInteractionRequest({ event, data } = {}) {
  if (event !== INTERACTION_EVENT_TYPE.REQUEST) return null;
  const payload = data?.payload && typeof data.payload === "object" ? data.payload : data;
  return clean(payload?.requestId) ? payload : null;
}

export function readMessageDelta({ event, data } = {}) {
  if (event !== MESSAGE_EVENT_WIRE_EVENT) return null;
  const projection = projectMessageEventContent(data?.payload || {});
  return projection.effect === MESSAGE_CONTENT_EFFECT.APPEND ? projection.content : null;
}

export function readToolFrame({ event, data } = {}) {
  if (event !== MESSAGE_EVENT_WIRE_EVENT) return null;
  const payload = data?.payload || {};
  if (payload.eventType === MESSAGE_EVENT_TYPE.TOOL_CALL_START) {
    return { phase: "start", name: clean(payload.tool) };
  }
  if (payload.eventType === MESSAGE_EVENT_TYPE.TOOL_CALL_END) {
    return { phase: "end", name: clean(payload.tool), success: payload.success !== false };
  }
  return null;
}
