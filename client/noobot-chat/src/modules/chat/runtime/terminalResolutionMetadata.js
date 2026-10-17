/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { text as clean } from "@noobot/shared/value";

function versionNumber(input) {
  if (input === null || input === undefined || input === "") return null;
  const value = Number(input);
  return Number.isFinite(value) && value >= 0 ? value : null;
}

export function terminalResolutionMetadata(source = {}) {
  const metadata = {};
  const completionCommitId = clean(source?.completionCommitId);
  const summaryVersion = versionNumber(source?.summaryVersion);
  const revision = versionNumber(source?.revision);
  const sequence = versionNumber(source?.sequence);
  if (completionCommitId) metadata.completionCommitId = completionCommitId;
  if (summaryVersion != null) metadata.summaryVersion = summaryVersion;
  if (revision != null) metadata.revision = revision;
  if (sequence != null) metadata.sequence = sequence;
  return metadata;
}
