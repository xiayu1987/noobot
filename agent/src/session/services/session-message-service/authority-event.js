/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { getEventFamily } from "@noobot/event-protocol";
import { assertAuthorityOutboxRequest } from "@noobot/event-protocol/outbox";
import { isCanonicalText, isObjectLike } from "@noobot/shared/value";
import { resolveDeletedSessionAs } from "./session-deleted-result.js";
import { planAuthorityEventCommit } from "./authority-event-plan.js";
import {
  withOutboxReader,
  planPendingOutbox,
  planOutboxDelivery,
  planOutboxAcknowledgement,
  commitOutboxChanges,
} from "./authority-outbox.js";

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
  return this.sessionRepo.withSessionOutboxMutation(
    userId,
    sessionId,
    (reader) =>
      planAuthorityEventCommit(
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
        },
        descriptor,
      ),
    { persistenceContext },
  );
}

function planDelivery(service, request, operation, plan) {
  const input = assertAuthorityOutboxRequest(request, operation);
  const { userId, sessionId, persistenceContext } = input;
  return service.sessionRepo.withSessionOutboxMutation(
    userId,
    sessionId,
    (reader) => plan(service, input, reader),
    { persistenceContext },
  );
}

export async function getPendingAuthorityEvents(request) {
  return resolveDeletedSessionAs(planDelivery(this, request, "pending", planPendingOutbox), {
    found: false,
    events: [],
  });
}

export async function prepareAuthorityEventDelivery(request) {
  return resolveDeletedSessionAs(
    planDelivery(this, request, "prepareDelivery", planOutboxDelivery),
    { found: false, events: [] },
  );
}

export async function acknowledgeAuthorityEvents(request) {
  return resolveDeletedSessionAs(planDelivery(this, request, "ack", planOutboxAcknowledgement), {
    acknowledged: false,
    delivered: 0,
    deduplicated: 0,
  });
}

export async function compactAuthorityEvents(request) {
  const { userId, sessionId, persistenceContext, retainDeliveredAfter } =
    assertAuthorityOutboxRequest(request, "compact");
  return resolveDeletedSessionAs(
    withOutboxReader(this, { userId, sessionId, persistenceContext }, async (reader, commit) => {
      const committed = await commitOutboxChanges(
        this,
        reader,
        {
          outboxMaintenance: { retainDeliveredAfter },
        },
        commit,
      );
      return committed.result.outboxMaintenance;
    }),
    { compacted: false, nextRetainedDeliveryAt: null },
  );
}
