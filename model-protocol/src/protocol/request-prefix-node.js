/* Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { LENGTH_THRESHOLDS } from "@noobot/shared/length-thresholds";

function commonBodyPrefixBytes(current, previous) {
  const blockBytes = LENGTH_THRESHOLDS.modelMeasurement.prefixCompareBlockBytes;
  const limit = Math.min(current.length, previous.length);
  let offset = 0;
  while (offset + blockBytes <= limit) {
    const end = offset + blockBytes;
    if (current.compare(previous, offset, end, offset, end) !== 0) break;
    offset = end;
  }
  while (offset < limit && current[offset] === previous[offset]) offset += 1;
  return offset;
}

export function measureRequestPrefix(previousBodies, scope, body) {
  if (typeof body !== "string") {
    previousBodies.delete(scope);
    return { state: "unavailable", reason: "unsupported" };
  }
  const current = Buffer.from(body, "utf8");
  const previous = previousBodies.get(scope);
  const commonPrefixBytes = previous ? commonBodyPrefixBytes(current, previous) : 0;
  previousBodies.set(scope, current);
  return {
    state: "reported",
    requestBodyBytes: current.length,
    commonPrefixBytes,
    baseline: previous ? "available" : "no_previous_request",
  };
}
