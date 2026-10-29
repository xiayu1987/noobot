/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { isCanonicalText, isPlainObject } from "@noobot/shared/value";
import { isSessionCaller } from "@noobot/shared/session-caller";
import { SESSION_ERROR_CODE } from "../errors.js";
import { isCanonicalTurnScopeId } from "../identity/turn-scope-identity.js";
import { isSessionAggregateVersion } from "../command/session-command.js";

export const SESSIONS_SUMMARY_SCHEMA_VERSION = 7;

export const SESSION_SUMMARY_AVAILABILITY = Object.freeze({
  AVAILABLE: "available",
  UNAVAILABLE: "unavailable",
});

const AVAILABLE_ENTRY_FIELDS = Object.freeze([
  "sessionId",
  "parentSessionId",
  "caller",
  "createdAt",
  "updatedAt",
  "aggregateVersion",
  "title",
  "messageCount",
  "lastMessage",
  "activeTurnScopeId",
  "availability",
]);

const UNAVAILABLE_ENTRY_FIELDS = Object.freeze([
  "sessionId",
  "parentSessionId",
  "caller",
  "availability",
  "unavailableReason",
]);

function payloadInvalid(reason) {
  return Object.assign(new TypeError(`sessions summary payload is invalid: ${reason}`), {
    code: SESSION_ERROR_CODE.SESSIONS_SUMMARY_PAYLOAD_INVALID,
  });
}

function isParentSessionId(value) {
  return value === "" || isCanonicalText(value);
}

function collectExactFieldErrors(entry, fields) {
  const expected = new Set(fields);
  const errors = [];
  for (const field of fields) {
    if (!Object.hasOwn(entry, field)) errors.push(`missing_${field}`);
  }
  for (const field of Object.keys(entry)) {
    if (!expected.has(field)) errors.push(`unexpected_${field}`);
  }
  return errors;
}

function collectTreeFactErrors(entry) {
  const errors = [];
  if (!isCanonicalText(entry.sessionId)) errors.push("invalid_session_id");
  if (!isParentSessionId(entry.parentSessionId)) errors.push("invalid_parent_session_id");
  if (!isSessionCaller(entry.caller)) errors.push("invalid_caller");
  return errors;
}

function isUnavailableReason(reason) {
  return (
    isPlainObject(reason) &&
    Object.keys(reason).length === 2 &&
    isCanonicalText(reason.code) &&
    typeof reason.message === "string"
  );
}

function collectAvailableEntryErrors(entry) {
  const errors = [
    ...collectExactFieldErrors(entry, AVAILABLE_ENTRY_FIELDS),
    ...collectTreeFactErrors(entry),
  ];
  if (!isCanonicalText(entry.createdAt)) errors.push("invalid_created_at");
  if (!isCanonicalText(entry.updatedAt)) errors.push("invalid_updated_at");
  if (!isSessionAggregateVersion(entry.aggregateVersion)) errors.push("invalid_aggregate_version");
  if (!isCanonicalText(entry.title)) errors.push("invalid_title");
  if (!Number.isSafeInteger(entry.messageCount) || entry.messageCount < 0) {
    errors.push("invalid_message_count");
  }
  if (entry.lastMessage !== null && !isPlainObject(entry.lastMessage)) {
    errors.push("invalid_last_message");
  }
  if (entry.activeTurnScopeId !== "" && !isCanonicalTurnScopeId(entry.activeTurnScopeId)) {
    errors.push("invalid_active_turn_scope_id");
  }
  return errors;
}

function collectUnavailableEntryErrors(entry) {
  const errors = [
    ...collectExactFieldErrors(entry, UNAVAILABLE_ENTRY_FIELDS),
    ...collectTreeFactErrors(entry),
  ];
  if (!isUnavailableReason(entry.unavailableReason)) errors.push("invalid_unavailable_reason");
  return errors;
}

