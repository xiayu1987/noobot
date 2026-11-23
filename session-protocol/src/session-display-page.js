/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { isCanonicalText, isFunction, isPlainObject } from "@noobot/shared/value";
import { requireVersionedMessageContentReference } from "./message-content-version.js";
import { isSessionAggregateVersion } from "./command/session-command.js";
import { isInjectedSessionMessageRecord } from "./aggregate/session-message-record.js";
import { TOOL_CALL_MESSAGE_TYPE, TOOL_RESULT_MESSAGE_TYPE } from "./message-entity-contract.js";
import {
  decodeSessionPageSnapshotCursor,
  messageReadJsonBytes,
  nextSessionMessagePageCursor,
  requirePageBounds,
  requireSessionMessagePageDirection,
  requireSessionMessagePagePosition,
  sessionPageCursorConflict,
  sessionMessagePageWindow,
} from "./message-read-budget.js";

const countFields = [
  "messageCount",
  "displayMessageCount",
  "injectedMessageCount",
  "thinkingMessageCount",
  "toolLogCount",
  "displayToolLogCount",
  "unassignedToolArtifactCount",
  "conflictedToolArtifactCount",
  "attachmentCount",
];

function hasExactFields(value, fields) {
  return (
    isPlainObject(value) &&
    Reflect.ownKeys(value).length === fields.length &&
    fields.every((field) =>
      Object.hasOwn(Object.getOwnPropertyDescriptor(value, field) ?? {}, "value"),
    )
  );
}

const sourceCountFields = ["injectedMessageCount", "toolLogCount"];
const rowCountFields = ["displayMessageCount", "thinkingMessageCount", "attachmentCount"];

export function sessionDisplayRowContribution(row, attachmentCount) {
  if (!isPlainObject(row) || !Number.isSafeInteger(attachmentCount) || attachmentCount < 0)
    throw new TypeError(
      "Display row contribution requires a final row and explicit attachment count",
    );
  return {
    displayMessageCount: 1,
    thinkingMessageCount: Number(row.hasThinkingDetails === true),
    attachmentCount,
  };
}

export function emptySessionDisplayRowCounts() {
  return { displayMessageCount: 0, thinkingMessageCount: 0, attachmentCount: 0 };
}

export function applySessionDisplayRowDelta(counts, delta) {
  return addSignedCounts(rowCountFields, counts, delta);
}

export function sessionDisplayMessageContribution(message) {
  return {
    injectedMessageCount: Number(isInjectedSessionMessageRecord(message)),
    toolLogCount:
      message.type === TOOL_CALL_MESSAGE_TYPE
        ? message.tool_calls.length
        : Number(message.type === TOOL_RESULT_MESSAGE_TYPE),
  };
}

export function emptySessionDisplaySourceCounts() {
  return { injectedMessageCount: 0, toolLogCount: 0 };
}

export function applySessionDisplaySourceDelta(counts, delta) {
  return addSignedCounts(sourceCountFields, counts, delta);
}

function addSignedCounts(fields, counts, delta) {
  if (
    !hasExactFields(counts, fields) ||
    !hasExactFields(delta, fields) ||
    !fields.every((key) => Number.isSafeInteger(counts[key]) && Number.isSafeInteger(delta[key]))
  )
    throw new TypeError("Display deltas require explicit safe integer counts");
  const next = Object.fromEntries(fields.map((key) => [key, counts[key] + delta[key]]));
  if (!fields.every((key) => Number.isSafeInteger(next[key])))
    throw new TypeError("Display delta exceeds safe integer precision");
  return next;
}

export function requireSessionDisplaySourceCounts(counts, messageCount) {
  if (
    !Number.isSafeInteger(messageCount) ||
    messageCount < 0 ||
    !hasExactFields(counts, sourceCountFields) ||
    !sourceCountFields.every((key) => Number.isSafeInteger(counts[key]) && counts[key] >= 0) ||
    counts.injectedMessageCount > messageCount
  )
    throw new TypeError("Invalid display source counts");
  return counts;
}

