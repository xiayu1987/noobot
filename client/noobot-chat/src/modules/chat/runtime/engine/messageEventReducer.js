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
  resolveMessageEventPresentationId,
} from "@noobot/event-protocol/message-event";
import { reduceThinkingDetailContentTimelines } from "@noobot/event-protocol/thinking-detail-content";
import {
  appendConsumedMessageEvent,
  hasConsumedMessageEvent,
} from "../../model/messageEventState.js";
import { reduceToolTimeline, selectToolTimelineLogs } from "./toolTimeline.js";
import {
  reduceCanonicalActivityTimeline,
  selectMessageActivityTimeline,
} from "@noobot/event-protocol/activity-timeline";
import { selectMessageToolTimeline } from "@noobot/event-protocol/tool-timeline";
import {
  logToolLogWindowDebug,
  summarizeToolLogWindow,
  summarizeToolLogWindowItem,
} from "../../../debug/loggers/toolLogWindowDebugLogger.js";
import { mergeTransferEnvelopes } from "@noobot/semantic-transfer-protocol";
import { getMessageTransferEnvelopes } from "../../model/transferEnvelopes.js";
import { getMessageAttachments } from "../../model/messageModel.js";

export const MESSAGE_EVENT_REDUCE_RESULT = Object.freeze({
  APPLIED: "applied",
  DUPLICATE: "duplicate",
  STALE: "stale",
  SEQUENCE_GAP: "sequence_gap",
  MESSAGE_IDENTITY_CONFLICT: "message_identity_conflict",
  FINAL_CONTENT_LOCKED: "final_content_locked",
});

function conflicts(message, event) {
  return message.presentationMessageId !== resolveMessageEventPresentationId(event.payload);
}

function finalizeAppliedMessageEvent({ targetMessage, event, state, sequence, transient }) {
  targetMessage.dialogProcessId = event.payload.dialogProcessId;
  Object.assign(targetMessage, projectMessageEventMetadata(event.payload));
  targetMessage.hasFirstStreamEvent = true;

  if (transient) return { result: MESSAGE_EVENT_REDUCE_RESULT.APPLIED, applied: true };
  state.lastSequence = sequence;
  appendConsumedMessageEvent(state, event.identity.eventId);
  return { result: MESSAGE_EVENT_REDUCE_RESULT.APPLIED, applied: true };
}

export function reduceMessageEvent({ targetMessage, state, event }) {
  if (conflicts(targetMessage, event))
    return { result: MESSAGE_EVENT_REDUCE_RESULT.MESSAGE_IDENTITY_CONFLICT };

  if (hasConsumedMessageEvent(state, event.identity.eventId)) {
    return { result: MESSAGE_EVENT_REDUCE_RESULT.DUPLICATE };
  }
  const transient = isTransientMessageEvent(event);
  const { sequence } = event.ordering;
  const { lastSequence } = state;
  if (!transient && sequence <= lastSequence) return { result: MESSAGE_EVENT_REDUCE_RESULT.STALE };

  if (event.payload.eventType === MESSAGE_EVENT_TYPE.TURN_PRESENTATION_COMMITTED) {
    state.lastSequence = sequence;
    appendConsumedMessageEvent(state, event.identity.eventId);
    return { result: MESSAGE_EVENT_REDUCE_RESULT.APPLIED, applied: true };
  }

  if (event.payload.eventType === MESSAGE_EVENT_TYPE.USER_INTERJECTION) {
    targetMessage.thinkingContentTimeline = reduceThinkingDetailContentTimelines(
      targetMessage.thinkingContentTimeline,
      [event.payload.contentFact],
    );
    targetMessage.hasThinkingDetails = true;
    return finalizeAppliedMessageEvent({ targetMessage, event, state, sequence });
  }

  const contentProjection = projectMessageEventContent(event.payload);
  if (
    contentProjection.effect === MESSAGE_CONTENT_EFFECT.APPEND &&
    state.finalContentSequence > 0
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
        sessionId: event.identity.sessionId,
        dialogProcessId: event.payload.dialogProcessId,
        turnScopeId: event.identity.turnScopeId,
        envelope: summarizeToolLogWindowItem(event),
        previousLastSequence: lastSequence,
      }));
    }
    targetMessage.toolTimeline = reduceToolTimeline(
      selectMessageToolTimeline(targetMessage),
      event,
    );
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
    targetMessage.activityTimeline = reduceCanonicalActivityTimeline(
      selectMessageActivityTimeline(targetMessage),
      event,
    );
    if (
      [MESSAGE_EVENT_TYPE.TOOL_CALL_START, MESSAGE_EVENT_TYPE.TOOL_CALL_END].includes(
        event.payload.eventType,
      )
    ) {
      logToolLogWindowDebug("frontend.toolLogWindow.messageEventTimelineReduced", () => ({
        sessionId: event.identity.sessionId,
        dialogProcessId: event.payload.dialogProcessId,
        turnScopeId: event.identity.turnScopeId,
        appliedSequence: sequence,
        timelineEntryCount: targetMessage.toolTimeline.length,
        timelineLogs: summarizeToolLogWindow(selectToolTimelineLogs(targetMessage)),
      }));
    }
  }
  return finalizeAppliedMessageEvent({ targetMessage, event, state, sequence, transient });
}
