/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { fromByteArray, toByteArray } from "base64-js";
import { QUANTITY_THRESHOLDS } from "@noobot/shared/quantity-thresholds";
import { LENGTH_THRESHOLDS } from "@noobot/shared/length-thresholds";
import {
  isMessageContentVersion,
  requireVersionedMessageContentReference,
} from "./message-content-version.js";
import { TOOL_RESULT_MESSAGE_TYPE } from "./message-entity-contract.js";
import { isCanonicalText, isPlainObject } from "@noobot/shared/value";
import { PartitionAdmissionRejection } from "./partition-journal-capacity.js";
import { requireTurnLookupKey } from "./identity/turn-lookup-key.js";
import { sessionStorageError } from "./session-storage-format.js";

export function requirePageSnapshotPolicy(limits) {
  if (
    !isPlainObject(limits) ||
    !["readers", "idleMs", "maxAgeMs"].every(
      (field) => Number.isSafeInteger(limits[field]) && limits[field] > 0,
    )
  )
    throw new TypeError("Page snapshots require explicit positive retention budgets");
  return limits;
}

export function sessionPageWorkspaceScope(userId) {
  if (!isCanonicalText(userId)) throw new TypeError("Page snapshots require a workspace owner");
  return [userId];
}

export function treeSessionPageScope(userId, sessionId) {
  return [...sessionPageWorkspaceScope(userId), "tree", sessionId];
}

export function scopedSessionPageIdentity({ userId, authoritySessionId, sessionDir }, sessionId) {
  if (!isCanonicalText(sessionDir) || (sessionId !== null && !isCanonicalText(sessionId)))
    throw new TypeError("Scoped page snapshots require a directory and a valid session selection");
  return [...treeSessionPageScope(userId, authoritySessionId), "scoped", sessionDir, sessionId];
}

export function sessionPageMatchesDeletedSessions(identity, { userId, sessionIds, directories }) {
  const [owner, kind, authoritySessionId, scope, directory, sessionId] = identity;
  return (
    owner === userId &&
    kind === "tree" &&
    (sessionIds.has(authoritySessionId) ||
      (scope === "scoped" && (sessionIds.has(sessionId) || directories.has(directory))))
  );
}

export function sessionPageSnapshotError(kind) {
  const errors = {
    expired: ["SESSION_PAGE_SNAPSHOT_EXPIRED", 410],
    capacity: ["SESSION_PAGE_SNAPSHOT_CAPACITY", 503],
    closed: ["SESSION_READER_CLOSED", 503],
  };
  if (!Object.hasOwn(errors, kind)) throw new TypeError("Unknown page snapshot failure");
  const [code, statusCode] = errors[kind];
  return Object.assign(new Error(code), { code, statusCode });
}

export function encodeSessionPageSnapshotCursor(token, cursor) {
  if (!isCanonicalText(token) || !isMessagePageCursor(cursor))
    throw new TypeError("Invalid retained session page cursor");
  return { after: cursor.after, scope: JSON.stringify([token, cursor.scope]) };
}

export function decodeSessionPageSnapshotCursor(cursor) {
  if (!isMessagePageCursor(cursor)) throw new TypeError("Invalid retained session page cursor");
  let scope;
  try {
    scope = JSON.parse(cursor.scope);
  } catch (cause) {
    throw new TypeError("Invalid retained session page cursor", { cause });
  }
  if (!Array.isArray(scope) || scope.length !== 2 || !scope.every(isCanonicalText))
    throw new TypeError("Invalid retained session page cursor");
  return { token: scope[0], cursor: { after: cursor.after, scope: scope[1] } };
}

export function requireThinkingDetailReleaseSelection(selection) {
  if (!isPlainObject(selection) || !isCanonicalText(selection.sessionId))
    throw new TypeError("Thinking detail release requires a session identity");
  requireTurnLookupKey(selection);
  decodeSessionPageSnapshotCursor(selection.cursor);
  return selection;
}

