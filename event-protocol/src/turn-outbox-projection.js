/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { assertTurnLifecycleRecordIntegrity, TURN_EVENT_VALUES } from "@noobot/session-protocol";
import { stableValue } from "@noobot/shared/value";
import {
  AUTHORITY_OUTBOX_JOURNAL_OP,
  authorityOutboxSequenceKey,
  projectAuthorityOutboxJournal,
  readAuthorityOutboxSequenceFloor,
} from "./authority-event-outbox.js";
import { requireOutbox } from "./outbox-delivery.js";

export function projectCommittedTurnOutbox(records, lifecycle, checkpoint) {
  assertTurnLifecycleRecordIntegrity(lifecycle);
  const committed = new Map(
    projectAuthorityOutboxJournal(records).map((entry) => [entry.eventId, entry]),
  );
  const removed = new Set(
    records
      .filter((record) => record.op === AUTHORITY_OUTBOX_JOURNAL_OP.REMOVE)
      .map((record) => record.eventId),
  );
  const additions = [];
  for (const receipt of lifecycle.commandReceipts) {
    if (!TURN_EVENT_VALUES.includes(receipt.type)) continue;
    const { eventId, envelope, committedAt } = receipt;
    const existing = committed.get(eventId);
    if (existing) {
      requireOutbox(
        JSON.stringify(stableValue(existing.envelope)) === JSON.stringify(stableValue(envelope)) &&
          existing.committedAt === committedAt,
        `conflicting lifecycle receipt: ${eventId}`,
      );
      continue;
    }
    const { domain, scopeId, sequence } = envelope.ordering;
    const floor = readAuthorityOutboxSequenceFloor(
      checkpoint,
      authorityOutboxSequenceKey(domain, scopeId),
    );
    if (removed.has(eventId) || sequence <= floor) continue;
    additions.push({ op: AUTHORITY_OUTBOX_JOURNAL_OP.COMMIT, eventId, envelope, committedAt });
  }
  const projected = [...records, ...additions];
  projectAuthorityOutboxJournal(projected);
  return { records: projected, added: additions.length };
}
