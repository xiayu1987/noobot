/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { openSessionArtifactReader } from "./session-artifact-session/immutable-session-reader.js";
import { readExecutionLogs } from "./session-artifact-execution-logs.js";
import { readSessionThinkingDetail } from "./session-thinking-detail.js";
import { readExecutionReportArtifact } from "./session-artifact-session/related-artifact-writer.js";
import { requireStorageService } from "./storage-service.js";

export function createScopedSessionArtifactReader({ storageService }) {
  const storage = requireStorageService(storageService, "createScopedSessionArtifactReader");
  return Object.freeze({
    async readScopedSessionSnapshot({ sessionDir }) {
      await using reader = await openSessionArtifactReader({ sessionDir });
      const [sessionSummary, executionLogs, meta] = await Promise.all([
        reader.readDisplayProjection(),
        readExecutionLogs({ storageService: storage, sessionDir }),
        reader.readScopedMetadata(),
      ]);
      return { sessionSummary, executionLogs, meta };
    },
    async readScopedThinkingDetail({ sessionDir, turnScopeId, dialogProcessId }) {
      return readSessionThinkingDetail({
        storageService: storage,
        sessionDir,
        turnScopeId,
        dialogProcessId,
      });
    },
    async readScopedExecutionReport({ sessionDir, dialogProcessId }) {
      return readExecutionReportArtifact({ storageService: storage, sessionDir, dialogProcessId });
    },
  });
}
