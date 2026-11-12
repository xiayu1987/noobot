/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { assertTurnLifecycleRecordIntegrity, TURN_EVENT_VALUES } from "@noobot/session-protocol";
import {
  AUTHORITY_OUTBOX_JOURNAL_OP,
  authorityOutboxSequenceKey,
  readAuthorityOutboxSequenceFloor,
} from "./authority-event-outbox.js";
import { requireOutbox } from "./outbox-delivery.js";

export function assertPreparedTurnReceipt(prepared, receipt) {
  const { eventId, committedAt } = receipt;
  requireOutbox(Boolean(prepared), `lifecycle receipt has no prepared event: ${eventId}`);
  requireOutbox(
    prepared.eventId === eventId &&
      prepared.envelope.identity.eventId === eventId &&
      prepared.committedAt === committedAt &&
      prepared.envelope.ordering.sequence === receipt.sequence &&
      prepared.envelope.ordering.revision === receipt.revision &&
      prepared.envelope.identity.turnScopeId === receipt.turnScopeId,
    `conflicting lifecycle receipt: ${eventId}`,
  );
  return prepared;
}

export function collectUnmaterializedTurnCommits(projection, lifecycle, checkpoint) {
  assertTurnLifecycleRecordIntegrity(lifecycle);
  const additions = [];
  for (const receipt of lifecycle.commandReceipts) {
    if (!TURN_EVENT_VALUES.includes(receipt.type)) continue;
    const { eventId } = receipt;
    const prepared = projection.prepared.get(eventId);
    assertPreparedTurnReceipt(prepared, receipt);
    const existing = projection.entries.get(eventId);
    if (existing) continue;
    const { domain, scopeId, sequence } = prepared.envelope.ordering;
    const floor = readAuthorityOutboxSequenceFloor(
      checkpoint,
      authorityOutboxSequenceKey(domain, scopeId),
    );
    if (projection.removedEventIds.has(eventId) || sequence <= floor) continue;
    additions.push({ op: AUTHORITY_OUTBOX_JOURNAL_OP.COMMIT, eventId });
  }
  return additions;
}

export function collectUnmaterializedArtifactCommits(projection, eventIds, checkpoint) {
  return eventIds.flatMap((eventId) => {
    const prepared = projection.prepared.get(eventId);
    requireOutbox(Boolean(prepared), `artifact commit has no prepared event: ${eventId}`);
    const { domain, scopeId, sequence } = prepared.envelope.ordering;
    const floor = readAuthorityOutboxSequenceFloor(
      checkpoint,
      authorityOutboxSequenceKey(domain, scopeId),
    );
    return projection.entries.has(eventId) ||
      projection.removedEventIds.has(eventId) ||
      sequence <= floor
      ? []
      : [{ op: AUTHORITY_OUTBOX_JOURNAL_OP.COMMIT, eventId }];
  });
}
