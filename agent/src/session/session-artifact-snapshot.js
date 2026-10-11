/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { buildSessionDisplaySummary } from "./session-summary-builders.js";
import { buildSessionArtifactFileMap, readJsonArtifactFile } from "./session-artifact-files.js";
import { readExecutionLogs } from "./session-artifact-execution-logs.js";
import { readSessionArtifactForRepair } from "./session-artifact-session.js";
import { normalizeSessionDocumentForCurrentProtocol } from "./session-document-normalization.js";

export async function readSessionArtifactSnapshot({
  outputDir = "",
  includeExecutionLogs = true,
} = {}) {
  const files = buildSessionArtifactFileMap(outputDir);
  const [sessionRaw, task, executionLogs, meta] = await Promise.all([
    readSessionArtifactForRepair({ sessionDir: outputDir, fallback: null }),
    readJsonArtifactFile(files.task, null),
    includeExecutionLogs ? readExecutionLogs(outputDir) : Promise.resolve([]),
    readJsonArtifactFile(files.meta, null),
  ]);
  const session = sessionRaw
    ? normalizeSessionDocumentForCurrentProtocol(sessionRaw, {
        sessionId: String(sessionRaw?.sessionId || "").trim(),
      }).document
    : null;
  const sessionSummary = session ? buildSessionDisplaySummary(session) : null;
  return {
    files,
    session,
    sessionSummary,
    task,
    executionLogs,
    meta,
  };
}