export function createSessionDisplayStats(counts) {
  if (
    !hasExactFields(counts, countFields) ||
    !countFields.every((key) => Number.isSafeInteger(counts[key]) && counts[key] >= 0)
  )
    throw new TypeError("Display statistics require explicit global counts");
  if (
    counts.injectedMessageCount > counts.messageCount ||
    counts.thinkingMessageCount > counts.displayMessageCount ||
    counts.displayToolLogCount +
      counts.unassignedToolArtifactCount +
      counts.conflictedToolArtifactCount >
      counts.toolLogCount
  )
    throw new TypeError("Inconsistent global display counts");
  return { ...counts, hasToolDetails: counts.toolLogCount > 0 };
}

export function requireSessionDisplayStats(statistics) {
  if (!hasExactFields(statistics, [...countFields, "hasToolDetails"]))
    throw new TypeError("Display statistics require explicit global counts and tool details flag");
  const { hasToolDetails, ...counts } = statistics;
  const stats = createSessionDisplayStats(counts);
  if (hasToolDetails !== stats.hasToolDetails)
    throw new TypeError("Inconsistent display tool details flag");
  return statistics;
}

function collectDisplayRowShapeErrors(messages) {
  if (!Array.isArray(messages)) return ["invalid_messages"];
  for (const message of messages) {
    if (!isPlainObject(message)) return ["invalid_messages"];
  }
  return [];
}

function collectDisplayRowCountErrors(messages, expectedCount) {
  return messages.length === expectedCount ? [] : ["display_message_count_mismatch"];
}

function collectSessionDisplayRowErrors(messages, expectedCount) {
  const errors = collectDisplayRowShapeErrors(messages);
  return errors.length ? errors : collectDisplayRowCountErrors(messages, expectedCount);
}

export function collectSessionDisplayProjectionErrors(messages, statistics) {
  const errors = collectDisplayRowShapeErrors(messages);
  let stats;
  try {
    stats = requireSessionDisplayStats(statistics);
  } catch (error) {
    if (!(error instanceof TypeError)) throw error;
    return [...errors, "invalid_display_stats"];
  }
  return errors.length ? errors : collectDisplayRowCountErrors(messages, stats.displayMessageCount);
}

function displayCursorScope({ sessionId, parentSessionId, snapshotId, generation }, direction) {
  return [sessionId, parentSessionId, snapshotId, generation, "display", direction];
}

export function requireSessionDisplayPageSelection(scope, selection) {
  const { sessionId, parentSessionId, snapshotId, generation, aggregateVersion } = scope;
  if (
    !isCanonicalText(sessionId) ||
    (parentSessionId !== "" && !isCanonicalText(parentSessionId)) ||
    !isCanonicalText(snapshotId) ||
    !Number.isSafeInteger(generation) ||
    generation < 1 ||
    !isSessionAggregateVersion(aggregateVersion)
  )
    throw new TypeError("Display page requires a retained session snapshot");
  if (
    !hasExactFields(selection, ["cursor", "limit", "maxBytes", "direction"]) ||
    !Number.isSafeInteger(selection.maxBytes) ||
    (selection.cursor !== null && !hasExactFields(selection.cursor, ["after", "scope"]))
  )
    throw new TypeError("Invalid display page selection");
  const { cursor, limit, maxBytes, direction } = selection;
  requireSessionMessagePageDirection(direction);
  const position = requireSessionMessagePagePosition(displayCursorScope(scope, direction), cursor);
  const budget = requirePageBounds({ after: position.after, limit, maxBytes });
  return { position, budget };
}

export function requireRetainedSessionDisplayPageRequest(request) {
  if (
    !hasExactFields(request, ["sessionId", "direction", "cursor", "limit", "maxBytes"]) ||
    !isCanonicalText(request.sessionId) ||
    !Number.isSafeInteger(request.maxBytes)
  )
    throw new TypeError("Invalid retained display page request");
  requireSessionMessagePageDirection(request.direction);
  const after =
    request.cursor === null ? 0 : decodeSessionPageSnapshotCursor(request.cursor).cursor.after;
  requirePageBounds({ after, limit: request.limit, maxBytes: request.maxBytes });
  return request;
}

