/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  MESSAGE_CONTENT_EFFECT,
  MESSAGE_EVENT_TYPE,
  isAuthoritativeFinalContentEvent,
  projectAuthoritativeFinalMessage,
  projectMessageEventContent,
  projectMessageEventMetadata,
  resolveMessageEventPresentationId,
} from "@noobot/event-protocol/message-event";
import { EVENT_FAMILY, validateProtocolEvent } from "@noobot/event-protocol";
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
import { getMessageTransferEnvelopes, mergeTransferEnvelopes } from "../../model/transferEnvelopes.js";
import { getMessageAttachments } from "../../model/messageModel.js";

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
  FINAL_CONTENT_LOCKED: "final_content_locked",
});

function stateFor(message, event) {
  return resolveMessageEventLaneState(message, event);
}

function conflicts(message, event) {
  const messageId = text(message.messageId || message.id);
  const presentationId = text(message.presentationMessageId);
  const eventPresentationId = resolveMessageEventPresentationId(event.payload);
  if (messageId && messageId !== eventPresentationId && presentationId !== eventPresentationId) return true;
  const messageTurn = text(message.turnScopeId || message.turn_scope_id);
  const eventTurn = text(event.identity.turnScopeId);
  return Boolean(eventTurn && messageTurn !== eventTurn);
}

