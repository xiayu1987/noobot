/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { isCanonicalText, isPlainObject } from "@noobot/shared/value";
import { partitionJournalError } from "./partition-journal.js";
function revision(value) {
  return Number.isSafeInteger(value) && value > 0;
}

export function partitionCheckpointOrderKey(turnScopeId, checkpointRevision) {
  if (!isCanonicalText(turnScopeId) || !revision(checkpointRevision))
    throw new TypeError("Invalid partition checkpoint order identity");
  return JSON.stringify([turnScopeId, checkpointRevision]);
}

export function requirePartitionCheckpointTail(value, checkpointRevision) {
  if (!revision(value) || value > checkpointRevision)
    throw partitionJournalError("SESSION_STORAGE_CORRUPT", "Invalid live checkpoint tail");
  return value;
}

export function requirePartitionCheckpointOrder(value, checkpointRevision) {
  if (
    !isPlainObject(value) ||
    Object.keys(value).length !== 2 ||
    !isCanonicalText(value.checkpointId) ||
    !(
      value.previousRevision === null ||
      (revision(value.previousRevision) && value.previousRevision < checkpointRevision)
    )
  )
    throw partitionJournalError("SESSION_STORAGE_CORRUPT", "Invalid live checkpoint order");
  return value;
}
