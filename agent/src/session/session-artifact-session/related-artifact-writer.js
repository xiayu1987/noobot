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
import { requireDialogProcessKey } from "@noobot/session-protocol";
import { decodeExecutionReport } from "@noobot/session-protocol/execution-report";
import { readJsonWithStorage, writeJsonWithStorage } from "./artifact-json-io.js";

function resolveExecutionReportPath(sessionDir, dialogProcessId) {
  const key = requireDialogProcessKey(dialogProcessId);
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

export async function writeExecutionReportArtifact({
  storageService = null,
  sessionDir = "",
  reportPayload = {},
  atomic = true,
} = {}) {
  const report = decodeExecutionReport(reportPayload);
  const artifactPath = resolveExecutionReportPath(sessionDir, report.dialogProcessId);
  await mkdir(path.dirname(artifactPath), { recursive: true });
  await writeJsonWithStorage({
    storageService,
    artifactPath,
    payload: report,
    atomic,
  });
  return { artifactPath, executionReport: report };
}

export async function readExecutionReportArtifact({
  storageService = null,
  sessionDir = "",
  dialogProcessId = "",
} = {}) {
  const payload = await readJsonWithStorage({
    storageService,
    artifactPath: resolveExecutionReportPath(sessionDir, dialogProcessId),
    fallback: null,
  });
  return payload === null ? null : decodeExecutionReport(payload);
}

export async function appendExecutionLogArtifact({
  sessionDir = "",
  executionLog = {},
  mutationCoordinator = sessionMutationCoordinator,
  alreadyLocked = false,
} = {}) {
  await mkdir(sessionDir, { recursive: true });
  await appendRollingJsonlArtifactLog({
    sessionDir,
    log: executionLog,
    mutationCoordinator,
    alreadyLocked,
  });
  return { executionLog };
}
