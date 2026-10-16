/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { text } from "@noobot/shared/value";

const sequenceOf = (value = {}) => {
  const sequence = Number(value.sequence);
  return Number.isFinite(sequence) && sequence > 0 ? sequence : null;
};

const timestampOf = (value = {}) => {
  const timestamp = Date.parse(text(value.timestamp));
  return Number.isFinite(timestamp) ? timestamp : null;
};

function resolveSequenceIdentity(value = {}) {
  return {
    domain: text(value.sequenceDomain),
    sequence: sequenceOf(value),
    scope: text(value.sequenceScopeId),
  };
}

export function preferTimelineFact(left, right) {
  if (!left) return right;
  if (!right) return left;
  const leftIdentity = resolveSequenceIdentity(left);
  const rightIdentity = resolveSequenceIdentity(right);
  if (
    leftIdentity.domain &&
    leftIdentity.domain === rightIdentity.domain &&
    leftIdentity.scope === rightIdentity.scope &&
    leftIdentity.sequence !== null &&
    rightIdentity.sequence !== null
  ) {
    return rightIdentity.sequence >= leftIdentity.sequence ? right : left;
  }
  return right;
}

export function compareTimelineFacts(left = {}, right = {}) {
  const leftIdentity = resolveSequenceIdentity(left);
  const rightIdentity = resolveSequenceIdentity(right);
  if (
    leftIdentity.domain &&
    leftIdentity.domain === rightIdentity.domain &&
    leftIdentity.scope === rightIdentity.scope &&
    leftIdentity.sequence !== null &&
    rightIdentity.sequence !== null &&
    leftIdentity.sequence !== rightIdentity.sequence
  ) {
    return leftIdentity.sequence - rightIdentity.sequence;
  }
  const leftTimestamp = timestampOf(left);
  const rightTimestamp = timestampOf(right);
  if (leftTimestamp !== null && rightTimestamp !== null && leftTimestamp !== rightTimestamp) {
    return leftTimestamp - rightTimestamp;
  }
  return 0;
}
