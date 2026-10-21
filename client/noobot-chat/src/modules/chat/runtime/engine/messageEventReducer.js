/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  MESSAGE_CONTENT_EFFECT,
  MESSAGE_EVENT_TYPE,
  isAuthoritativeFinalContentEvent,
  isTransientMessageEvent,
  projectAuthoritativeFinalMessage,
  projectMessageEventContent,
  projectMessageEventMetadata,
  projectUserInterjectionContentFact,
  resolveMessageEventPresentationId,
} from "@noobot/event-protocol/message-event";
import { reduceThinkingDetailContentTimelines } from "@noobot/event-protocol/thinking-detail-content";
import { EVENT_FAMILY, validateProtocolEvent } from "@noobot/event-protocol";
import {
  initializeMessageEventState,
  appendConsumedMessageEvent,
  hasConsumedMessageEvent,
} from "../../model/messageEventState.js";
import { reduceToolTimeline, selectToolTimelineLogs } from "./toolTimeline.js";
import { reduceActivityTimeline } from "./activityTimeline.js";
import {
  logToolLogWindowDebug,
  summarizeToolLogWindow,
  summarizeToolLogWindowItem,
} from "../../../debug/loggers/toolLogWindowDebugLogger.js";
import {
  getMessageTransferEnvelopes,
  mergeTransferEnvelopes,
} from "../../model/transferEnvelopes.js";
import { getMessageAttachments } from "../../model/messageModel.js";
import { text } from "@noobot/shared/value";

export { initializeMessageEventState } from "../../model/messageEventState.js";

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

function conflicts(message, event) {
  const messageId = text(message.messageId);
  const presentationId = text(message.presentationMessageId);
  const eventPresentationId = resolveMessageEventPresentationId(event.payload);
  if (messageId && messageId !== eventPresentationId && presentationId !== eventPresentationId)
    return true;
  const messageTurn = text(message.turnScopeId);
  const eventTurn = text(event.identity.turnScopeId);
  return Boolean(eventTurn && messageTurn !== eventTurn);
}

function finalizeAppliedMessageEvent({ targetMessage, event, state, sequence, gap, transient }) {
  targetMessage.dialogProcessId = event.payload.dialogProcessId;
  Object.assign(targetMessage, projectMessageEventMetadata(event.payload));
  targetMessage.hasFirstStreamEvent = true;

  if (transient) return { result: MESSAGE_EVENT_REDUCE_RESULT.APPLIED, applied: true };
  state.lastSequence = sequence;
  appendConsumedMessageEvent(state, event.identity.eventId);
  return {
    result: gap ? MESSAGE_EVENT_REDUCE_RESULT.SEQUENCE_GAP : MESSAGE_EVENT_REDUCE_RESULT.APPLIED,
    applied: true,
  };
}

export function reduceMessageEvent({ targetMessage, event } = {}) {
  const validation = validateProtocolEvent(event);
  if (!validation.valid || validation.descriptor?.family !== EVENT_FAMILY.MESSAGE_TIMELINE) {
    return { result: MESSAGE_EVENT_REDUCE_RESULT.INVALID, errors: validation.errors };
  }
  if (!targetMessage) return { result: MESSAGE_EVENT_REDUCE_RESULT.TARGET_MISSING };
  if (conflicts(targetMessage, event))
    return { result: MESSAGE_EVENT_REDUCE_RESULT.MESSAGE_IDENTITY_CONFLICT };

  const state = initializeMessageEventState(targetMessage).messageEventState;
  if (hasConsumedMessageEvent(state, event.identity.eventId)) {
    return { result: MESSAGE_EVENT_REDUCE_RESULT.DUPLICATE };
  }
  const transient = isTransientMessageEvent(event);
  const sequence = Number(event.ordering.sequence);
  const lastSequence = Number(state.lastSequence || 0);
  if (!transient && lastSequence && sequence <= lastSequence)
    return { result: MESSAGE_EVENT_REDUCE_RESULT.STALE };
  const gap = Boolean(!transient && lastSequence && sequence > lastSequence + 1);

  if (event.payload.eventType === MESSAGE_EVENT_TYPE.TURN_PRESENTATION_COMMITTED) {
    state.lastSequence = sequence;
    appendConsumedMessageEvent(state, event.identity.eventId);
    return {
      result: gap ? MESSAGE_EVENT_REDUCE_RESULT.SEQUENCE_GAP : MESSAGE_EVENT_REDUCE_RESULT.APPLIED,
      applied: true,
    };
  }

  if (event.payload.eventType === MESSAGE_EVENT_TYPE.USER_INTERJECTION) {
    const contentFact = projectUserInterjectionContentFact(event.payload);
    if (!contentFact) {
      return { result: MESSAGE_EVENT_REDUCE_RESULT.INVALID };
    }
    targetMessage.thinkingContentTimeline = reduceThinkingDetailContentTimelines(
      targetMessage.thinkingContentTimeline,
      [contentFact],
    );
    targetMessage.hasThinkingDetails = true;
    return finalizeAppliedMessageEvent({ targetMessage, event, state, sequence, gap });
  }

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
    if (
      [MESSAGE_EVENT_TYPE.TOOL_CALL_START, MESSAGE_EVENT_TYPE.TOOL_CALL_END].includes(
        event.payload.eventType,
      )
    ) {
      logToolLogWindowDebug("frontend.toolLogWindow.messageEventClassified", () => ({
        sessionId: text(event.identity.sessionId || targetMessage.sessionId),
        dialogProcessId: text(event.payload.dialogProcessId || targetMessage.dialogProcessId),
        turnScopeId: text(event.identity.turnScopeId || targetMessage.turnScopeId),
        envelope: summarizeToolLogWindowItem(event),
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
    targetMessage.activityTimeline = reduceActivityTimeline(targetMessage.activityTimeline, event);
    if (
      [MESSAGE_EVENT_TYPE.TOOL_CALL_START, MESSAGE_EVENT_TYPE.TOOL_CALL_END].includes(
        event.payload.eventType,
      )
    ) {
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
  return finalizeAppliedMessageEvent({ targetMessage, event, state, sequence, gap, transient });
}
