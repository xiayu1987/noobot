/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { buildSessionDisplaySummary } from "./session-summary-builders.js";
import { buildSessionArtifactFileMap } from "./session-artifact-files.js";
import { readExecutionLogs } from "./session-artifact-execution-logs.js";
import { readSessionArtifact } from "./session-artifact-session.js";
import { readOptionalJsonWithStorage } from "./session-artifact-session/artifact-json-io.js";
import { normalizeStoredSession } from "./session-read-validation.js";
import { requireBoolean } from "@noobot/shared/value";

export async function readSessionArtifactSnapshot({
  storageService,
  outputDir,
  includeExecutionLogs,
}) {
  requireBoolean("readSessionArtifactSnapshot", "includeExecutionLogs", includeExecutionLogs);
  const files = buildSessionArtifactFileMap(outputDir);
  const [sessionRaw, executionLogs, meta] = await Promise.all([
    readSessionArtifact({ storageService, sessionDir: outputDir }),
    includeExecutionLogs
      ? readExecutionLogs({ storageService, sessionDir: outputDir })
      : Promise.resolve([]),
    readOptionalJsonWithStorage({ storageService, artifactPath: files.meta }),
  ]);
  const session = normalizeStoredSession(sessionRaw);
  const sessionSummary = buildSessionDisplaySummary(session);
  return {
    files,
    session,
    sessionSummary,
    executionLogs,
    meta,
  };
}
