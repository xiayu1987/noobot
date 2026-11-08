/* Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { isPlainObject } from "@noobot/shared/value";
import { MODEL_MEASUREMENT_REASONS } from "@noobot/model-protocol";

const GROUP_FIELDS = Object.freeze({
  tokens: ["inputTokensSum", "outputTokensSum"],
  cacheRead: ["cacheReadInputTokensSum", "inputTokensSum", "hitRequestCount"],
  cacheWrite: ["cacheWriteInputTokensSum", "inputTokensSum"],
  requestPrefix: ["commonPrefixBytesSum", "requestBodyBytesSum"],
});
const UNAVAILABLE_REASONS = new Set(MODEL_MEASUREMENT_REASONS);

export function createExecutionModelMeasurements() {
  const group = (key) =>
    Object.fromEntries([
      ...GROUP_FIELDS[key].map((field) => [field, 0]),
      ["sampleCount", 0],
      ["unavailableCount", 0],
      ["unavailableReasons", {}],
    ]);
  return {
    state: "collected",
    measurementErrors: [],
    requests: {
      startedCount: 0,
      completedCount: 0,
      failedCount: 0,
      cancelledCount: 0,
      unfinishedCount: 0,
    },
    usage: {
      tokens: group("tokens"),
      cacheRead: group("cacheRead"),
      cacheWrite: group("cacheWrite"),
    },
    requestPrefix: group("requestPrefix"),
  };
}

function count(value, path) {
  if (!Number.isSafeInteger(value) || value < 0)
    throw new TypeError(`invalid execution model measurement: ${path}`);
}

function exactKeys(value, keys, path) {
  if (
    !isPlainObject(value) ||
    Object.keys(value).length !== keys.length ||
    keys.some((key) => !Object.hasOwn(value, key))
  ) {
    throw new TypeError(`invalid execution model measurement: ${path} fields`);
  }
}

function assertGroup(group, key, started) {
  exactKeys(
    group,
    [...GROUP_FIELDS[key], "sampleCount", "unavailableCount", "unavailableReasons"],
    key,
  );
  for (const field of [...GROUP_FIELDS[key], "sampleCount", "unavailableCount"])
    count(group[field], `${key}.${field}`);
  if (group.sampleCount + group.unavailableCount !== started)
    throw new TypeError(`${key} sample count mismatch`);
  if (!isPlainObject(group.unavailableReasons))
    throw new TypeError(`${key} unavailable reasons required`);
  let unavailable = 0;
  for (const [reason, value] of Object.entries(group.unavailableReasons)) {
    if (!UNAVAILABLE_REASONS.has(reason))
      throw new TypeError(`invalid measurement reason: ${reason}`);
    count(value, reason);
    unavailable += value;
  }
  if (unavailable !== group.unavailableCount)
    throw new TypeError(`${key} unavailable count mismatch`);
  if (group.sampleCount === 0 && GROUP_FIELDS[key].some((field) => group[field] !== 0))
    throw new TypeError(`${key} totals without samples`);
}

function assertMeasurementErrors(value) {
  if (!Array.isArray(value.measurementErrors))
    throw new TypeError("measurement errors must be an array");
  const requestIds = new Set();
  for (const error of value.measurementErrors) {
    exactKeys(error, ["transportRequestId", "message"], "measurement error");
    if (
      typeof error.transportRequestId !== "string" ||
      !error.transportRequestId ||
      typeof error.message !== "string" ||
      !error.message ||
      requestIds.has(error.transportRequestId)
    )
      throw new TypeError("invalid measurement error diagnostic");
    requestIds.add(error.transportRequestId);
  }
  for (const key of ["tokens", "cacheRead", "cacheWrite"])
    if ((value.usage[key].unavailableReasons.measurement_failed || 0) !== requestIds.size)
      throw new TypeError("measurement error diagnostic count mismatch");
}

export function requireExecutionModelMeasurements(value) {
  if (value?.state === "legacy_not_collected") {
    exactKeys(value, ["state"], "legacy");
    return value;
  }
  exactKeys(
    value,
    ["state", "requests", "usage", "requestPrefix", "measurementErrors"],
    "measurements",
  );
  if (value.state !== "collected") throw new TypeError("invalid execution measurement state");
  exactKeys(
    value.requests,
    ["startedCount", "completedCount", "failedCount", "cancelledCount", "unfinishedCount"],
    "requests",
  );
  for (const [key, amount] of Object.entries(value.requests)) count(amount, key);
  const { startedCount, completedCount, failedCount, cancelledCount, unfinishedCount } =
    value.requests;
  if (startedCount !== completedCount + failedCount + cancelledCount + unfinishedCount)
    throw new TypeError("request terminal count mismatch");
  exactKeys(value.usage, ["tokens", "cacheRead", "cacheWrite"], "usage");
  for (const key of ["tokens", "cacheRead", "cacheWrite"])
    assertGroup(value.usage[key], key, startedCount);
  assertMeasurementErrors(value);
  assertGroup(value.requestPrefix, "requestPrefix", startedCount);
  const { cacheRead, cacheWrite } = value.usage;
  if (
    cacheRead.cacheReadInputTokensSum > cacheRead.inputTokensSum ||
    cacheRead.hitRequestCount > cacheRead.sampleCount ||
    cacheWrite.cacheWriteInputTokensSum > cacheWrite.inputTokensSum ||
    value.requestPrefix.commonPrefixBytesSum > value.requestPrefix.requestBodyBytesSum
  )
    throw new TypeError("invalid measurement ratio");
  count(value.usage.tokens.inputTokensSum + value.usage.tokens.outputTokensSum, "totalTokens");
  return value;
}
