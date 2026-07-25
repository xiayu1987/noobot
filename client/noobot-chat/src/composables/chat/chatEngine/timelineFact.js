/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

const text = (value) => String(value || "").trim();

export const TIMELINE_AUTHORITY = Object.freeze({
  AUTHORITATIVE: "authoritative",
  COMPATIBILITY: "compatibility",
});

export const SEQUENCE_DOMAIN = Object.freeze({
  MESSAGE: "message",
  TRANSPORT: "transport",
  LEGACY: "legacy",
});

const authorityRank = (value = {}) =>
  text(value.authority) === TIMELINE_AUTHORITY.AUTHORITATIVE ? 2 : 1;

const sequenceOf = (value = {}) => {
  const sequence = Number(value.sequence ?? value.seq);
  return Number.isFinite(sequence) && sequence > 0 ? sequence : null;
};

const timestampOf = (value = {}) => {
  const timestamp = Date.parse(text(value.timelineTimestamp || value.timestamp || value.ts));
  return Number.isFinite(timestamp) ? timestamp : null;
};

/** Select between observations of the same fact. Cross-domain sequence values
 * are incomparable, so equal-authority caller order is the explicit tiebreak. */
export function preferTimelineFact(left, right) {
  if (!left) return right;
  if (!right) return left;
  const authorityDifference = authorityRank(right) - authorityRank(left);
  if (authorityDifference !== 0) return authorityDifference > 0 ? right : left;
  const leftDomain = text(left.sequenceDomain);
  const rightDomain = text(right.sequenceDomain);
  const leftSequence = sequenceOf(left);
  const rightSequence = sequenceOf(right);
  if (
    leftDomain &&
    leftDomain === rightDomain &&
    leftSequence !== null &&
    rightSequence !== null
  ) {
    return rightSequence >= leftSequence ? right : left;
  }
  return right;
}

/** Sort independent facts without ever comparing sequence values from
 * different domains. Returning zero preserves the caller's stable order. */
export function compareTimelineFacts(left = {}, right = {}) {
  const leftDomain = text(left.sequenceDomain);
  const rightDomain = text(right.sequenceDomain);
  const leftSequence = sequenceOf(left);
  const rightSequence = sequenceOf(right);
  if (
    leftDomain &&
    leftDomain === rightDomain &&
    leftSequence !== null &&
    rightSequence !== null &&
    leftSequence !== rightSequence
  ) {
    return leftSequence - rightSequence;
  }
  const leftTimestamp = timestampOf(left);
  const rightTimestamp = timestampOf(right);
  if (
    leftTimestamp !== null &&
    rightTimestamp !== null &&
    leftTimestamp !== rightTimestamp
  ) {
    return leftTimestamp - rightTimestamp;
  }
  return 0;
}
