/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { isPlainObject, isCanonicalText } from "@noobot/shared/value";

export function parseAuthorityOutboxTurnRemoval(source) {
  if (
    !isPlainObject(source) ||
    Object.keys(source).length !== 1 ||
    !Array.isArray(source.turnScopeIds) ||
    !source.turnScopeIds.length ||
    source.turnScopeIds.some((scope) => !isCanonicalText(scope)) ||
    new Set(source.turnScopeIds).size !== source.turnScopeIds.length
  )
    throw new TypeError("Outbox turn removal requires unique canonical turnScopeIds");
  return { turnScopeIds: [...source.turnScopeIds] };
}

export function requireAuthorityOutboxTurnRange(range, turnScopeId, sequence) {
  if (
    !isPlainObject(range) ||
    Object.keys(range).length !== 4 ||
    !isCanonicalText(turnScopeId) ||
    range.turnScopeId !== turnScopeId ||
    !Number.isSafeInteger(sequence) ||
    sequence < 0 ||
    !Number.isSafeInteger(range.lastOrdinal) ||
    range.lastOrdinal < 0 ||
    range.lastOrdinal > sequence ||
    !Number.isSafeInteger(range.removedThrough) ||
    range.removedThrough < 0 ||
    range.removedThrough > range.lastOrdinal ||
    !Number.isSafeInteger(range.eventCount) ||
    range.eventCount < 0 ||
    range.eventCount > range.lastOrdinal - range.removedThrough ||
    (range.eventCount === 0) !== (range.removedThrough === range.lastOrdinal)
  )
    throw new TypeError("Invalid authority outbox turn range");
  return range;
}

export function appendAuthorityOutboxTurnRange(current, turnScopeId, ordinal) {
  if (!Number.isSafeInteger(ordinal) || ordinal < 1)
    throw new TypeError("Invalid authority event ordinal");
  const previous =
    current === null ? { turnScopeId, lastOrdinal: 0, removedThrough: 0, eventCount: 0 } : current;
  requireAuthorityOutboxTurnRange(previous, turnScopeId, ordinal - 1);
  return { ...previous, lastOrdinal: ordinal, eventCount: previous.eventCount + 1 };
}

export function removeAuthorityOutboxTurnRange(current, turnScopeId, sequence) {
  requireAuthorityOutboxTurnRange(current, turnScopeId, sequence);
  return { ...current, removedThrough: current.lastOrdinal, eventCount: 0 };
}

export function isAuthorityOutboxTurnEventVisible(range, turnScopeId, ordinal, sequence) {
  requireAuthorityOutboxTurnRange(range, turnScopeId, sequence);
  if (!Number.isSafeInteger(ordinal) || ordinal < 1 || ordinal > range.lastOrdinal)
    throw new TypeError("Authority event is outside its indexed turn range");
  return ordinal > range.removedThrough;
}

export function isAuthorityOutboxDeliveryVisible({
  range,
  turnScopeId,
  ordinal,
  tail,
  compaction,
}) {
  if (compaction !== null && compaction !== true)
    throw new TypeError("Invalid authority outbox delivery compaction marker");
  return (
    isAuthorityOutboxTurnEventVisible(range, turnScopeId, ordinal, tail) && compaction === null
  );
}
