/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  isCanonicalActivityMessageEvent,
  isDurableActivityMessageEvent,
  reduceCanonicalActivityTimeline,
} from "@noobot/event-protocol/activity-timeline";
import {
  isCanonicalToolMessageEvent,
  reduceCanonicalToolTimeline,
} from "@noobot/event-protocol/tool-timeline";
import { resolveMessageEventModelMessageId } from "@noobot/event-protocol/message-event";

function text(value) {
  return String(value || "").trim();
}

export function initializeCurrentTurnMessageEventProjection(runtime = {}) {
  if (!runtime || typeof runtime !== "object") {
    throw new Error("current Turn message event projection requires runtime");
  }
  const store = runtime.currentTurnMessages;
  if (!store || typeof store.toArray !== "function" || typeof store.updateWhere !== "function") {
    throw new Error(
      "current Turn message event projection requires the canonical currentTurnMessages store",
    );
  }

  const pendingMessageEvents = [];
  runtime.projectCurrentTurnMessageEvent = async (envelope = {}) => {
    if (!envelope || typeof envelope !== "object") return null;
    const eventId = text(envelope?.identity?.eventId);
    if (!eventId) return null;
    if (!isCanonicalToolMessageEvent(envelope) && !isCanonicalActivityMessageEvent(envelope)) {
      return envelope;
    }

    const modelMessageId = resolveMessageEventModelMessageId(envelope?.payload);
    const messages = store.toArray();
    const ownerIndex = modelMessageId
      ? messages.findIndex(
          (item) => item?.role === "assistant" && text(item?.messageId) === modelMessageId,
        )
      : -1;
    if (ownerIndex < 0) {
      if (!pendingMessageEvents.some((item) => text(item?.identity?.eventId) === eventId)) {
        pendingMessageEvents.push(envelope);
      }
      return envelope;
    }
    const owner = messages[ownerIndex];

    const isToolEvent = isCanonicalToolMessageEvent(envelope);
    const currentTimeline = isToolEvent ? owner.toolTimeline : owner.activityTimeline;
    const transferEnvelopes = Array.isArray(envelope?.payload?.transferEnvelopes)
      ? envelope.payload.transferEnvelopes
      : [];
    const observed = isToolEvent
      ? (Array.isArray(currentTimeline) ? currentTimeline : []).some(
          (item) =>
            text(item?.call?.eventId) === eventId || text(item?.resultEvent?.eventId) === eventId,
        )
      : (Array.isArray(currentTimeline) ? currentTimeline : []).some(
          (item) => text(item?.eventId) === eventId,
        );
    if (observed) return envelope;

    const patch = isToolEvent
      ? {
          toolTimeline: reduceCanonicalToolTimeline(currentTimeline, envelope),
          ...(transferEnvelopes.length
            ? {
                transferEnvelopes: [
                  ...(Array.isArray(owner.transferEnvelopes) ? owner.transferEnvelopes : []),
                  ...transferEnvelopes,
                ].filter(
                  (item, index, all) =>
                    all.findIndex(
                      (candidate) =>
                        text(candidate?.transferId) === text(item?.transferId) &&
                        text(candidate?.messageId) === text(item?.messageId),
                    ) === index,
                ),
              }
            : {}),
        }
      : {
          activityTimeline: reduceCanonicalActivityTimeline(currentTimeline, envelope),
        };
    store.updateWhere(patch, (_item, index) => index === ownerIndex);

    if (isToolEvent || isDurableActivityMessageEvent(envelope)) {
      await runtime.persistCurrentTurnMessages?.();
    }
    return envelope;
  };

  runtime.materializePendingCurrentTurnMessageEvents = ({
    messageId = "",
    activityTimeline = [],
    toolTimeline = [],
  } = {}) => {
    const ownerId = text(messageId);
    if (!ownerId) throw new Error("pending message event materialization requires messageId");

    const facts = [];
    for (let index = pendingMessageEvents.length - 1; index >= 0; index -= 1) {
      const pendingOwnerId = resolveMessageEventModelMessageId(
        pendingMessageEvents[index]?.payload,
      );
      if (!pendingOwnerId || pendingOwnerId === ownerId) {
        facts.unshift(...pendingMessageEvents.splice(index, 1));
      }
    }
    return facts.reduce(
      (projection, fact) => {
        if (isCanonicalToolMessageEvent(fact)) {
          projection.toolTimeline = reduceCanonicalToolTimeline(projection.toolTimeline, fact);
        } else if (isCanonicalActivityMessageEvent(fact)) {
          projection.activityTimeline = reduceCanonicalActivityTimeline(
            projection.activityTimeline,
            fact,
          );
        }
        return projection;
      },
      {
        activityTimeline: Array.isArray(activityTimeline) ? [...activityTimeline] : [],
        toolTimeline: Array.isArray(toolTimeline) ? [...toolTimeline] : [],
      },
    );
  };

  return runtime;
}
