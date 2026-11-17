/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  prepareSessionArtifactCleanup,
  cleanupSessionArtifacts,
  discardSessionArtifactCleanup,
} from "../../src/session/session-artifact-maintenance.js";

export async function prepareSessionArtifactCleanupToCompletion(options) {
  let result = await prepareSessionArtifactCleanup(options);
  while (!result.complete)
    result = await prepareSessionArtifactCleanup({ ...options, planId: result.planId });
  return result;
}

export async function prepareAndCleanupSessionArtifacts({
  dryRun,
  maxRemovals,
  maxCandidates,
  ...options
}) {
  const { planId } = await prepareSessionArtifactCleanupToCompletion({ ...options, dryRun });
  try {
    return await cleanupSessionArtifacts({ ...options, planId, maxRemovals, maxCandidates });
  } finally {
    await discardSessionArtifactCleanup({ ...options, planId, signal: undefined });
  }
}
