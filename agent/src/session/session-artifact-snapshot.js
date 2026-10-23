/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { buildSessionDisplaySummary } from "./session-summary-builders.js";
import { buildSessionArtifactFileMap, readJsonArtifactFile } from "./session-artifact-files.js";
import { readExecutionLogs } from "./session-artifact-execution-logs.js";
import { readSessionArtifact } from "./session-artifact-session.js";
import { normalizeStoredSession } from "./session-read-validation.js";

export async function readSessionArtifactSnapshot({ outputDir, includeExecutionLogs = true }) {
  const files = buildSessionArtifactFileMap(outputDir);
  const [sessionRaw, task, executionLogs, meta] = await Promise.all([
    readSessionArtifact({ sessionDir: outputDir }),
    readJsonArtifactFile(files.task, null),
    includeExecutionLogs ? readExecutionLogs(outputDir) : Promise.resolve([]),
    readJsonArtifactFile(files.meta, null),
  ]);
  const session = normalizeStoredSession(sessionRaw);
  const sessionSummary = buildSessionDisplaySummary(session);
  return {
    files,
    session,
    sessionSummary,
    task,
    executionLogs,
    meta,
  };
}