export function requireSessionPageReleaseResult(result) {
  if (!isPlainObject(result) || typeof result.released !== "boolean")
    throw new TypeError("Session page release requires an explicit result");
  return result;
}

export function decodeThinkingDetailReleaseQuery({
  sessionId,
  dialogProcessId,
  turnScopeId,
  cursor,
}) {
  try {
    if (typeof cursor !== "string") throw new TypeError("Release requires a scalar cursor");
    return requireThinkingDetailReleaseSelection({
      sessionId,
      dialogProcessId,
      turnScopeId,
      cursor: JSON.parse(cursor),
    });
  } catch (cause) {
    if (!(cause instanceof TypeError || cause instanceof SyntaxError)) throw cause;
    throw Object.assign(new TypeError("Invalid thinking detail release query", { cause }), {
      code: "SESSION_PAGE_REQUEST_INVALID",
      statusCode: 400,
    });
  }
}

export function sessionPageCursorConflict(message, cause) {
  return Object.assign(new TypeError(message, { cause }), {
    code: "SESSION_PAGE_CURSOR_CONFLICT",
    statusCode: 409,
  });
}

export function requireSessionMessagePagePosition(scope, cursor) {
  const key = JSON.stringify(scope);
  if (cursor === null) return { after: 0, scope: key };
  if (!cursor || cursor.scope !== key || !Number.isSafeInteger(cursor.after) || cursor.after < 1)
    throw sessionPageCursorConflict("Message page cursor does not match its snapshot and scope");
  return { after: cursor.after, scope: key };
}

export function requireSessionMessagePageDirection(direction) {
  if (direction !== "forward" && direction !== "backward")
    throw new TypeError("Message page direction must be forward or backward");
  return direction;
}

export function sessionMessagePageWindow({ after, count, limit, direction }) {
  requireSessionMessagePageDirection(direction);
  if (
    !Number.isSafeInteger(after) ||
    after < 0 ||
    !Number.isSafeInteger(count) ||
    count < 0 ||
    !Number.isSafeInteger(limit) ||
    limit < 1
  )
    throw new TypeError("Message page window requires bounded integer positions");
  const length = sessionMessagePageLength(after, count, limit);
  return { after: direction === "backward" ? count - after - length : after, length };
}

export function sessionMessagePageLength(after, count, limit) {
  if (after > 0 && after >= count)
    throw sessionPageCursorConflict("Message page cursor is outside its published range");
  return Math.min(limit, count - after);
}

export function nextSessionMessagePageCursor({ after, scope }, length, hasMore) {
  if (typeof hasMore !== "boolean" || (hasMore && length < 1))
    throw new TypeError("Invalid message page continuation");
  return hasMore ? { after: after + length, scope } : null;
}

export function createSessionMessagePageRecord({ ordinal, turnOrdinal, message }) {
  return { ordinal, turnOrdinal, message };
}

function requireForwardMessageContinuation({ messageCount, records, nextCursor }, cursor, end) {
  if (
    end > messageCount ||
    (cursor !== null && records.length === 0) ||
    (end === messageCount
      ? nextCursor !== null
      : records.length === 0 ||
        !isMessagePageCursor(nextCursor) ||
        nextCursor.after !== end ||
        (cursor !== null && nextCursor.scope !== cursor.scope))
  )
    throw sessionStorageError("Invalid pinned session message continuation");
}

export function requireForwardSessionMessagePage(
  page,
  { generation, cursor, limit },
  previousCount,
) {
  if (
    !isPlainObject(page) ||
    !Number.isSafeInteger(generation) ||
    generation < 0 ||
    page.generation !== generation ||
    !Number.isSafeInteger(page.messageCount) ||
    page.messageCount < 0 ||
    (cursor !== null && (!isMessagePageCursor(cursor) || page.messageCount !== previousCount)) ||
    !Array.isArray(page.records) ||
    page.records.length > limit
  )
    throw sessionStorageError("Invalid pinned session message page");

  const after = cursor === null ? 0 : cursor.after;
  requireForwardMessageContinuation(page, cursor, after + page.records.length);
  for (const [index, record] of page.records.entries()) {
    if (record?.ordinal !== after + index + 1)
      throw sessionStorageError("Noncontiguous session message positions");
  }
  return page;
}

