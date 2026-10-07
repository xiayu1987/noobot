/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { filePath as path } from "@noobot/path-resolver";
import { mkdir } from "node:fs/promises";
import { sessionMutationCoordinator } from "../session-mutation-coordinator.js";
import { buildSessionArtifactFileMap } from "../session-artifact-files.js";
import { appendRollingJsonlArtifactLog } from "../session-artifact-execution-logs.js";
import { readJsonWithStorage, writeJsonWithStorage } from "./artifact-json-io.js";

const EXECUTION_REPORT_KEY_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

export function normalizeExecutionReportKey(dialogProcessId = "") {
  const key = String(dialogProcessId || "").trim();
  return EXECUTION_REPORT_KEY_PATTERN.test(key) ? key : "";
}

function resolveExecutionReportPath(sessionDir, dialogProcessId) {
  const key = normalizeExecutionReportKey(dialogProcessId);
  if (!key) return "";
  return path.join(buildSessionArtifactFileMap(sessionDir).executionReportsDir, `${key}.json`);
}

export async function writeTaskArtifact({
  storageService = null,
  sessionDir = "",
  taskPayload = {},
  atomic = false,
} = {}) {
  const files = buildSessionArtifactFileMap(sessionDir);
  await mkdir(sessionDir, { recursive: true });
  await writeJsonWithStorage({
    storageService,
    artifactPath: files.task,
    payload: taskPayload,
    atomic,
  });
  return { files, task: taskPayload };
}

export async function writeExecutionArtifact({
  storageService = null,
  sessionDir = "",
  executionPayload = {},
  atomic = true,
} = {}) {
  const files = buildSessionArtifactFileMap(sessionDir);
  await mkdir(sessionDir, { recursive: true });
  await writeJsonWithStorage({
    storageService,
    artifactPath: files.execution,
    payload: executionPayload,
    atomic,
  });
  return { files, execution: executionPayload };
}

export async function writeExecutionReportArtifact({
  storageService = null,
  sessionDir = "",
  reportPayload = {},
  atomic = true,
} = {}) {
  const artifactPath = resolveExecutionReportPath(sessionDir, reportPayload?.dialogProcessId);
  if (!artifactPath) return null;
  await mkdir(path.dirname(artifactPath), { recursive: true });
  await writeJsonWithStorage({
    storageService,
    artifactPath,
    payload: reportPayload,
    atomic,
  });
  return { artifactPath, executionReport: reportPayload };
}

export async function readExecutionReportArtifact({
  storageService = null,
  sessionDir = "",
  dialogProcessId = "",
} = {}) {
  const artifactPath = resolveExecutionReportPath(sessionDir, dialogProcessId);
  if (!artifactPath) return null;
  return readJsonWithStorage({ storageService, artifactPath, fallback: null });
}

export async function appendExecutionLogArtifact({
  storageService = null,
  sessionDir = "",
  executionLog = {},
  executionPayload = {},
  resetExecutionLogs = false,
  atomic = true,
  mutationCoordinator = sessionMutationCoordinator,
  alreadyLocked = false,
} = {}) {
  const files = buildSessionArtifactFileMap(sessionDir);
  await mkdir(sessionDir, { recursive: true });
  await appendRollingJsonlArtifactLog({
    sessionDir,
    log: executionLog,
    reset: resetExecutionLogs,
    mutationCoordinator,
    alreadyLocked,
  });
  await writeExecutionArtifact({
    storageService,
    sessionDir,
    executionPayload,
    atomic,
  });
  return { files, executionLog, execution: executionPayload };
}