export function requireSessionDisplayPageRelease(request) {
  if (!hasExactFields(request, ["sessionId", "cursor"]) || !isCanonicalText(request.sessionId))
    throw new TypeError("Display page release requires a session identity and cursor");
  decodeSessionPageSnapshotCursor(request.cursor);
  return request;
}

function requireRetainedDisplayPosition(page, direction, cursor) {
  const invalid = (cause) =>
    sessionPageCursorConflict("Invalid retained display cursor scope", cause);
  let coordinates;
  try {
    coordinates = JSON.parse(cursor.scope);
  } catch (cause) {
    throw invalid(cause);
  }
  if (!Array.isArray(coordinates) || !isCanonicalText(coordinates[2])) throw invalid();
  return requireSessionMessagePagePosition(
    displayCursorScope({ ...page, snapshotId: coordinates[2] }, direction),
    cursor,
  );
}

function requireRetainedDisplayPageIdentity(page, sessionId) {
  if (
    !hasExactFields(page, [
      "sessionId",
      "parentSessionId",
      "generation",
      "aggregateVersion",
      "messages",
      "stats",
      "nextCursor",
    ]) ||
    page.sessionId !== sessionId ||
    (page.parentSessionId !== "" && !isCanonicalText(page.parentSessionId)) ||
    !Number.isSafeInteger(page.generation) ||
    page.generation < 1 ||
    !isSessionAggregateVersion(page.aggregateVersion)
  )
    throw new TypeError("Invalid retained display page identity");
}

export function requireSessionDisplayPageTransition(page, request, previous) {
  if (request.cursor === null && previous === null)
    return requireRetainedSessionDisplayPageResponse(page, request);
  if (request.cursor === null || !isPlainObject(previous) || previous.nextCursor === null)
    throw new TypeError("Display continuation requires its previous page");
  const current = decodeSessionPageSnapshotCursor(request.cursor);
  const expected = decodeSessionPageSnapshotCursor(previous.nextCursor);
  if (
    current.token !== expected.token ||
    current.cursor.scope !== expected.cursor.scope ||
    current.cursor.after !== expected.cursor.after
  )
    throw new TypeError("Request does not continue the previous display page");
  requireRetainedSessionDisplayPageResponse(page, request);
  const previousStats = requireSessionDisplayStats(previous.stats);
  if (
    previous.sessionId !== page.sessionId ||
    previous.parentSessionId !== page.parentSessionId ||
    previous.generation !== page.generation ||
    previous.aggregateVersion !== page.aggregateVersion ||
    countFields.some((key) => previousStats[key] !== page.stats[key])
  )
    throw new TypeError("Display page changed its retained snapshot facts");
  return page;
}

function requireRetainedDisplayRow(row) {
  if (row.turnPlaceholder === true) {
    if (
      row.content !== "" ||
      Object.hasOwn(row, "contentReference") ||
      Object.hasOwn(row, "contentBytes")
    )
      throw new TypeError("Display placeholder cannot reference message content");
    return;
  }
  requireVersionedMessageContentReference(row);
}

export function requireRetainedSessionDisplayPageResponse(page, request) {
  requireRetainedSessionDisplayPageRequest(request);
  requireRetainedDisplayPageIdentity(page, request.sessionId);
  const stats = requireSessionDisplayStats(page.stats);
  const current = request.cursor === null ? null : decodeSessionPageSnapshotCursor(request.cursor);
  const after =
    current === null
      ? 0
      : requireRetainedDisplayPosition(page, request.direction, current.cursor).after;
  const budget = requirePageBounds({ after, limit: request.limit, maxBytes: request.maxBytes });
  const count = stats.displayMessageCount;
  const { length } = sessionMessagePageWindow({
    after,
    count,
    limit: request.limit,
    direction: request.direction,
  });
  if (collectSessionDisplayRowErrors(page.messages, length).length) throw invalidDisplayWindow();
  for (const row of page.messages) requireRetainedDisplayRow(row);
  const end = after + length;
  const next = page.nextCursor === null ? null : decodeSessionPageSnapshotCursor(page.nextCursor);
  if (
    end === count
      ? next !== null
      : next === null ||
        requireRetainedDisplayPosition(page, request.direction, next.cursor).after !== end ||
        (current !== null &&
          (next.token !== current.token || next.cursor.scope !== current.cursor.scope))
  )
    throw new TypeError("Invalid retained display page continuation");
  budget.consume("bytes", messageReadJsonBytes(page));
  return page;
}