function requireScopedTurnPage(purpose, identity, { lookupKey, cursor, limit, maxBytes }) {
  const key = requireTurnLookupKey(lookupKey);
  const position = requireSessionMessagePagePosition(
    [...identity, purpose, key.dialogProcessId, key.turnScopeId],
    cursor,
  );
  const budget = requireMessagePage({
    turnScopeId: key.turnScopeId,
    after: position.after,
    limit,
    maxBytes,
  });
  return { key, position, budget };
}

export function requireScopedTurnMessagePage(identity, selection) {
  return requireScopedTurnPage("turn-body", identity, selection);
}

export function requireScopedDisplayArtifactPage(
  { sessionId, parentSessionId, snapshotId, generation },
  selection,
) {
  if (
    !isCanonicalText(sessionId) ||
    (parentSessionId !== "" && !isCanonicalText(parentSessionId)) ||
    !isCanonicalText(snapshotId) ||
    !Number.isSafeInteger(generation) ||
    generation < 0
  )
    throw new TypeError("Display artifact pages require a retained snapshot identity");
  return requireScopedTurnPage(
    "display-artifacts",
    [sessionId, parentSessionId, snapshotId, generation],
    selection,
  );
}

function requireDisplayArtifactIdentity(request, fields) {
  if (
    !isPlainObject(request) ||
    Reflect.ownKeys(request).length !== fields.length ||
    !fields.every((field) => Object.hasOwn(request, field)) ||
    !isCanonicalText(request.sessionId)
  )
    throw new TypeError("Invalid retained display artifact page selection");
  requireTurnLookupKey(request);
  return request;
}

export function requireRetainedDisplayArtifactPageRequest(request) {
  requireDisplayArtifactIdentity(request, [
    "sessionId",
    "dialogProcessId",
    "turnScopeId",
    "cursor",
    "limit",
    "maxBytes",
  ]);
  if (!Number.isSafeInteger(request.maxBytes))
    throw new TypeError("Display artifact pages require an explicit byte budget");
  const after =
    request.cursor === null ? 0 : decodeSessionPageSnapshotCursor(request.cursor).cursor.after;
  requirePageBounds({ after, limit: request.limit, maxBytes: request.maxBytes });
  return request;
}

export function requireRetainedDisplayArtifactPageRelease(request) {
  requireDisplayArtifactIdentity(request, [
    "sessionId",
    "dialogProcessId",
    "turnScopeId",
    "cursor",
  ]);
  decodeSessionPageSnapshotCursor(request.cursor);
  return request;
}

function requireDisplayArtifactSummary(summary, pageRecordCount) {
  if (
    !isPlainObject(summary) ||
    !Number.isSafeInteger(summary.toolArtifactCount) ||
    summary.toolArtifactCount < pageRecordCount ||
    !Number.isSafeInteger(summary.assignedAttachmentCount) ||
    summary.assignedAttachmentCount < 0 ||
    !["empty", "unassigned", "conflicted", "assigned"].includes(summary.status) ||
    (summary.toolArtifactCount === 0) !== (summary.status === "empty") ||
    (summary.status === "empty" || summary.status === "unassigned"
      ? summary.ownerPresentationMessageId !== null
      : !isCanonicalText(summary.ownerPresentationMessageId)) ||
    (summary.status !== "assigned" && summary.assignedAttachmentCount !== 0)
  )
    throw new TypeError("Invalid display artifact summary");
}

function requireDisplayArtifactTurn(record, request) {
  if (
    !isPlainObject(record) ||
    !Number.isSafeInteger(record.ordinal) ||
    record.ordinal < 1 ||
    !isPlainObject(record.message) ||
    record.message.type !== TOOL_RESULT_MESSAGE_TYPE ||
    record.message.sessionId !== request.sessionId ||
    record.message.dialogProcessId !== request.dialogProcessId ||
    record.message.turnScopeId !== request.turnScopeId
  )
    throw new TypeError("Display artifact record does not belong to the requested turn");
  requireVersionedMessageContentReference(record.message);
}

