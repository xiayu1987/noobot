/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { filePath as path } from "@noobot/path-resolver";
import { readFile, writeFile } from "node:fs/promises";
import { readPersistedJsonFile } from "../shared/storage/json-file-reader.js";
import { text, isFunction } from "@noobot/shared/value";

export const SESSION_ARTIFACT_FILE_NAMES = Object.freeze({
  session: "session.json",
  sessionSummary: "session-summary.json",
  sessionSummaryDetailsDir: "session-summary-details",
  task: "task.json",
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
    task: path.join(dir, SESSION_ARTIFACT_FILE_NAMES.task),
    executionReportsDir: path.join(dir, SESSION_ARTIFACT_FILE_NAMES.executionReportsDir),
    executionEventsDir: path.join(dir, SESSION_ARTIFACT_FILE_NAMES.executionEventsDir),
    turnsDir: path.join(dir, SESSION_ARTIFACT_FILE_NAMES.turnsDir),
    turnSnapshotsDir: path.join(dir, SESSION_ARTIFACT_FILE_NAMES.turnSnapshotsDir),
    modelMessageSnapshotsDir: path.join(dir, SESSION_ARTIFACT_FILE_NAMES.modelMessageSnapshotsDir),
    meta: path.join(dir, SESSION_ARTIFACT_FILE_NAMES.meta),
  };
}

export async function writeJsonArtifactFile(filePath = "", payload = {}) {
  await writeFile(
    filePath,
    `${JSON.stringify(payload && typeof payload === "object" ? payload : {}, null, 2)}\n`,
    "utf8",
  );
}

export async function readJsonArtifactFile(filePath = "", fallback = null) {
  return readPersistedJsonFile({ filePath, fallback, readFile });
}

function requireSessionWritableGuard(assertSessionWritable) {
  if (!isFunction(assertSessionWritable)) {
    throw new TypeError("assertSessionWritable is required for session artifact mutation");
  }
  return assertSessionWritable;
}

export async function assertArtifactSessionWritable({
  assertSessionWritable,
  sessionId = "",
  sessionDir = "",
  operation = "session artifact mutation",
} = {}) {
  requireSessionWritableGuard(assertSessionWritable);
  await assertSessionWritable({ sessionId, sessionDir, operation });
}

export function resolveSessionArtifactMutationLock(sessionDir = "") {
  const normalized = text(sessionDir);
  if (!normalized) throw new Error("session artifact mutation lock requires sessionDir");
  return `${path.resolve(normalized)}.mutation-lock`;
}
