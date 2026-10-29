/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { isCanonicalText, isPlainObject } from "@noobot/shared/value";
import { SESSION_ERROR_CODE } from "../errors.js";
import { isSessionAggregateVersion } from "../command/session-command.js";
import { normalizeTurnTimingRecord } from "../lifecycle/turn-timing.js";
import { validateTurnLifecycleSnapshot } from "../turn-lifecycle.js";
import {
  SESSION_SUMMARY_AVAILABILITY,
  collectSessionSummaryEntryErrors,
} from "./sessions-summary.js";
import { isSessionCaller } from "@noobot/shared/session-caller";

const AVAILABLE_DETAIL_ENTRY_FIELDS = Object.freeze([
  "sessionId",
  "parentSessionId",
  "caller",
  "createdAt",
  "updatedAt",
  "title",
  "aggregateVersion",
  "turnTimings",
  "turnLifecycleSnapshot",
  "sessionArtifactEvents",
  "messages",
  "availability",
]);

const DETAIL_DOCUMENT_FIELDS = Object.freeze(["exists", "sessionId", "sessions"]);

function detailInvalid(reason, validationErrors = []) {
  return Object.assign(new TypeError(`session detail payload is invalid: ${reason}`), {
    code: SESSION_ERROR_CODE.SESSION_DETAIL_PAYLOAD_INVALID,
    validationErrors,
  });
}

function collectExactFieldErrors(value, fields) {
  const expected = new Set(fields);
  const errors = [];
  for (const field of fields) {
    if (!Object.hasOwn(value, field)) errors.push(`missing_${field}`);
  }
  for (const field of Object.keys(value)) {
    if (!expected.has(field)) errors.push(`unexpected_${field}`);
  }
  return errors;
}

function collectTurnTimingErrors(turnTimings) {
  if (!Array.isArray(turnTimings)) return ["invalid_turn_timings"];
  const errors = [];
  turnTimings.forEach((record, index) => {
    try {
      normalizeTurnTimingRecord(record);
    } catch (error) {
      if (error?.code !== SESSION_ERROR_CODE.TURN_TIMING_INVALID) throw error;
      errors.push(`invalid_turn_timing_${index}:${error.message}`);
    }
  });
  return errors;
}

function isOwnedArtifactEvent(envelope, sessionId) {
  return isPlainObject(envelope) && envelope.identity?.sessionId === sessionId;
}

function collectAvailableDetailEntryErrors(entry) {
  const errors = collectExactFieldErrors(entry, AVAILABLE_DETAIL_ENTRY_FIELDS);
  if (!isCanonicalText(entry.sessionId)) errors.push("invalid_session_id");
  if (entry.parentSessionId !== "" && !isCanonicalText(entry.parentSessionId)) {
    errors.push("invalid_parent_session_id");
  }
  if (!isSessionCaller(entry.caller)) errors.push("invalid_caller");
  if (!isCanonicalText(entry.createdAt)) errors.push("invalid_created_at");
  if (!isCanonicalText(entry.updatedAt)) errors.push("invalid_updated_at");
  if (!isCanonicalText(entry.title)) errors.push("invalid_title");
  if (!isSessionAggregateVersion(entry.aggregateVersion)) errors.push("invalid_aggregate_version");
  errors.push(...collectTurnTimingErrors(entry.turnTimings));
  if (
    !validateTurnLifecycleSnapshot(entry.turnLifecycleSnapshot).valid ||
    entry.turnLifecycleSnapshot.sessionId !== entry.sessionId
  ) {
    errors.push("invalid_turn_lifecycle_snapshot");
  }
  if (
    !Array.isArray(entry.sessionArtifactEvents) ||
    !entry.sessionArtifactEvents.every((event) => isOwnedArtifactEvent(event, entry.sessionId))
  ) {
    errors.push("invalid_session_artifact_events");
  }
  if (!Array.isArray(entry.messages) || !entry.messages.every(isPlainObject)) {
    errors.push("invalid_messages");
  }
  return errors;
}

export function collectSessionDetailEntryErrors(entry) {
  if (!isPlainObject(entry)) return ["entry_not_object"];
  if (entry.availability === SESSION_SUMMARY_AVAILABILITY.AVAILABLE) {
    return collectAvailableDetailEntryErrors(entry);
  }
  if (entry.availability === SESSION_SUMMARY_AVAILABILITY.UNAVAILABLE) {
    return collectSessionSummaryEntryErrors(entry);
  }
  return ["invalid_availability"];
}

export function requireSessionDetailEntry(entry) {
  const errors = collectSessionDetailEntryErrors(entry);
  if (errors.length) {
    const subject =
      isPlainObject(entry) && isCanonicalText(entry.sessionId) ? entry.sessionId : "entry";
    throw detailInvalid(`${subject}: ${errors.join(",")}`, errors);
  }
  return entry;
}

export function createAvailableSessionDetailEntry(displaySummary) {
  if (!isPlainObject(displaySummary)) throw detailInvalid("display summary must be an object");
  return requireSessionDetailEntry({
    sessionId: displaySummary.sessionId,
    parentSessionId: displaySummary.parentSessionId,
    caller: displaySummary.caller,
    createdAt: displaySummary.createdAt,
    updatedAt: displaySummary.updatedAt,
    title: displaySummary.title,
    aggregateVersion: displaySummary.aggregateVersion,
    turnTimings: displaySummary.turnTimings,
    turnLifecycleSnapshot: displaySummary.turnLifecycleSnapshot,
    sessionArtifactEvents: displaySummary.sessionArtifactEvents,
    messages: displaySummary.messages,
    availability: SESSION_SUMMARY_AVAILABILITY.AVAILABLE,
  });
}

export function isAvailableSessionDetailEntry(entry) {
  return entry.availability === SESSION_SUMMARY_AVAILABILITY.AVAILABLE;
}

export function requireSessionDetailDocument(document) {
  if (!isPlainObject(document)) throw detailInvalid("document must be an object");
  const fieldErrors = collectExactFieldErrors(document, DETAIL_DOCUMENT_FIELDS);
  if (fieldErrors.length) throw detailInvalid(fieldErrors.join(","), fieldErrors);
  if (typeof document.exists !== "boolean") throw detailInvalid("exists must be boolean");
  if (!isCanonicalText(document.sessionId)) throw detailInvalid("sessionId is required");
  if (!Array.isArray(document.sessions)) throw detailInvalid("sessions must be an array");
  if (!document.exists) {
    if (document.sessions.length) throw detailInvalid("missing session must not carry entries");
    return document;
  }
  const seen = new Set();
  for (const entry of document.sessions) {
    requireSessionDetailEntry(entry);
    if (seen.has(entry.sessionId)) throw detailInvalid(`${entry.sessionId} is duplicated`);
    seen.add(entry.sessionId);
  }
  if (!seen.has(document.sessionId)) throw detailInvalid("main session entry is missing");
  return document;
}

export function createSessionDetailDocument({ sessionId, sessions }) {
  return requireSessionDetailDocument({ exists: true, sessionId, sessions });
}

export function createMissingSessionDetailDocument({ sessionId }) {
  return requireSessionDetailDocument({ exists: false, sessionId, sessions: [] });
}

export function selectMainSessionDetailEntry(document) {
  if (!document.exists) throw detailInvalid("missing session has no main entry");
  return document.sessions.find((entry) => entry.sessionId === document.sessionId);
}
