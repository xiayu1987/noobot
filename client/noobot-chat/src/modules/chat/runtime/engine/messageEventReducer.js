/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  MESSAGE_CONTENT_EFFECT,
  MESSAGE_EVENT_TYPE,
  projectMessageEventContent,
  resolveMessageEventSequenceIdentity,
  validateMessageEventEnvelope,
} from "@noobot/shared/message-event-protocol";
import {
  initializeMessageEventState,
  resolveMessageEventLaneState,
  syncMessageEventAggregateState,
} from "../../model/messageEventState.js";
import {
  reduceToolTimeline,
  selectToolTimelineLogs,
  TOOL_SEQUENCE_DOMAIN,
  TOOL_TIMELINE_AUTHORITY,
} from "./toolTimeline.js";
import { reduceActivityTimeline } from "./activityTimeline.js";
import {
  logToolLogWindowDebug,
  summarizeToolLogWindow,
  summarizeToolLogWindowItem,
} from "../../../debug/loggers/toolLogWindowDebugLogger.js";

export { initializeMessageEventState } from "../../model/messageEventState.js";

const text = (value) => String(value || "").trim();

export const MESSAGE_EVENT_REDUCE_RESULT = Object.freeze({
  APPLIED: "applied",
  DUPLICATE: "duplicate",
  STALE: "stale",
  SEQUENCE_GAP: "sequence_gap",
  INVALID: "invalid",
  TARGET_MISSING: "target_missing",
  MESSAGE_IDENTITY_CONFLICT: "message_identity_conflict",
});

function stateFor(message, event) {
  return resolveMessageEventLaneState(message, event);
}

function conflicts(message, event) {
  const messageId = text(message.messageId || message.id);
  if (
    messageId &&
    messageId !== text(event.messageId) &&
    message?.turnPlaceholder !== true
  ) return true;
  const messageTurn = text(message.turnScopeId || message.turn_scope_id);
  const eventTurn = text(event.turnScopeId);
  return Boolean(eventTurn && messageTurn !== eventTurn);
}

export function reduceMessageEvent({ targetMessage, event, classifyRealtimeLog } = {}) {
  const validation = validateMessageEventEnvelope(event);
  if (!validation.valid) return { result: MESSAGE_EVENT_REDUCE_RESULT.INVALID, errors: validation.errors };
  if (!targetMessage) return { result: MESSAGE_EVENT_REDUCE_RESULT.TARGET_MISSING };
  if (conflicts(targetMessage, event)) return { result: MESSAGE_EVENT_REDUCE_RESULT.MESSAGE_IDENTITY_CONFLICT };

  const aggregateState = initializeMessageEventState(targetMessage).messageEventState;
  if (aggregateState.consumedEventIds.includes(event.eventId)) {
    return { result: MESSAGE_EVENT_REDUCE_RESULT.DUPLICATE };
  }
  const state = stateFor(targetMessage, event);
  if (state.consumedEventIds.includes(event.eventId)) {
    return { result: MESSAGE_EVENT_REDUCE_RESULT.DUPLICATE };
  }
  const sequence = Number(event.sequence);
  const sequenceScopeId = resolveMessageEventSequenceIdentity(event).sequenceScopeId;
  const lastSequence = Number(state.lastSequence || 0);
  if (lastSequence && sequence <= lastSequence) return { result: MESSAGE_EVENT_REDUCE_RESULT.STALE };
  const gap = Boolean(lastSequence && sequence > lastSequence + 1);

  const contentProjection = projectMessageEventContent(event);
  if (contentProjection.effect === MESSAGE_CONTENT_EFFECT.APPEND) {
    targetMessage.content = String(targetMessage.content || "") + contentProjection.content;
  } else if (contentProjection.effect === MESSAGE_CONTENT_EFFECT.REPLACE) {
    targetMessage.content = contentProjection.content;
    state.finalContentSequence = sequence;
  } else {
    const log = classifyRealtimeLog?.(event);
    if ([MESSAGE_EVENT_TYPE.TOOL_CALL_START, MESSAGE_EVENT_TYPE.TOOL_CALL_END].includes(event.eventType)) {
      logToolLogWindowDebug("frontend.toolLogWindow.messageEventClassified", {
        sessionId: text(event.sessionId || targetMessage.sessionId),
        dialogProcessId: text(event.dialogProcessId || targetMessage.dialogProcessId),
        turnScopeId: text(event.turnScopeId || targetMessage.turnScopeId),
        envelope: summarizeToolLogWindowItem(event),
        classified: log ? summarizeToolLogWindowItem(log) : null,
        previousLastSequence: lastSequence,
      });
    }
    targetMessage.toolTimeline = reduceToolTimeline(targetMessage.toolTimeline, event, log);
    targetMessage.activityTimeline = reduceActivityTimeline(
      targetMessage.activityTimeline,
      log
        ? {
            ...log,
            eventId: event.eventId,
            sequence: event.sequence,
            sequenceScopeId,
            authority: TOOL_TIMELINE_AUTHORITY.AUTHORITATIVE,
            sequenceDomain: TOOL_SEQUENCE_DOMAIN.MESSAGE,
          }
        : {
            ...event,
            sequenceScopeId,
            authority: TOOL_TIMELINE_AUTHORITY.AUTHORITATIVE,
            sequenceDomain: TOOL_SEQUENCE_DOMAIN.MESSAGE,
          },
    );
    if ([MESSAGE_EVENT_TYPE.TOOL_CALL_START, MESSAGE_EVENT_TYPE.TOOL_CALL_END].includes(event.eventType)) {
      logToolLogWindowDebug("frontend.toolLogWindow.messageEventTimelineReduced", {
        sessionId: text(event.sessionId || targetMessage.sessionId),
        dialogProcessId: text(event.dialogProcessId || targetMessage.dialogProcessId),
        turnScopeId: text(event.turnScopeId || targetMessage.turnScopeId),
        appliedSequence: sequence,
        timelineEntryCount: targetMessage.toolTimeline?.length || 0,
        timelineLogs: summarizeToolLogWindow(selectToolTimelineLogs(targetMessage)),
      });
    }
  }
  if (event.dialogProcessId && !targetMessage.dialogProcessId) targetMessage.dialogProcessId = event.dialogProcessId;
  state.lastSequence = sequence;
  state.consumedEventIds = [...state.consumedEventIds, event.eventId].slice(-1000);
  syncMessageEventAggregateState(targetMessage);
  return { result: gap ? MESSAGE_EVENT_REDUCE_RESULT.SEQUENCE_GAP : MESSAGE_EVENT_REDUCE_RESULT.APPLIED, applied: true };
}
