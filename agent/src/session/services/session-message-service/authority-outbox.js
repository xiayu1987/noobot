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

export function prepareOutboxChanges(service, reader, changes) {
  return reader.prepareRequest({ operationId: randomUUID(), changes, committedAt: service.now() });
}

export async function commitOutboxChanges(service, reader, changes, commit) {
  return commit(await prepareOutboxChanges(service, reader, changes));
}

function cursorChange(page, consumerId, firstPending) {
  const cursor = firstPending ? firstPending.ordinal - 1 : page.cursor;
  return cursor > page.after ? [{ consumerId, expectedCursor: page.after, cursor }] : [];
}

export async function planPendingOutbox(service, request, reader) {
  const page = await reader.readOutboxPage({ consumerId: request.consumerId });
  const outboxCursors = cursorChange(page, request.consumerId, page.events[0]);
  const result = { found: true, events: page.events, hasMore: page.hasMore };
  if (!outboxCursors.length) return () => result;
  const prepared = await prepareOutboxChanges(service, reader, { outboxCursors });
  return async (commit) => {
    await commit(prepared);
    return result;
  };
}

export async function planOutboxDelivery(service, { consumerId }, reader) {
  const page = await reader.readOutboxPage({ consumerId });
  const { events, hasMore } = page;
  const outboxCursors = cursorChange(page, consumerId, events[0]);
  if (!events.length && !outboxCursors.length) return () => ({ found: true, events, hasMore });
  const attemptedAt = service.now();
  const prepared = await prepareOutboxChanges(service, reader, {
    outboxCursors,
    deliveries: events.map(({ eventId }) => ({
      type: "attempt",
      eventId,
      consumerId,
      attemptedAt,
    })),
  });
  return async (commit) => {
    const committed = await commit(prepared);
    return {
      found: true,
      events: projectAuthorityEventDeliveryResults(events, consumerId, committed.result.deliveries),
      hasMore,
    };
  };
}

export async function planOutboxAcknowledgement(service, request, reader) {
  const records = request.acknowledgements.map((item) => ({
    ...item,
    op: AUTHORITY_OUTBOX_JOURNAL_OP.ACK,
    consumerId: request.consumerId,
    deliveredAt: service.now(),
  }));
  const page = await reader.readOutboxPage({ consumerId: request.consumerId });
  const pendingById = new Map(page.events.map((event) => [event.eventId, event]));
  const events = await Promise.all(
    records.map(({ eventId }) => pendingById.get(eventId) ?? reader.readOutboxEvent(eventId)),
  );
  const projection = {
    entries: new Map(events.filter(Boolean).map((event) => [event.eventId, event])),
  };
  const { records: changed, ...result } = planAuthorityOutboxAcknowledgements(projection, records);
  if (!result.acknowledged) return () => result;
  const acknowledgedIds = new Set(records.map((item) => item.eventId));
  const firstPending = page.events.find((event) => !acknowledgedIds.has(event.eventId));
  const outboxCursors = cursorChange(page, request.consumerId, firstPending);
  const outcome = { ...result, drained: !page.hasMore && firstPending === undefined };
  if (!changed.length && !outboxCursors.length) return () => outcome;
  const prepared = await prepareOutboxChanges(service, reader, {
    deliveries: changed.map(({ op: _op, ...item }) => ({ ...item, type: "acknowledge" })),
    outboxCursors,
  });
  return async (commit) => {
    await commit(prepared);
    return outcome;
  };
}

export async function withOutboxReader(service, request, action) {
  return service.sessionRepo.withSessionReader(
    request.userId,
    request.sessionId,
    ({ reader, commitChanges }) => action(reader, commitChanges),
    {
      persistenceContext: request.persistenceContext,
    },
  );
}
