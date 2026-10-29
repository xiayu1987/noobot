/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { readSessionArtifactSnapshot } from "./session-artifact-snapshot.js";
import { readSessionThinkingDetail } from "./session-thinking-detail.js";
import { readExecutionReportArtifact } from "./session-artifact-session/related-artifact-writer.js";
import { requireStorageService } from "./storage-service.js";

export function createScopedSessionArtifactReader({ storageService }) {
  const storage = requireStorageService(storageService, "createScopedSessionArtifactReader");
  return Object.freeze({
    async readScopedSessionSnapshot({ sessionDir }) {
      const { sessionSummary, executionLogs, meta } = await readSessionArtifactSnapshot({
        storageService: storage,
        outputDir: sessionDir,
        includeExecutionLogs: true,
      });
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