function requireDisplayArtifactContinuation({ summary, records, nextCursor }, cursor) {
  const previous = cursor === null ? null : decodeSessionPageSnapshotCursor(cursor);
  const minimumCountFromNonemptyPages =
    records.length + Number(previous !== null) + Number(nextCursor !== null);
  if (
    minimumCountFromNonemptyPages > summary.toolArtifactCount ||
    (minimumCountFromNonemptyPages > 0 && records.length === 0)
  )
    throw new TypeError("Incomplete display artifact page");
  if (nextCursor !== null) {
    const next = decodeSessionPageSnapshotCursor(nextCursor);
    if (
      previous !== null &&
      (next.token !== previous.token ||
        next.cursor.scope !== previous.cursor.scope ||
        next.cursor.after <= previous.cursor.after)
    )
      throw new TypeError("Invalid display artifact continuation");
  } else if (previous === null && records.length !== summary.toolArtifactCount) {
    throw new TypeError("Incomplete display artifact page");
  }
}

export function requireRetainedDisplayArtifactPageResponse(page, request) {
  requireRetainedDisplayArtifactPageRequest(request);
  if (page === null && request.cursor === null) return page;
  if (
    !isPlainObject(page) ||
    !Number.isSafeInteger(page.generation) ||
    page.generation < 0 ||
    !Array.isArray(page.records) ||
    page.records.length > request.limit
  )
    throw new TypeError("Invalid retained display artifact page");
  const { summary, records } = page;
  requireDisplayArtifactSummary(summary, records.length);
  for (const record of records) requireDisplayArtifactTurn(record, request);
  requireDisplayArtifactContinuation(page, request.cursor);
  createMessageReadBudget(request.maxBytes).consume("bytes", messageReadJsonBytes(page));
  return page;
}

export function requireDisplayArtifactPageTransition(page, request, previous) {
  requireRetainedDisplayArtifactPageResponse(page, request);
  if (request.cursor === null && previous === null) return page;
  if (request.cursor === null || !isPlainObject(previous) || previous.nextCursor === null)
    throw new TypeError("Display artifact continuation requires its previous page");
  const current = decodeSessionPageSnapshotCursor(request.cursor);
  const expected = decodeSessionPageSnapshotCursor(previous.nextCursor);
  if (
    current.token !== expected.token ||
    current.cursor.scope !== expected.cursor.scope ||
    current.cursor.after !== expected.cursor.after
  )
    throw new TypeError("Request does not continue the previous display artifact page");
  requireDisplayArtifactSummary(previous.summary, 0);
  if (
    page.generation !== previous.generation ||
    ["status", "ownerPresentationMessageId", "toolArtifactCount", "assignedAttachmentCount"].some(
      (key) => page.summary[key] !== previous.summary[key],
    )
  )
    throw new TypeError("Display artifact page changed its retained snapshot facts");
  return page;
}

export function requireScopedThinkingDetailPage(identity, selection) {
  requireThinkingDetailPageSelection({
    sessionId: identity[0],
    ...selection.lookupKey,
    cursor: selection.cursor,
    limit: selection.limit,
  });
  return requireScopedTurnPage("thinking-detail", identity, selection);
}

export function createScopedTurnMessagePage({ generation, messageCount, records, position }) {
  return {
    generation,
    messageCount,
    records,
    nextCursor: nextSessionMessagePageCursor(
      position,
      records.length,
      position.after + records.length < messageCount,
    ),
  };
}

function isMessagePageCursor(cursor) {
  return (
    isPlainObject(cursor) &&
    Object.keys(cursor).length === 2 &&
    isCanonicalText(cursor.scope) &&
    Number.isSafeInteger(cursor.after) &&
    cursor.after > 0
  );
}

