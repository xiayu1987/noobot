/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { filePath as path } from "@noobot/path-resolver";
import { text, isFunction } from "@noobot/shared/value";
import { sessionMutationCoordinator } from "./session-mutation-coordinator.js";

export const SESSION_ARTIFACT_FILE_NAMES = Object.freeze({
  session: "session.json",
  sessionSummary: "session-summary.json",
  sessionSummaryDetailsDir: "session-summary-details",
  executionReportsDir: "execution-reports",
  executionEventsDir: "execution-events",
  turnsDir: "turns",
  turnSnapshotsDir: "turn-snapshots",
  modelMessageSnapshotsDir: "model-message-snapshots",
  meta: "meta.json",
});

export function buildSessionArtifactFileMap(sessionDir = "") {
  const dir = text(sessionDir);
  return {
    session: path.join(dir, SESSION_ARTIFACT_FILE_NAMES.session),
    sessionSummary: path.join(dir, SESSION_ARTIFACT_FILE_NAMES.sessionSummary),
    sessionSummaryDetailsDir: path.join(dir, SESSION_ARTIFACT_FILE_NAMES.sessionSummaryDetailsDir),
    executionReportsDir: path.join(dir, SESSION_ARTIFACT_FILE_NAMES.executionReportsDir),
    executionEventsDir: path.join(dir, SESSION_ARTIFACT_FILE_NAMES.executionEventsDir),
    turnsDir: path.join(dir, SESSION_ARTIFACT_FILE_NAMES.turnsDir),
    turnSnapshotsDir: path.join(dir, SESSION_ARTIFACT_FILE_NAMES.turnSnapshotsDir),
    modelMessageSnapshotsDir: path.join(dir, SESSION_ARTIFACT_FILE_NAMES.modelMessageSnapshotsDir),
    meta: path.join(dir, SESSION_ARTIFACT_FILE_NAMES.meta),
  };
}

function requireSessionWritableGuard(assertSessionWritable) {
  if (!isFunction(assertSessionWritable)) {
    throw new TypeError("assertSessionWritable is required for session artifact mutation");
  }
  return assertSessionWritable;
}

export async function assertArtifactSessionWritable({
  assertSessionWritable,
  sessionId,
  sessionDir,
  operation,
}) {
  requireSessionWritableGuard(assertSessionWritable);
  await assertSessionWritable({ sessionId, sessionDir, operation });
}

export function resolveSessionArtifactMutationLock(sessionDir = "") {
  const normalized = text(sessionDir);
  if (!normalized) throw new Error("session artifact mutation lock requires sessionDir");
  return `${path.resolve(normalized)}.mutation-lock`;
}

export async function withSessionArtifactReadFence(sessionDirs, operation) {
  if (!Array.isArray(sessionDirs) || !isFunction(operation))
    throw new TypeError("session artifact read fence requires directories and an operation");
  const locks = [...new Set(sessionDirs.map(resolveSessionArtifactMutationLock))].sort();
  const acquire = (index) =>
    index === locks.length
      ? operation()
      : sessionMutationCoordinator.run(locks[index], () => acquire(index + 1));
  return acquire(0);
}
