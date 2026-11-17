/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  isCanonicalActivityMessageEvent,
  isDurableActivityMessageEvent,
  reduceCanonicalActivityTimeline,
  selectMessageActivityTimeline,
} from "@noobot/event-protocol/activity-timeline";
import {
  isCanonicalToolMessageEvent,
  reduceCanonicalToolTimeline,
  selectMessageToolTimeline,
} from "@noobot/event-protocol/tool-timeline";
import { resolveMessageEventModelMessageId } from "@noobot/event-protocol/message-event";
import { mergeTransferEnvelopes } from "@noobot/semantic-transfer-protocol";
import { text, isFunction, isObjectLike } from "@noobot/shared/value";

export function initializeCurrentTurnMessageEventProjection(runtime = {}) {
  if (!isObjectLike(runtime)) {
    throw new Error("current Turn message event projection requires runtime");
  }
  const store = runtime.currentTurnMessages;
  if (
    !store ||
    !isFunction(store.readAssistantByModelMessageId) ||
    !isFunction(store.updateByUid)
  ) {
    throw new Error(
      "current Turn message event projection requires the canonical currentTurnMessages store",
    );
  }

  const pendingMessageEvents = new Map();
  runtime.projectCurrentTurnMessageEvent = async (envelope) => {
    const eventId = envelope.identity.eventId;
    if (!eventId) {
      throw new TypeError("current Turn message event projection requires envelope identity");
    }
    if (!isCanonicalToolMessageEvent(envelope) && !isCanonicalActivityMessageEvent(envelope)) {
      return envelope;
    }

    const modelMessageId = resolveMessageEventModelMessageId(envelope.payload);
    const owner = modelMessageId ? store.readAssistantByModelMessageId(modelMessageId) : null;
    if (!owner) {
      if (!pendingMessageEvents.has(eventId)) {
        pendingMessageEvents.set(eventId, envelope);
      }
      return envelope;
    }

    const isToolEvent = isCanonicalToolMessageEvent(envelope);
    const currentTimeline = isToolEvent
      ? selectMessageToolTimeline(owner)
      : selectMessageActivityTimeline(owner);
    const transferEnvelopes = envelope.payload.transferEnvelopes ?? [];
    const observed = isToolEvent
      ? currentTimeline.some(
          (item) =>
            text(item?.call?.eventId) === eventId || text(item?.resultEvent?.eventId) === eventId,
        )
      : currentTimeline.some((item) => text(item?.eventId) === eventId);
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
    store.updateByUid(owner.messageUid, patch);

    if (isToolEvent || isDurableActivityMessageEvent(envelope)) {
      await runtime.persistCurrentTurnMessages();
    }
    return envelope;
  };

  const drainPendingMessageEvents = (acceptsOwner) => {
    const facts = [];
    for (const [eventId, envelope] of pendingMessageEvents) {
      const pendingOwnerId = resolveMessageEventModelMessageId(envelope.payload);
      if (!pendingOwnerId || acceptsOwner(pendingOwnerId)) {
        facts.push(envelope);
        pendingMessageEvents.delete(eventId);
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
      { activityTimeline: [], toolTimeline: [] },
    );
  };

  runtime.materializePendingCurrentTurnMessageEvents = (request) => {
    const ownerId = text(request?.modelMessageId);
    if (!ownerId) {
      throw new Error("pending message event materialization requires modelMessageId");
    }
    return drainPendingMessageEvents((pendingOwnerId) => pendingOwnerId === ownerId);
  };

  runtime.materializeUnownedCurrentTurnMessageEvents = () => drainPendingMessageEvents(() => false);

  return runtime;
}