function requireThinkingDetailPageBounds({ cursor, limit }) {
  if (
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > QUANTITY_THRESHOLDS.sessionStorage.messageReadPageSize ||
    (cursor !== null && !isMessagePageCursor(cursor))
  )
    throw new TypeError("Invalid thinking detail page selection");
}

export function decodeThinkingDetailPageQuery({ cursor, limit }) {
  try {
    if (
      (cursor !== undefined && typeof cursor !== "string") ||
      typeof limit !== "string" ||
      !/^[1-9][0-9]*$/.test(limit)
    )
      throw new TypeError("Page query requires scalar cursor and positive decimal limit");
    const selection = {
      cursor: cursor === undefined ? null : JSON.parse(cursor),
      limit: Number(limit),
    };
    requireThinkingDetailPageBounds(selection);
    return selection;
  } catch (cause) {
    if (!(cause instanceof TypeError || cause instanceof SyntaxError)) throw cause;
    throw Object.assign(new TypeError("Invalid thinking detail page query", { cause }), {
      code: "SESSION_PAGE_REQUEST_INVALID",
      statusCode: 400,
    });
  }
}

export function requireThinkingDetailPageSelection(selection) {
  const { sessionId, dialogProcessId, turnScopeId } = selection;
  requireTurnLookupKey({ dialogProcessId, turnScopeId });
  if (!isCanonicalText(sessionId)) throw new TypeError("Invalid thinking detail page identity");
  requireThinkingDetailPageBounds(selection);
  return selection;
}

function requireThinkingDetailPageIdentity(
  page,
  { sessionId, dialogProcessId, turnScopeId, limit },
) {
  if (
    page.exists !== true ||
    page.sessionId !== sessionId ||
    page.dialogProcessId !== dialogProcessId ||
    page.turnScopeId !== turnScopeId ||
    !Number.isSafeInteger(page.generation) ||
    page.generation < 1 ||
    !Number.isSafeInteger(page.messageCount) ||
    page.messageCount < 1 ||
    !Array.isArray(page.messages) ||
    page.messages.length < 1 ||
    page.messages.length > limit ||
    Array.from(page.messages).some(
      (message) =>
        !isPlainObject(message) ||
        message.sessionId !== sessionId ||
        message.dialogProcessId !== dialogProcessId ||
        message.turnScopeId !== turnScopeId,
    )
  )
    throw new TypeError("Invalid thinking detail page identity");
}

function requireThinkingDetailPageContinuation(page, cursor) {
  const after = (cursor === null ? 0 : cursor.after) + page.messages.length;
  const next = page.nextCursor;
  if (
    after > page.messageCount ||
    (after === page.messageCount
      ? next !== null
      : !isMessagePageCursor(next) ||
        next.after !== after ||
        (cursor !== null && next.scope !== cursor.scope))
  )
    throw new TypeError("Invalid thinking detail page continuation");
}

function requireThinkingDetailPage(page, selection) {
  if (!isPlainObject(page)) throw new TypeError("Invalid thinking detail page response");
  if (page.exists === false && selection.cursor === null) return page;
  requireThinkingDetailPageIdentity(page, selection);
  requireThinkingDetailPageContinuation(page, selection.cursor);
  return page;
}

export function requireThinkingDetailPageResponse(page, selection) {
  return requireThinkingDetailPage(page, requireThinkingDetailPageSelection(selection));
}

export function prepareThinkingDetailPageTransition(selection, previous) {
  const request = requireThinkingDetailPageSelection(selection);
  const cursor = request.cursor;
  if (cursor !== null) decodeSessionPageSnapshotCursor(cursor);
  if (
    cursor === null
      ? previous !== null
      : !isPlainObject(previous) ||
        !isMessagePageCursor(previous.nextCursor) ||
        cursor.scope !== previous.nextCursor.scope ||
        cursor.after !== previous.nextCursor.after
  )
    throw new TypeError("Request does not continue the previous thinking detail page");

  const generation = previous?.generation;
  const messageCount = previous?.messageCount;
  return (page) => {
    requireThinkingDetailPage(page, request);
    if (page.exists === false) return page;
    if (page.nextCursor !== null) decodeSessionPageSnapshotCursor(page.nextCursor);
    if (cursor !== null && (page.generation !== generation || page.messageCount !== messageCount))
      throw new TypeError("Thinking detail page changed its retained snapshot facts");
    return page;
  };
}

