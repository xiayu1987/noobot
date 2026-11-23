/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { isCanonicalText, isPlainObject } from "@noobot/shared/value";
import {
  partitionCollectionResultBytes,
  requirePartitionCollectionPageLimit,
} from "./partition-collection-query.js";

const cursorFields = ["sessionId", "snapshotId", "generation", "turnScopeId", "revision"];

function requireFields(value, fields) {
  if (
    !isPlainObject(value) ||
    Reflect.ownKeys(value).length !== fields.length ||
    !fields.every((field) =>
      Object.hasOwn(Object.getOwnPropertyDescriptor(value, field) ?? {}, "value"),
    )
  )
    throw new TypeError("Invalid checkpoint page fields");
}

function checkpointCursor(scope, turnScopeId, revision) {
  return {
    sessionId: scope.sessionId,
    snapshotId: scope.snapshotId,
    generation: scope.generation,
    turnScopeId,
    revision,
  };
}

export function requireSummaryCheckpointPage(scope, options) {
  requireFields(options, ["turnScopeId", "cursor", "limit", "maxBytes"]);
  const { turnScopeId, cursor, limit, maxBytes } = options;
  if (!isCanonicalText(turnScopeId)) throw new TypeError("Checkpoint turn identity is required");
  requirePartitionCollectionPageLimit(scope, limit);
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1)
    throw new TypeError("Checkpoint page requires a positive result byte budget");
  if (cursor === null) return null;
  requireFields(cursor, cursorFields);
  const expected = checkpointCursor(scope, turnScopeId, cursor.revision);
  if (
    !Number.isSafeInteger(cursor.revision) ||
    cursor.revision < 1 ||
    !cursorFields.every((field) => cursor[field] === expected[field])
  )
    throw new TypeError("Checkpoint cursor does not belong to this snapshot and turn");
  return cursor.revision;
}

export function createSummaryCheckpointPage(scope, selection, receipts, nextRevision) {
  const { turnScopeId, limit, maxBytes } = selection;
  if (receipts.length > limit) throw new TypeError("Checkpoint page exceeds selected record limit");
  if (nextRevision !== null && (!Number.isSafeInteger(nextRevision) || nextRevision < 1))
    throw new TypeError("Invalid checkpoint continuation revision");
  const page = {
    generation: scope.generation,
    receipts,
    nextCursor: nextRevision === null ? null : checkpointCursor(scope, turnScopeId, nextRevision),
  };
  partitionCollectionResultBytes(page, Math.min(maxBytes, scope.limits.pageBytes));
  return page;
}