export function collectSessionSummaryEntryErrors(entry) {
  if (!isPlainObject(entry)) return ["entry_not_object"];
  if (entry.availability === SESSION_SUMMARY_AVAILABILITY.AVAILABLE) {
    return collectAvailableEntryErrors(entry);
  }
  if (entry.availability === SESSION_SUMMARY_AVAILABILITY.UNAVAILABLE) {
    return collectUnavailableEntryErrors(entry);
  }
  return ["invalid_availability"];
}

export function requireSessionSummaryEntry(entry) {
  const errors = collectSessionSummaryEntryErrors(entry);
  if (errors.length) {
    const subject =
      isPlainObject(entry) && isCanonicalText(entry.sessionId) ? entry.sessionId : "entry";
    throw Object.assign(payloadInvalid(`${subject}: ${errors.join(",")}`), {
      validationErrors: errors,
    });
  }
  return entry;
}

export function createSessionUnavailableReason(error) {
  if (isPlainObject(error) || error instanceof Error) {
    if (isCanonicalText(error.code) && typeof error.message === "string") {
      return { code: error.code, message: error.message };
    }
  }
  throw error;
}

export function createUnavailableSessionSummary({ sessionId, parentSessionId, caller, error }) {
  return requireSessionSummaryEntry({
    sessionId,
    parentSessionId,
    caller,
    availability: SESSION_SUMMARY_AVAILABILITY.UNAVAILABLE,
    unavailableReason: createSessionUnavailableReason(error),
  });
}

export function requireSessionsSummaryPayload(payload) {
  if (!isPlainObject(payload)) throw payloadInvalid("payload must be an object");
  if (!isSessionsSummarySchemaCurrent(payload)) {
    throw Object.assign(
      new Error(
        `sessions summary schema ${payload.schemaVersion} is not ${SESSIONS_SUMMARY_SCHEMA_VERSION}; rebuild required`,
      ),
      { code: SESSION_ERROR_CODE.SESSIONS_SUMMARY_SCHEMA_UNSUPPORTED },
    );
  }
  if (!Array.isArray(payload.sessions)) throw payloadInvalid("sessions must be an array");
  if (!isCanonicalText(payload.updatedAt)) throw payloadInvalid("updatedAt is required");
  const seen = new Set();
  for (const entry of payload.sessions) {
    requireSessionSummaryEntry(entry);
    if (seen.has(entry.sessionId)) throw payloadInvalid(`${entry.sessionId} is duplicated`);
    seen.add(entry.sessionId);
  }
  return payload;
}

export function isSessionsSummaryMembershipCurrent(payload, sessionIds) {
  const expected = new Set(sessionIds);
  return (
    payload.sessions.length === expected.size &&
    payload.sessions.every((entry) => expected.has(entry.sessionId))
  );
}

export function isSessionsSummarySchemaCurrent(payload) {
  return isPlainObject(payload) && payload.schemaVersion === SESSIONS_SUMMARY_SCHEMA_VERSION;
}

export function createSessionsSummaryProjectionError({ sessionId, cause, projectionError }) {
  if (!isCanonicalText(sessionId)) throw new TypeError("projection error requires sessionId");
  return Object.assign(
    new AggregateError([projectionError], `session ${sessionId} unavailable projection failed`, {
      cause,
    }),
    { code: SESSION_ERROR_CODE.SESSIONS_SUMMARY_PROJECTION_FAILED, sessionId },
  );
}

export function isSessionsSummaryProjectionError(error) {
  return (
    error instanceof AggregateError &&
    error.code === SESSION_ERROR_CODE.SESSIONS_SUMMARY_PROJECTION_FAILED
  );
}

export function compareSessionSummaries(left, right) {
  const leftAvailable = left.availability === SESSION_SUMMARY_AVAILABILITY.AVAILABLE;
  const rightAvailable = right.availability === SESSION_SUMMARY_AVAILABILITY.AVAILABLE;
  if (leftAvailable !== rightAvailable) return leftAvailable ? -1 : 1;
  if (leftAvailable) {
    const byTime = right.updatedAt.localeCompare(left.updatedAt);
    if (byTime !== 0) return byTime;
  }
  return left.sessionId.localeCompare(right.sessionId);
}
