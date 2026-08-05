/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
const clean = (value) => String(value || "").trim();

export function decideAggregateConcurrency({ expectedAggregateVersion, aggregateVersion } = {}) {
  if (!Number.isInteger(expectedAggregateVersion) || expectedAggregateVersion < 0) {
    return Object.freeze({ allowed: false, reason: "invalid_expected_aggregate_version" });
  }
  if (!Number.isInteger(aggregateVersion) || aggregateVersion < 0) {
    return Object.freeze({ allowed: false, reason: "invalid_aggregate_version" });
  }
  return expectedAggregateVersion === aggregateVersion
    ? Object.freeze({ allowed: true, nextAggregateVersion: aggregateVersion + 1 })
    : Object.freeze({ allowed: false, reason: "aggregate_version_conflict", aggregateVersion });
}

export function decideCommandIdempotency({ commandId, requestHash, receipts = [] } = {}) {
  const id = clean(commandId);
  const hash = clean(requestHash);
  if (!id || !hash) return Object.freeze({ allowed: false, reason: "invalid_command_identity" });
  const receipt = (Array.isArray(receipts) ? receipts : []).find((item) => clean(item?.commandId) === id);
  if (!receipt) return Object.freeze({ allowed: true, deduplicated: false });
  if (clean(receipt.requestHash) !== hash) return Object.freeze({ allowed: false, reason: "command_id_reuse_conflict" });
  return Object.freeze({ allowed: true, deduplicated: true, receipt });
}