export const MESSAGE_READ_BUDGET_ERROR = "SESSION_MESSAGE_READ_BUDGET_EXCEEDED";

const contentReadErrors = Object.freeze({
  missing: { code: "SESSION_MESSAGE_NOT_FOUND", statusCode: 404 },
  version: { code: "SESSION_MESSAGE_CONTENT_VERSION_CONFLICT", statusCode: 409 },
});

export function messageContentReadError(kind, message) {
  if (!Object.hasOwn(contentReadErrors, kind))
    throw new TypeError("Unknown message content read error");
  const { code, statusCode } = contentReadErrors[kind];
  return Object.assign(new PartitionAdmissionRejection(code, message), { statusCode });
}

const messageReadUtf8 = new TextEncoder();

export function messageReadJsonBytes(value) {
  const json = JSON.stringify(value);
  if (json === undefined) throw new TypeError("Message read work requires a JSON value");
  return messageReadUtf8.encode(json).byteLength;
}

export function createMessageReadBudget(
  maxBytes = LENGTH_THRESHOLDS.sessionStorage.messageReadBytes,
) {
  if (
    !Number.isSafeInteger(maxBytes) ||
    maxBytes < 1 ||
    maxBytes > LENGTH_THRESHOLDS.sessionStorage.messageReadBytes
  )
    throw new TypeError("Message reads require a bounded positive byte budget");
  let used = 0;
  return Object.freeze({
    consume(dimension, amount) {
      if (dimension !== "bytes" || !Number.isSafeInteger(amount) || amount < 0)
        throw new TypeError("Invalid message read work measurement");
      if (amount > maxBytes - used)
        throw Object.assign(new Error("Message read byte budget exceeded"), {
          code: MESSAGE_READ_BUDGET_ERROR,
          dimension,
          limit: maxBytes,
          used,
          requested: amount,
        });
      used += amount;
    },
  });
}

export function requireMessageReadSelection({ messageUids, maxBytes }) {
  if (
    !Array.isArray(messageUids) ||
    messageUids.length > QUANTITY_THRESHOLDS.sessionStorage.messagePageSize ||
    messageUids.some((uid) => typeof uid !== "string" || !uid || uid.trim() !== uid) ||
    new Set(messageUids).size !== messageUids.length
  )
    throw new TypeError("Message selection requires bounded unique canonical message IDs");
  return createMessageReadBudget(maxBytes);
}

function requireTurnScopeId(turnScopeId) {
  if (typeof turnScopeId !== "string" || !turnScopeId || turnScopeId.trim() !== turnScopeId)
    throw new TypeError("Turn message read requires a canonical turn scope ID");
}

export function requireFirstTurnMessageRead({ turnScopeId, maxBytes }) {
  requireTurnScopeId(turnScopeId);
  return createMessageReadBudget(maxBytes);
}

export function requireMessagePage({ turnScopeId, after, limit, maxBytes }) {
  requireTurnScopeId(turnScopeId);
  return requirePageBounds({ after, limit, maxBytes });
}

export function requireDialogTurnPage({ dialogProcessId, after, limit, maxBytes }) {
  if (
    typeof dialogProcessId !== "string" ||
    !dialogProcessId ||
    dialogProcessId.trim() !== dialogProcessId
  )
    throw new TypeError("Dialog turn page requires a canonical dialog process ID");
  return requirePageBounds({ after, limit, maxBytes });
}

export function requirePageBounds({ after, limit, maxBytes }) {
  const maximum = QUANTITY_THRESHOLDS.sessionStorage.messagePageSize;
  if (
    !Number.isSafeInteger(after) ||
    after < 0 ||
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > maximum
  )
    throw new TypeError(`Message page requires a non-negative cursor and limit 1..${maximum}`);
  return createMessageReadBudget(maxBytes);
}

