/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { filePath as path } from "@noobot/path-resolver";
import { appendFile, readFile, writeFile } from "node:fs/promises";
import { readPersistedJsonFile } from "../shared/storage/json-file-reader.js";

export const SESSION_ARTIFACT_FILE_NAMES = Object.freeze({
  session: "session.json",
  sessionSummary: "session-summary.json",
  sessionSummaryDetailsDir: "session-summary-details",
  task: "task.json",
  execution: "execution.json",
  executionEvents: "execution.jsonl",
  executionEventsDir: "execution-events",
  turnsDir: "turns",
  turnSnapshotsDir: "turn-snapshots",
  meta: "meta.json",
});

export function buildSessionArtifactFileMap(sessionDir = "") {
  const dir = String(sessionDir || "").trim();
  return {
    session: path.join(dir, SESSION_ARTIFACT_FILE_NAMES.session),
    sessionSummary: path.join(dir, SESSION_ARTIFACT_FILE_NAMES.sessionSummary),
    sessionSummaryDetailsDir: path.join(dir, SESSION_ARTIFACT_FILE_NAMES.sessionSummaryDetailsDir),
    task: path.join(dir, SESSION_ARTIFACT_FILE_NAMES.task),
    execution: path.join(dir, SESSION_ARTIFACT_FILE_NAMES.execution),
    executionEvents: path.join(dir, SESSION_ARTIFACT_FILE_NAMES.executionEvents),
    executionEventsDir: path.join(dir, SESSION_ARTIFACT_FILE_NAMES.executionEventsDir),
    turnsDir: path.join(dir, SESSION_ARTIFACT_FILE_NAMES.turnsDir),
    turnSnapshotsDir: path.join(dir, SESSION_ARTIFACT_FILE_NAMES.turnSnapshotsDir),
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

export function createSessionDeletedArtifactError(
  sessionId = "",
  operation = "session artifact mutation",
) {
  const error = new Error(`session has been deleted: ${String(sessionId || "").trim()}`);
  error.statusCode = 410;
  error.errorCode = "SESSION_DELETED";
  error.code = "SESSION_DELETED";
  error.sessionId = String(sessionId || "").trim();
  error.operation = operation;
  return error;
}

export async function assertArtifactSessionWritable({
  assertSessionWritable = null,
  sessionId = "",
  sessionDir = "",
  operation = "session artifact mutation",
} = {}) {
  if (typeof assertSessionWritable !== "function") return true;
  const result = await assertSessionWritable({ sessionId, sessionDir, operation });
  if (result === false) throw createSessionDeletedArtifactError(sessionId, operation);
  return true;
}

export function resolveArtifactMutationLockDir(sessionDir = "", mutationLockDir = "") {
  return String(mutationLockDir || "").trim() || path.join(sessionDir, ".mutation-lock");
}

export async function writeJsonlArtifactFile(filePath = "", logs = []) {
  const lines = (Array.isArray(logs) ? logs : [])
    .map((log) => JSON.stringify(log && typeof log === "object" ? log : { value: log }))
    .join("\n");
  await writeFile(filePath, lines ? `${lines}\n` : "", "utf8");
}

export async function appendJsonlArtifactLog(filePath = "", log = {}, { reset = false } = {}) {
  const serializedLog = `${JSON.stringify(log && typeof log === "object" ? log : { value: log })}\n`;
  if (reset) {
    await writeFile(filePath, serializedLog, "utf8");
  } else {
    await appendFile(filePath, serializedLog, "utf8");
  }
}
