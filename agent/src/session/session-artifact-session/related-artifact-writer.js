/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { filePath as path } from "@noobot/path-resolver";
import { mkdir } from "node:fs/promises";
import { buildSessionArtifactFileMap } from "../session-artifact-files.js";
import { appendRollingJsonlArtifactLog } from "../session-artifact-execution-logs.js";
import { requireDialogProcessKey } from "@noobot/session-protocol";
import { decodeExecutionReport } from "@noobot/session-protocol/execution-report";
import { readOptionalJsonWithStorage, writeJsonWithStorage } from "./artifact-json-io.js";

function resolveExecutionReportPath(sessionDir, dialogProcessId) {
  const key = requireDialogProcessKey(dialogProcessId);
  return path.join(buildSessionArtifactFileMap(sessionDir).executionReportsDir, `${key}.json`);
}

export async function writeExecutionReportArtifact({
  storageService,
  sessionDir,
  reportPayload,
  atomic,
}) {
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

export async function readExecutionReportArtifact({ storageService, sessionDir, dialogProcessId }) {
  const payload = await readOptionalJsonWithStorage({
    storageService,
    artifactPath: resolveExecutionReportPath(sessionDir, dialogProcessId),
  });
  return payload === null ? null : decodeExecutionReport(payload);
}

export async function appendExecutionLogArtifact({
  storageService,
  sessionDir,
  executionLog,
  maxSegmentBytes,
  alreadyLocked,
}) {
  await mkdir(sessionDir, { recursive: true });
  await appendRollingJsonlArtifactLog({
    storageService,
    sessionDir,
    log: executionLog,
    maxSegmentBytes,
    alreadyLocked,
  });
  return { executionLog };
}
