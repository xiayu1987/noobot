/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { getEventFamily } from "@noobot/event-protocol";
import { assertAuthorityOutboxRequest } from "@noobot/event-protocol/outbox";
import { locateOutboxSessionDir } from "./outbox-scope.js";
import { isCanonicalText, isObjectLike } from "@noobot/shared/value";
import { SESSION_NOT_FOUND_REASON } from "@noobot/session-protocol";
import { commitImmutableAuthorityEvent } from "./immutable-authority-event.js";
import {
  withImmutableOutbox,
  readImmutablePending,
  recordImmutableAttempts,
  acknowledgeImmutableEvents,
  commitImmutableOutbox,
} from "./immutable-authority-outbox.js";

export async function commitAuthorityEvent({
  userId,
  sessionId,
  family,
  identity,
  causality,
  ordering,
  producer,
  payload,
  persistenceContext,
}) {
  if (!isCanonicalText(userId) || !isCanonicalText(sessionId)) {
    throw new TypeError("authority event commit requires canonical user and session");
  }
  const descriptor = getEventFamily(family);
  if (!descriptor) throw new TypeError(`authority event family not registered: ${family}`);
  if (
    !isObjectLike(ordering) ||
    !isCanonicalText(ordering.domain) ||
    !isCanonicalText(ordering.scopeId)
  ) {
    throw new TypeError("authority event commit requires canonical ordering domain and scope");
  }
  return withImmutableOutbox(this, { userId, sessionId, persistenceContext }, (reader, commit) =>
    commitImmutableAuthorityEvent(
      this,
      reader,
      {
        userId,
        sessionId,
        family,
        identity,
        causality,
        ordering,
        producer,
        payload,
        persistenceContext,
      },
      descriptor,
      commit,
    ),
  );
}

export async function getPendingAuthorityEvents(request) {
  const { userId, sessionId, persistenceContext, consumerId } = assertAuthorityOutboxRequest(
    request,
    "pending",
  );
  const sessionDir = await locateOutboxSessionDir(this, userId, sessionId, persistenceContext);
  if (!sessionDir) return { found: false, reason: SESSION_NOT_FOUND_REASON, events: [] };
  return withImmutableOutbox(this, { userId, sessionId, persistenceContext }, (reader, commit) =>
    readImmutablePending(
      this,
      { userId, sessionId, persistenceContext, consumerId },
      reader,
      commit,
    ),
  );
}

export async function recordAuthorityEventAttempts(request) {
  const {
    userId,
    sessionId,
    persistenceContext,
    consumerId,
    eventIds: requested,
  } = assertAuthorityOutboxRequest(request, "attempt");
  const sessionDir = await locateOutboxSessionDir(this, userId, sessionId, persistenceContext);
  if (!sessionDir) return { recorded: false, reason: SESSION_NOT_FOUND_REASON, events: [] };
  return withImmutableOutbox(this, { userId, sessionId, persistenceContext }, (reader, commit) =>
    recordImmutableAttempts(
      this,
      { userId, sessionId, persistenceContext, consumerId, eventIds: requested },
      reader,
      commit,
    ),
  );
}

export async function acknowledgeAuthorityEvents(request) {
  const {
    userId,
    sessionId,
    persistenceContext,
    consumerId,
    acknowledgements: requested,
  } = assertAuthorityOutboxRequest(request, "ack");
  const sessionDir = await locateOutboxSessionDir(this, userId, sessionId, persistenceContext);
  if (!sessionDir) {
    return { acknowledged: false, reason: SESSION_NOT_FOUND_REASON, delivered: 0, deduplicated: 0 };
  }
  return withImmutableOutbox(this, { userId, sessionId, persistenceContext }, (reader, commit) =>
    acknowledgeImmutableEvents(
      this,
      { userId, sessionId, persistenceContext, consumerId, acknowledgements: requested },
      reader,
      commit,
    ),
  );
}

export async function compactAuthorityEvents(request) {
  const { userId, sessionId, persistenceContext, retainDeliveredAfter } =
    assertAuthorityOutboxRequest(request, "compact");
  const sessionDir = await locateOutboxSessionDir(this, userId, sessionId, persistenceContext);
  if (!sessionDir)
    return { compacted: false, reason: SESSION_NOT_FOUND_REASON, nextRetainedDeliveryAt: null };
  return withImmutableOutbox(
    this,
    { userId, sessionId, persistenceContext },
    async (reader, commit) => {
      const committed = await commitImmutableOutbox(
        this,
        reader,
        {
          outboxMaintenance: { retainDeliveredAfter },
        },
        commit,
      );
      return committed.result.outboxMaintenance;
    },
  );
}
