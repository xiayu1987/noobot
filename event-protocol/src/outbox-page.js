/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { isPlainObject } from "@noobot/shared/value";
import { requireOutbox, requireOutboxText } from "./outbox-delivery.js";
import { QUANTITY_THRESHOLDS } from "@noobot/shared/quantity-thresholds";

export const AUTHORITY_OUTBOX_PAGE_LIMIT =
  QUANTITY_THRESHOLDS.immutableStorage.authorityOutboxPageSize;

export function requireAuthorityOutboxConsumer(consumerId) {
  requireOutboxText(consumerId, "consumerId");
  requireOutbox(
    new TextEncoder().encode(consumerId).length <= 1024,
    "consumerId exceeds byte limit",
  );
  return consumerId;
}

export function requireAuthorityOutboxPagePosition(after, limit) {
  requireOutbox(Number.isSafeInteger(after) && after >= 0, "invalid outbox cursor");
  requireOutbox(
    Number.isSafeInteger(limit) && limit >= 1 && limit <= AUTHORITY_OUTBOX_PAGE_LIMIT,
    "invalid outbox page limit",
  );
}

export function authorityOutboxCommittedPageWindow({ after, limit, tail }) {
  requireAuthorityOutboxPagePosition(after, limit);
  requireOutbox(Number.isSafeInteger(tail) && tail >= after, "invalid committed outbox tail");
  const length = Math.min(limit, tail - after);
  return { length, cursor: after + length };
}

export function requireAuthorityOutboxMigrationPage(page, selection) {
  const { length, cursor } = authorityOutboxCommittedPageWindow(selection);
  requireOutbox(
    isPlainObject(page) &&
      page.cursor === cursor &&
      Array.isArray(page.records) &&
      page.records.length === length,
    "invalid migration outbox page window",
  );
  for (let index = 0; index < length; index++) {
    const record = page.records[index];
    requireOutbox(
      isPlainObject(record) &&
        isPlainObject(record.committed) &&
        record.committed.ordinal === selection.after + index + 1 &&
        typeof record.retired === "boolean" &&
        (record.delivery === null ||
          (!record.retired &&
            isPlainObject(record.delivery) &&
            record.delivery.ordinal === record.committed.ordinal &&
            record.delivery.eventId === record.committed.eventId)),
      "invalid migration outbox page record",
    );
  }
  return page;
}

export function requireAuthorityOutboxCursorAdvances(updates, limit) {
  requireAuthorityOutboxPagePosition(0, limit);
  requireOutbox(Array.isArray(updates), "invalid outbox cursor updates");
  let remaining = limit;
  for (const update of updates) {
    requireOutbox(isPlainObject(update), "invalid outbox cursor update");
    const { consumerId, expectedCursor, cursor } = update;
    requireAuthorityOutboxConsumer(consumerId);
    requireAuthorityOutboxPagePosition(expectedCursor, limit);
    requireOutbox(
      Number.isSafeInteger(cursor) && cursor >= expectedCursor,
      "outbox cursor advance must be monotonic",
    );
    remaining -= cursor - expectedCursor;
    requireOutbox(remaining >= 0, "outbox cursor advances exceed one page per transaction");
  }
}

export function decodeStoredAuthorityOutboxCursor(state, consumerId, tail) {
  requireAuthorityOutboxConsumer(consumerId);
  requireOutbox(Number.isSafeInteger(tail) && tail >= 0, "invalid outbox tail");
  if (state === null) return null;
  requireOutbox(
    isPlainObject(state) &&
      state.consumerId === consumerId &&
      Number.isSafeInteger(state.cursor) &&
      state.cursor > 0 &&
      state.cursor <= tail,
    "invalid stored outbox consumer cursor",
  );
  return state.cursor;
}

export function authorityOutboxPositionKey(ordinal) {
  requireOutbox(Number.isSafeInteger(ordinal) && ordinal >= 1, "invalid event position");
  return String(ordinal);
}
