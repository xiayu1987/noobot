/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

function clean(input) {
  return String(input || "").trim();
}

function versionNumber(input) {
  if (input === null || input === undefined || input === "") return null;
  const value = Number(input);
  return Number.isFinite(value) && value >= 0 ? value : null;
}

/** Normalize lifecycle, channel, snapshot and replay payloads to one query identity. */
export function terminalResolutionMetadata(payload = {}) {
  const raw = payload?.raw && typeof payload.raw === "object" ? payload.raw : {};
  const turn = payload?.turn && typeof payload.turn === "object"
    ? payload.turn
    : raw?.turn && typeof raw.turn === "object" ? raw.turn : {};
  const source = { ...raw, ...payload, ...turn };
  const metadata = { commandId: clean(source.commandId) };
  const completionCommitId = clean(source.completionCommitId);
  const summaryVersion = versionNumber(source.summaryVersion);
  const revision = versionNumber(source.revision);
  const sequence = versionNumber(source.sequence ?? source.seq);
  // Keep absent metadata absent. Besides preserving the caller's shape, this
  // prevents an unversioned replay from masquerading as an explicit null
  // watermark while still forwarding every version field that was supplied.
  if (completionCommitId) metadata.completionCommitId = completionCommitId;
  if (summaryVersion != null) metadata.summaryVersion = summaryVersion;
  if (revision != null) metadata.revision = revision;
  if (sequence != null) metadata.sequence = sequence;
  return metadata;
}