function requireDisplaySnapshot(scope, source) {
  if (
    source.sessionId !== scope.sessionId ||
    source.parentSessionId !== scope.parentSessionId ||
    source.generation !== scope.generation ||
    source.aggregateVersion !== scope.aggregateVersion ||
    source.snapshotId !== scope.snapshotId
  )
    throw new TypeError("Display projection source does not belong to the retained snapshot");
}

function resolveDisplayPage(scope, { direction, limit }, statistics, { position, budget }) {
  requireDisplaySnapshot(scope, statistics);
  const stats = requireSessionDisplayStats(statistics.stats);

  const { displayMessageCount: count } = stats;
  const { after, length } = sessionMessagePageWindow({
    after: position.after,
    count,
    limit,
    direction,
  });
  const nextCursor = nextSessionMessagePageCursor(
    position,
    length,
    position.after + length < count,
  );
  return { after, length, stats, nextCursor, budget };
}

export function planSessionDisplayPage(scope, selection, statistics) {
  const bounds = requireSessionDisplayPageSelection(scope, selection);
  const { after, length } = resolveDisplayPage(scope, selection, statistics, bounds);
  return { after, length };
}

export function createSessionDisplayPage(scope, selection, { window, statistics }) {
  const bounds = requireSessionDisplayPageSelection(scope, selection);
  return materializeDisplayPage(
    scope,
    window,
    resolveDisplayPage(scope, selection, statistics, bounds),
  );
}

export async function readSessionDisplayPage(scope, selection, { readStatistics, readWindow }) {
  const retainedScope = { ...scope };
  const bounds = requireSessionDisplayPageSelection(retainedScope, selection);
  const { direction, limit } = selection;
  const statistics = await readStatistics(retainedScope);
  const plan = resolveDisplayPage(retainedScope, { direction, limit }, statistics, bounds);
  const { after, length, budget } = plan;
  const page = createDisplayPageEnvelope(retainedScope, [], plan);
  budget.consume("bytes", messageReadJsonBytes(page));
  if (length === 0) return page;

  const window = await readWindow(retainedScope, { after, length });
  requireDisplaySnapshot(retainedScope, window);
  if (window.after !== after || !isFunction(window.messages?.[Symbol.asyncIterator]))
    throw invalidDisplayWindow();
  for await (const entry of window.messages) {
    if (page.messages.length === length || !isPlainObject(entry)) throw invalidDisplayWindow();
    const { jsonBytes, read } = entry;
    if (!Number.isSafeInteger(jsonBytes) || jsonBytes < 2 || !isFunction(read))
      throw invalidDisplayWindow();
    budget.consume("bytes", Number(page.messages.length > 0));
    budget.consume("bytes", jsonBytes);
    const row = await read();
    if (!isPlainObject(row) || messageReadJsonBytes(row) !== jsonBytes)
      throw invalidDisplayWindow();
    page.messages.push(row);
  }
  if (page.messages.length !== length) throw invalidDisplayWindow();
  return page;
}

function invalidDisplayWindow() {
  return new TypeError("Display projection returned an incomplete or mispositioned window");
}

function materializeDisplayPage(scope, window, plan) {
  const { after, length, budget } = plan;
  requireDisplaySnapshot(scope, window);
  if (window.after !== after || collectSessionDisplayRowErrors(window.messages, length).length)
    throw invalidDisplayWindow();
  const page = createDisplayPageEnvelope(scope, window.messages, plan);
  budget.consume("bytes", messageReadJsonBytes(page));
  return page;
}

function createDisplayPageEnvelope(scope, messages, { stats, nextCursor }) {
  return {
    sessionId: scope.sessionId,
    parentSessionId: scope.parentSessionId,
    generation: scope.generation,
    aggregateVersion: scope.aggregateVersion,
    messages,
    stats,
    nextCursor,
  };
}
