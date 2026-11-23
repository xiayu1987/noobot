/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
export const SESSION_CHECKPOINT_FORBIDDEN_WORK = Object.freeze([
  "optionalJsonReads",
  "checkpointIdentityCollections",
  "checkpointIdentityVisits",
  "materializedMessages",
  "projectionRebuiltMessages",
  "projectionSizeMessages",
  "foldedRecords",
  "journalReadBytes",
  "eventJournalReadBytes",
  "pruneDirectoryScans",
  "pruneSnapshotVisits",
]);
