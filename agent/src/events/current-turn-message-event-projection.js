/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  isActivityMessageEvent,
  isToolMessageEvent,
  reduceCanonicalToolTimeline,
} from "./canonical-message-timeline.js";

function text(value) {
  return String(value || "").trim();
}

export function initializeCurrentTurnMessageEventProjection(runtime = {}, {
  sequenceScopeId = "",
} = {}) {
  if (!runtime || typeof runtime !== "object") {
    throw new Error("current Turn message event projection requires runtime");
  }
  const store = runtime.currentTurnMessages;
  if (
    !store ||
    typeof store.toArray !== "function" ||
    typeof store.updateWhere !== "function"
  ) {
    throw new Error("current Turn message event projection requires the canonical currentTurnMessages store");
  }

  const pendingMessageEvents = [];
  const activityState = runtime.systemRuntime && typeof runtime.systemRuntime === "object"
    ? runtime.systemRuntime
    : (runtime.systemRuntime = {});
  activityState.activityTimeline = activityState.activityTimeline && typeof activityState.activityTimeline === "object"
    ? activityState.activityTimeline
    : { sequence: 0 };

  const reduceCurrentTurnActivity = (activityFact = {}) => {
    const eventId = text(activityFact.eventId);
    if (!eventId) return null;
    const sequence = Number(activityFact.sequence) > 0
      ? Number(activityFact.sequence)
      : (activityState.activityTimeline.sequence += 1);
    activityState.activityTimeline.sequence = Math.max(
      Number(activityState.activityTimeline.sequence || 0),
      sequence,
    );
    return {
      ...activityFact,
      sequence,
      sequenceDomain: text(activityFact.sequenceDomain || "message-event"),
      sequenceScopeId: text(
        activityFact.sequenceScopeId ||
          runtime?.runConfig?.presentationMessageId ||
          runtime?.systemRuntime?.turnScopeId ||
          sequenceScopeId ||
          "turn",
      ),
      authority: text(activityFact.authority || "authoritative"),
    };
  };

  runtime.projectCurrentTurnMessageEvent = (envelope = {}) => {
    if (!envelope || typeof envelope !== "object") return null;
    const eventId = text(envelope.eventId);
    if (!eventId) return null;
    if (!isToolMessageEvent(envelope) && !isActivityMessageEvent(envelope)) return envelope;

    const messages = store.toArray();
    const existingAssistantIndex = [...messages]
      .map((item, index) => ({ item, index }))
      .reverse()
      .find(({ item }) => item?.role === "assistant");
    if (!existingAssistantIndex) {
      if (!pendingMessageEvents.some((item) => item.eventId === eventId)) {
        pendingMessageEvents.push(envelope);
      }
      return envelope;
    }

    const isToolEvent = isToolMessageEvent(envelope);
    const currentTimeline = isToolEvent
      ? existingAssistantIndex.item.toolTimeline
      : existingAssistantIndex.item.activityTimeline;
    const transferEnvelopes = Array.isArray(envelope.transferEnvelopes)
      ? envelope.transferEnvelopes
      : [];
    const observed = isToolEvent
      ? (Array.isArray(currentTimeline) ? currentTimeline : []).some((item) =>
          text(item?.call?.eventId) === eventId || text(item?.resultEvent?.eventId) === eventId)
      : (Array.isArray(currentTimeline) ? currentTimeline : []).some((item) => text(item?.eventId) === eventId);
    if (observed) return envelope;

    const patch = isToolEvent
      ? {
          toolTimeline: reduceCanonicalToolTimeline(currentTimeline, envelope),
          ...(transferEnvelopes.length
            ? {
                transferEnvelopes: [
                  ...(Array.isArray(existingAssistantIndex.item.transferEnvelopes)
                    ? existingAssistantIndex.item.transferEnvelopes
                    : []),
                  ...transferEnvelopes,
                ].filter((item, index, all) => all.findIndex((candidate) =>
                  text(candidate?.transferId) === text(item?.transferId) &&
                  text(candidate?.messageId) === text(item?.messageId),
                ) === index),
              }
            : {}),
        }
      : {
          activityTimeline: [
            ...(Array.isArray(currentTimeline) ? currentTimeline : []),
            reduceCurrentTurnActivity(envelope),
          ],
        };
    store.updateWhere(
      patch,
      (_item, index) => index === existingAssistantIndex.index,
    );
    void runtime.persistCurrentTurnMessages?.();
    return envelope;
  };

  runtime.materializePendingCurrentTurnMessageEvents = ({
    activityTimeline = [],
    toolTimeline = [],
  } = {}) => {
    const facts = pendingMessageEvents.splice(0, pendingMessageEvents.length);
    return facts.reduce((projection, fact) => {
      if (isToolMessageEvent(fact)) {
        projection.toolTimeline = reduceCanonicalToolTimeline(projection.toolTimeline, fact);
      } else if (isActivityMessageEvent(fact)) {
        projection.activityTimeline.push(reduceCurrentTurnActivity(fact));
      }
      return projection;
    }, {
      activityTimeline: Array.isArray(activityTimeline) ? [...activityTimeline] : [],
      toolTimeline: Array.isArray(toolTimeline) ? [...toolTimeline] : [],
    });
  };

  return runtime;
}
