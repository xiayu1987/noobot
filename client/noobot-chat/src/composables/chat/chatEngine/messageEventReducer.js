/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  MESSAGE_EVENT_TYPE,
  validateMessageEventEnvelope,
} from "@noobot/shared/message-event-protocol";
import { initializeMessageEventState } from "../../infra/messageEventState";
import {
  reduceToolTimeline,
  selectToolTimelineLogs,
  TOOL_SEQUENCE_DOMAIN,
  TOOL_TIMELINE_AUTHORITY,
} from "./toolTimeline";
import { reduceActivityTimeline } from "./activityTimeline";
import {
  logToolLogWindowDebug,
  summarizeToolLogWindow,
  summarizeToolLogWindowItem,
} from "../debug/toolLogWindowDebugLogger";

export { initializeMessageEventState } from "../../infra/messageEventState";

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

function stateFor(message) {
  return initializeMessageEventState(message).messageEventState;
}

function conflicts(message, event) {
  const messageId = text(message.messageId || message.id);
  if (messageId && messageId !== text(event.messageId)) return true;
  const messageTurn = text(message.turnScopeId || message.turn_scope_id);
  const eventTurn = text(event.turnScopeId);
  // Authoritative turn-scoped events must never be reduced into an
  // unscoped/other-turn message. In particular, stop -> continue can reuse the
  // dialogProcessId, so dialog identity is not sufficient to establish event
  // ownership.
  return Boolean(eventTurn && messageTurn !== eventTurn);
}

/** The only authoritative main-session event state transition. */
export function reduceMessageEvent({ targetMessage, event, classifyRealtimeLog } = {}) {
  const validation = validateMessageEventEnvelope(event);
  if (!validation.valid) return { result: MESSAGE_EVENT_REDUCE_RESULT.INVALID, errors: validation.errors };
  if (!targetMessage) return { result: MESSAGE_EVENT_REDUCE_RESULT.TARGET_MISSING };
  if (conflicts(targetMessage, event)) return { result: MESSAGE_EVENT_REDUCE_RESULT.MESSAGE_IDENTITY_CONFLICT };

  const state = stateFor(targetMessage);
  if (state.consumedEventIds.includes(event.eventId)) return { result: MESSAGE_EVENT_REDUCE_RESULT.DUPLICATE };
  const sequence = Number(event.sequence);
  const lastSequence = Number(state.lastSequence || 0);
  if (lastSequence && sequence <= lastSequence) return { result: MESSAGE_EVENT_REDUCE_RESULT.STALE };
  const gap = Boolean(lastSequence && sequence > lastSequence + 1);

  if (event.eventType === MESSAGE_EVENT_TYPE.LLM_DELTA) {
    targetMessage.content = String(targetMessage.content || "") + event.text;
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
    // Tool and non-tool activities are separate projections. The activity
    // normalizer rejects tool logs, so a transport fact can never be owned by
    // both timelines.
    targetMessage.activityTimeline = reduceActivityTimeline(
      targetMessage.activityTimeline,
      log
        ? {
            ...log,
            eventId: event.eventId,
            sequence: event.sequence,
            authority: TOOL_TIMELINE_AUTHORITY.AUTHORITATIVE,
            sequenceDomain: TOOL_SEQUENCE_DOMAIN.MESSAGE,
          }
        : {
            ...event,
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
  return { result: gap ? MESSAGE_EVENT_REDUCE_RESULT.SEQUENCE_GAP : MESSAGE_EVENT_REDUCE_RESULT.APPLIED, applied: true };
}
