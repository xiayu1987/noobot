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
import { mergeTransferEnvelopes } from "@noobot/semantic-transfer-protocol";
import { text, isFunction, isObjectLike } from "@noobot/shared/value";

export function initializeCurrentTurnMessageEventProjection(runtime = {}) {
  if (!isObjectLike(runtime)) {
    throw new Error("current Turn message event projection requires runtime");
  }
  const store = runtime.currentTurnMessages;
  if (!store || !isFunction(store.toArray) || !isFunction(store.updateWhere)) {
    throw new Error(
      "current Turn message event projection requires the canonical currentTurnMessages store",
    );
  }

  const pendingMessageEvents = [];
  runtime.projectCurrentTurnMessageEvent = async (envelope) => {
    const eventId = envelope.identity.eventId;
    if (!eventId) {
      throw new TypeError("current Turn message event projection requires envelope identity");
    }
    if (!isCanonicalToolMessageEvent(envelope) && !isCanonicalActivityMessageEvent(envelope)) {
      return envelope;
    }

    const modelMessageId = resolveMessageEventModelMessageId(envelope?.payload);
    const messages = store.toArray();
    const ownerIndex = modelMessageId
      ? messages.findIndex(
          (item) => item?.role === "assistant" && text(item?.modelMessageId) === modelMessageId,
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
                transferEnvelopes: mergeTransferEnvelopes(
                  owner.transferEnvelopes,
                  transferEnvelopes,
                ),
              }
            : {}),
        }
      : {
          activityTimeline: reduceCanonicalActivityTimeline(currentTimeline, envelope),
        };
    store.updateWhere(patch, (_item, index) => index === ownerIndex);

    if (isToolEvent || isDurableActivityMessageEvent(envelope)) {
      await runtime.persistCurrentTurnMessages();
    }
    return envelope;
  };

  const drainPendingMessageEvents = (
    acceptsOwner,
    { activityTimeline = [], toolTimeline = [] },
  ) => {
    const facts = [];
    for (let index = pendingMessageEvents.length - 1; index >= 0; index -= 1) {
      const pendingOwnerId = resolveMessageEventModelMessageId(
        pendingMessageEvents[index]?.payload,
      );
      if (!pendingOwnerId || acceptsOwner(pendingOwnerId)) {
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

  runtime.materializePendingCurrentTurnMessageEvents = ({
    modelMessageId = "",
    ...timelines
  } = {}) => {
    const ownerId = text(modelMessageId);
    if (!ownerId) {
      throw new Error("pending message event materialization requires modelMessageId");
    }
    return drainPendingMessageEvents((pendingOwnerId) => pendingOwnerId === ownerId, timelines);
  };

  runtime.materializeUnownedCurrentTurnMessageEvents = (timelines = {}) =>
    drainPendingMessageEvents(() => false, timelines);

  return runtime;
}
