/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { buildSessionDisplaySummary } from "../session-summary-builders.js";
import { buildSessionArtifactFileMap } from "../session-artifact-files.js";
import { writeJsonWithStorage } from "./artifact-json-io.js";
import { writeSessionSummaryDetails } from "./summary-detail-store.js";

export async function rebuildSessionDisplaySummaryArtifact({
  storageService,
  sessionDir,
  sessionPayload,
}) {
  const files = buildSessionArtifactFileMap(sessionDir);
  const summaryPayload = buildSessionDisplaySummary(sessionPayload);
  await writeSessionSummaryDetails({ storageService, sessionDir, summaryPayload });
  await writeJsonWithStorage({
    storageService,
    artifactPath: files.sessionSummary,
    payload: summaryPayload,
    atomic: true,
  });
  return summaryPayload;
}
