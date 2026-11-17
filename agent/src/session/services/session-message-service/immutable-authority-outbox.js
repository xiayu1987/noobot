/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { randomUUID } from "node:crypto";
import {
  AUTHORITY_OUTBOX_JOURNAL_OP,
  planAuthorityOutboxAcknowledgements,
  projectAuthorityEventDeliveryResults,
} from "@noobot/event-protocol/outbox";

export function commitImmutableOutbox(service, reader, changes, commit) {
  return commit({
    expectedGeneration: reader.generation,
    operationId: randomUUID(),
    changes,
    committedAt: service.now(),
  });
}

function cursorChange(page, consumerId, acknowledged = new Set()) {
  const firstPending = page.events.find((event) => !acknowledged.has(event.eventId));
  const cursor = firstPending ? firstPending.ordinal - 1 : page.cursor;
  return cursor > page.after ? [{ consumerId, expectedCursor: page.after, cursor }] : [];
}

export async function readImmutablePending(service, request, reader, commit) {
  const page = await reader.readOutboxPage({ consumerId: request.consumerId });
  const outboxCursors = cursorChange(page, request.consumerId);
  if (outboxCursors.length) await commitImmutableOutbox(service, reader, { outboxCursors }, commit);
  return { found: true, events: page.events, hasMore: page.hasMore };
}

export async function recordImmutableAttempts(service, request, reader, commit) {
  const events = await Promise.all(request.eventIds.map((id) => reader.readOutboxEvent(id)));
  if (events.some((event) => event === null))
    return { recorded: false, reason: "event_not_found", events: [] };
  const attemptedAt = service.now();
  const committed = await commitImmutableOutbox(
    service,
    reader,
    {
      deliveries: request.eventIds.map((eventId) => ({
        type: "attempt",
        eventId,
        consumerId: request.consumerId,
        attemptedAt,
      })),
    },
    commit,
  );
  return {
    recorded: true,
    events: projectAuthorityEventDeliveryResults(
      events,
      request.consumerId,
      committed.result.deliveries,
    ),
  };
}

export async function acknowledgeImmutableEvents(service, request, reader, commit) {
  const records = request.acknowledgements.map((item) => ({
    ...item,
    op: AUTHORITY_OUTBOX_JOURNAL_OP.ACK,
    consumerId: request.consumerId,
    deliveredAt: service.now(),
  }));
  const events = await Promise.all(records.map((item) => reader.readOutboxEvent(item.eventId)));
  const projection = {
    entries: new Map(events.filter(Boolean).map((event) => [event.eventId, event])),
  };
  const { records: changed, ...result } = planAuthorityOutboxAcknowledgements(projection, records);
  if (!result.acknowledged) return result;
  const page = await reader.readOutboxPage({ consumerId: request.consumerId });
  const outboxCursors = cursorChange(
    page,
    request.consumerId,
    new Set(records.map((item) => item.eventId)),
  );
  if (changed.length || outboxCursors.length)
    await commitImmutableOutbox(
      service,
      reader,
      {
        deliveries: changed.map(({ op: _op, ...item }) => ({ ...item, type: "acknowledge" })),
        outboxCursors,
      },
      commit,
    );
  return result;
}

export async function withImmutableOutbox(service, request, action) {
  return service.sessionRepo.withSessionReader(
    request.userId,
    request.sessionId,
    (reader, _scope, commit) => action(reader, commit),
    {
      persistenceContext: request.persistenceContext,
    },
  );
}
