/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { requireCommittedAuthorityEvent } from "@noobot/event-protocol/outbox";
import {
  EVENT_FAMILY,
  INTERACTION_EVENT_TYPE,
  INTERACTION_SEQUENCE_DOMAIN,
  validateInteractionRequestPayload,
} from "@noobot/event-protocol";
import { text as clean } from "@noobot/shared/value";

export function createInteractionAuthorityBridge({ resolveBot, dispatchAuthorityEvents }) {
  return async function commitInteractionRequest({ userId, payload, persistenceScope }) {
    const validation = validateInteractionRequestPayload(payload);
    if (!validation.valid) throw new TypeError(`invalid interaction request: ${validation.reason}`);
    const { session } = resolveBot();
    const sessionId = clean(payload.sessionId);
    const turnScopeId = clean(payload.turnScopeId);
    const requestId = clean(payload.requestId);
    if (!clean(userId) || !sessionId || !turnScopeId) {
      throw new TypeError("interaction authority commit requires user, session and Turn identity");
    }
    const domainPayload = {
      ...payload,
      sessionId: undefined,
      turnScopeId: undefined,
    };
    delete domainPayload.sessionId;
    delete domainPayload.turnScopeId;
    const committed = await session.commitAuthorityEvent({
      userId: clean(userId),
      sessionId,
      family: EVENT_FAMILY.INTERACTION_REQUEST,
      identity: {
        eventType: INTERACTION_EVENT_TYPE.REQUEST,
        turnScopeId,
      },
      causality: {},
      ordering: { domain: INTERACTION_SEQUENCE_DOMAIN, scopeId: requestId },
      producer: { type: "service", id: "websocket.user-interaction" },
      payload: domainPayload,
      persistenceScope,
    });
    const committedEnvelope = requireCommittedAuthorityEvent(committed);
    const dispatch = await dispatchAuthorityEvents({
      userId: clean(userId),
      sessionId,
      persistenceScope,
    });
    if (dispatch?.dispatched !== true) {
      throw new Error(dispatch?.reason || "interaction_authority_dispatch_failed");
    }
    return committedEnvelope;
  };
}