export function reduceMessageEvent({ targetMessage, event, classifyRealtimeLog } = {}) {
  const validation = validateProtocolEvent(event);
  if (!validation.valid || validation.descriptor?.family !== EVENT_FAMILY.MESSAGE_TIMELINE) {
    return { result: MESSAGE_EVENT_REDUCE_RESULT.INVALID, errors: validation.errors };
  }
  if (!targetMessage) return { result: MESSAGE_EVENT_REDUCE_RESULT.TARGET_MISSING };
  if (conflicts(targetMessage, event)) return { result: MESSAGE_EVENT_REDUCE_RESULT.MESSAGE_IDENTITY_CONFLICT };

  const aggregateState = initializeMessageEventState(targetMessage).messageEventState;
  if (aggregateState.consumedEventIds.includes(event.identity.eventId)) {
    return { result: MESSAGE_EVENT_REDUCE_RESULT.DUPLICATE };
  }
  const state = stateFor(targetMessage, event);
  if (state.consumedEventIds.includes(event.identity.eventId)) {
    return { result: MESSAGE_EVENT_REDUCE_RESULT.DUPLICATE };
  }
  const sequence = Number(event.ordering.sequence);
  const sequenceScopeId = text(event.ordering.scopeId);
  const lastSequence = Number(state.lastSequence || 0);
  if (lastSequence && sequence <= lastSequence) return { result: MESSAGE_EVENT_REDUCE_RESULT.STALE };
  const gap = Boolean(lastSequence && sequence > lastSequence + 1);

  const contentProjection = projectMessageEventContent(event.payload);
  if (
    contentProjection.effect === MESSAGE_CONTENT_EFFECT.APPEND &&
    Number(state.finalContentSequence || 0) > 0
  ) {
    return { result: MESSAGE_EVENT_REDUCE_RESULT.FINAL_CONTENT_LOCKED };
  }
  if (contentProjection.effect === MESSAGE_CONTENT_EFFECT.APPEND) {
    targetMessage.content = String(targetMessage.content || "") + contentProjection.content;
  } else if (contentProjection.effect === MESSAGE_CONTENT_EFFECT.REPLACE) {
    if (isAuthoritativeFinalContentEvent(event.payload)) {
      const finalProjection = projectAuthoritativeFinalMessage(event.payload);
      const existingEnvelopes = getMessageTransferEnvelopes(targetMessage);
      const existingAttachments = getMessageAttachments(targetMessage);
      const existingRawAttachments = Array.isArray(targetMessage.attachments)
        ? [...targetMessage.attachments]
        : [];
      Object.assign(targetMessage, finalProjection);
      if (Array.isArray(finalProjection.transferEnvelopes)) {
        targetMessage.transferEnvelopes = mergeTransferEnvelopes(
          existingEnvelopes,
          finalProjection.transferEnvelopes,
        );
      }
      if (Array.isArray(finalProjection.attachments)) {
        targetMessage.attachments = finalProjection.attachments;
      } else if (existingAttachments.length || existingRawAttachments.length) {
        targetMessage.attachments = existingAttachments.length
          ? existingAttachments
          : existingRawAttachments;
      }
      targetMessage.attachments = getMessageAttachments(targetMessage);
      state.finalContentSequence = sequence;
    } else {
      targetMessage.content = contentProjection.content;
    }
  } else {
    const log = classifyRealtimeLog?.({
      ...event.payload,
      eventId: event.identity.eventId,
      sessionId: event.identity.sessionId,
      turnScopeId: event.identity.turnScopeId,
      messageId: event.identity.messageId,
      sequence: event.ordering.sequence,
      sequenceDomain: event.ordering.domain,
      sequenceScopeId,
      timestamp: event.occurredAt,
    });
    if ([MESSAGE_EVENT_TYPE.TOOL_CALL_START, MESSAGE_EVENT_TYPE.TOOL_CALL_END].includes(event.payload.eventType)) {
      logToolLogWindowDebug("frontend.toolLogWindow.messageEventClassified", () => ({
        sessionId: text(event.identity.sessionId || targetMessage.sessionId),
        dialogProcessId: text(event.payload.dialogProcessId || targetMessage.dialogProcessId),
        turnScopeId: text(event.identity.turnScopeId || targetMessage.turnScopeId),
        envelope: summarizeToolLogWindowItem(event),
        classified: log ? summarizeToolLogWindowItem(log) : null,
        previousLastSequence: lastSequence,
      }));
    }
    targetMessage.toolTimeline = reduceToolTimeline(targetMessage.toolTimeline, event);
    if (
      event.payload.eventType === MESSAGE_EVENT_TYPE.TOOL_CALL_END &&
      Array.isArray(event.payload.transferEnvelopes) &&
      event.payload.transferEnvelopes.length
    ) {
      const existingEnvelopes = getMessageTransferEnvelopes(targetMessage);
      targetMessage.transferEnvelopes = mergeTransferEnvelopes(
        existingEnvelopes,
        event.payload.transferEnvelopes,
      );
      targetMessage.attachments = getMessageAttachments(targetMessage);
    }
    targetMessage.activityTimeline = reduceActivityTimeline(
      targetMessage.activityTimeline,
      log
        ? {
            ...log,
            eventId: event.identity.eventId,
            sequence: event.ordering.sequence,
            sequenceScopeId,
            authority: TOOL_TIMELINE_AUTHORITY.AUTHORITATIVE,
            sequenceDomain: TOOL_SEQUENCE_DOMAIN.MESSAGE,
          }
        : {
            ...event.payload,
            eventId: event.identity.eventId,
            sessionId: event.identity.sessionId,
            turnScopeId: event.identity.turnScopeId,
            sequence: event.ordering.sequence,
            sequenceScopeId,
            authority: TOOL_TIMELINE_AUTHORITY.AUTHORITATIVE,
            sequenceDomain: TOOL_SEQUENCE_DOMAIN.MESSAGE,
          },
    );
    if ([MESSAGE_EVENT_TYPE.TOOL_CALL_START, MESSAGE_EVENT_TYPE.TOOL_CALL_END].includes(event.payload.eventType)) {
      logToolLogWindowDebug("frontend.toolLogWindow.messageEventTimelineReduced", () => ({
        sessionId: text(event.identity.sessionId || targetMessage.sessionId),
        dialogProcessId: text(event.payload.dialogProcessId || targetMessage.dialogProcessId),
        turnScopeId: text(event.identity.turnScopeId || targetMessage.turnScopeId),
        appliedSequence: sequence,
        timelineEntryCount: targetMessage.toolTimeline?.length || 0,
        timelineLogs: summarizeToolLogWindow(selectToolTimelineLogs(targetMessage)),
      }));
    }
  }
  if (event.payload.dialogProcessId && !targetMessage.dialogProcessId) targetMessage.dialogProcessId = event.payload.dialogProcessId;
  Object.assign(targetMessage, projectMessageEventMetadata(event.payload));
  targetMessage.hasFirstStreamEvent = true;
  state.lastSequence = sequence;
  state.consumedEventIds = [...state.consumedEventIds, event.identity.eventId].slice(-1000);
  syncMessageEventAggregateState(targetMessage);
  return { result: gap ? MESSAGE_EVENT_REDUCE_RESULT.SEQUENCE_GAP : MESSAGE_EVENT_REDUCE_RESULT.APPLIED, applied: true };
}
