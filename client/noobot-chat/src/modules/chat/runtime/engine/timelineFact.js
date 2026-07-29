/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { MESSAGE_EVENT_SEQUENCE_DOMAIN } from "@noobot/shared/message-event-protocol";

const text = (value) => String(value || "").trim();

export const TIMELINE_AUTHORITY = Object.freeze({
  AUTHORITATIVE: "authoritative",
});

export const SEQUENCE_DOMAIN = Object.freeze({
  MESSAGE: MESSAGE_EVENT_SEQUENCE_DOMAIN,
});

const sequenceOf = (value = {}) => {
  const sequence = Number(value.sequence ?? value.seq);
  return Number.isFinite(sequence) && sequence > 0 ? sequence : null;
};

const timestampOf = (value = {}) => {
  const timestamp = Date.parse(text(value.timelineTimestamp || value.timestamp || value.ts));
  return Number.isFinite(timestamp) ? timestamp : null;
};

const sequenceScopeOf = (value = {}) =>
  text(value.sequenceScopeId || value.sequenceScope || value.messageId || value.message_id);

export function preferTimelineFact(left, right) {
  if (!left) return right;
  if (!right) return left;
  const leftDomain = text(left.sequenceDomain);
  const rightDomain = text(right.sequenceDomain);
  const leftSequence = sequenceOf(left);
  const rightSequence = sequenceOf(right);
  const leftScope = sequenceScopeOf(left);
  const rightScope = sequenceScopeOf(right);
  if (
    leftDomain &&
    leftDomain === rightDomain &&
    leftScope === rightScope &&
    leftSequence !== null &&
    rightSequence !== null
  ) {
    return rightSequence >= leftSequence ? right : left;
  }
  return right;
}

export function compareTimelineFacts(left = {}, right = {}) {
  const leftDomain = text(left.sequenceDomain);
  const rightDomain = text(right.sequenceDomain);
  const leftSequence = sequenceOf(left);
  const rightSequence = sequenceOf(right);
  const leftScope = sequenceScopeOf(left);
  const rightScope = sequenceScopeOf(right);
  if (
    leftDomain &&
    leftDomain === rightDomain &&
    leftScope === rightScope &&
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
