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
import { readJsonWithStorage, writeJsonWithStorage } from "./artifact-json-io.js";
import {
  hydrateSessionSummaryDetails,
  writeSessionSummaryDetails,
} from "./summary-detail-store.js";

export async function readSessionDisplaySummaryArtifact({
  storageService = null,
  sessionDir = "",
  sessionId = "",
} = {}) {
  const files = buildSessionArtifactFileMap(sessionDir);
  const payload = await readJsonWithStorage({
    storageService,
    artifactPath: files.sessionSummary,
    fallback: null,
  });
  if (!isSessionDisplaySummaryPayload(payload, sessionId)) return null;
  return hydrateSessionSummaryDetails({ storageService, sessionDir, payload });
}

export async function rebuildSessionDisplaySummaryArtifact({
  storageService = null,
  sessionDir = "",
  sessionPayload = {},
} = {}) {
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
