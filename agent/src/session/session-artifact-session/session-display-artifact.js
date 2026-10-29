/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  buildSessionDisplaySummary,
  isSessionDisplaySummaryPayload,
} from "../session-summary-builders.js";
import { buildSessionArtifactFileMap } from "../session-artifact-files.js";
import { readOptionalJsonWithStorage, writeJsonWithStorage } from "./artifact-json-io.js";
import {
  hydrateSessionSummaryDetails,
  writeSessionSummaryDetails,
} from "./summary-detail-store.js";

export async function readSessionDisplaySummaryArtifact({ storageService, sessionDir, sessionId }) {
  const files = buildSessionArtifactFileMap(sessionDir);
  const payload = await readOptionalJsonWithStorage({
    storageService,
    artifactPath: files.sessionSummary,
  });
  if (!isSessionDisplaySummaryPayload(payload, sessionId)) return null;
  const hydrated = await hydrateSessionSummaryDetails({ storageService, sessionDir, payload });
  return isSessionDisplaySummaryPayload(hydrated, sessionId) ? hydrated : null;
}

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