export const MESSAGE_CONTENT_PAGE_ENCODING = "json-utf8-base64";

export function createMessageContentPage({
  generation,
  selection,
  contentReference,
  totalBytes,
  bytes,
}) {
  const { messageUid, byteOffset, maxBytes } = selection;
  if (!Number.isSafeInteger(totalBytes) || totalBytes < 2 || !(bytes instanceof Uint8Array))
    throw new TypeError("Invalid message content byte source");
  if (byteOffset > totalBytes) throw new RangeError("Value range starts beyond its content");
  if (bytes.byteLength !== Math.min(maxBytes, totalBytes - byteOffset))
    throw new TypeError("Message content byte source returned an incomplete or oversized range");
  const nextByteOffset = byteOffset + bytes.byteLength;
  return {
    generation,
    messageUid,
    contentReference,
    encoding: MESSAGE_CONTENT_PAGE_ENCODING,
    dataBase64: fromByteArray(bytes),
    byteOffset,
    nextByteOffset,
    totalBytes,
    hasMore: nextByteOffset < totalBytes,
  };
}

export function requireMessageContentPage(selection) {
  const fields = ["messageUid", "byteOffset", "maxBytes", "expectedContentReference"];
  if (
    !selection ||
    Object.getPrototypeOf(selection) !== Object.prototype ||
    Object.keys(selection).length !== fields.length ||
    fields.some((field) => !Object.hasOwn(selection, field))
  )
    throw new TypeError("Content page requires explicit canonical fields");
  const { messageUid, byteOffset, maxBytes, expectedContentReference } = selection;
  if (
    typeof messageUid !== "string" ||
    !messageUid ||
    messageUid.trim() !== messageUid ||
    !Number.isSafeInteger(byteOffset) ||
    byteOffset < 0 ||
    !Number.isSafeInteger(maxBytes) ||
    maxBytes < 1 ||
    maxBytes > LENGTH_THRESHOLDS.sessionStorage.messageReadBytes ||
    (expectedContentReference !== null && !isMessageContentVersion(expectedContentReference)) ||
    (byteOffset > 0 && expectedContentReference === null)
  )
    throw new TypeError("Content page requires a bounded range and a versioned continuation");
  return selection;
}

export function decodeMessageContentPage(page, selection, expectedTotalBytes) {
  const { messageUid, byteOffset, maxBytes, expectedContentReference } =
    requireMessageContentPage(selection);
  if (!isPlainObject(page) || Object.keys(page).length !== 9)
    throw new TypeError("Invalid message content page");
  const {
    generation,
    contentReference,
    encoding,
    dataBase64,
    totalBytes,
    nextByteOffset,
    hasMore,
  } = page;
  const length = Math.min(maxBytes, expectedTotalBytes - byteOffset);
  if (
    !Number.isSafeInteger(expectedTotalBytes) ||
    expectedTotalBytes < 2 ||
    length < 0 ||
    expectedContentReference === null ||
    !Number.isSafeInteger(generation) ||
    generation < 1 ||
    page.messageUid !== messageUid ||
    contentReference !== expectedContentReference ||
    encoding !== MESSAGE_CONTENT_PAGE_ENCODING ||
    totalBytes !== expectedTotalBytes ||
    page.byteOffset !== byteOffset ||
    nextByteOffset !== byteOffset + length ||
    hasMore !== nextByteOffset < totalBytes ||
    typeof dataBase64 !== "string" ||
    dataBase64.length !== 4 * Math.ceil(length / 3)
  )
    throw new TypeError("Message content page does not match the requested version and range");
  const bytes = toByteArray(dataBase64);
  if (bytes.length !== length || fromByteArray(bytes) !== dataBase64)
    throw new TypeError("Invalid message content page bytes");
  return { bytes, nextByteOffset, hasMore };
}
