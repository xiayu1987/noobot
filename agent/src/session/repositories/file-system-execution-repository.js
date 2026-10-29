/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { requireDialogProcessKey } from "@noobot/session-protocol";
import { LENGTH_THRESHOLDS } from "@noobot/shared/length-thresholds";
import { fsMkdir } from "../../shared/storage/fs-adapter.js";
import {
  appendExecutionLogArtifact,
  readExecutionReportArtifact,
  readTurnExecutionLogs,
  writeExecutionReportArtifact,
} from "../session-artifact-store.js";

export class FileSystemExecutionRepository {
  constructor({ storageService, sessionRepository } = {}) {
    this.storageService = storageService;
    this.sessionRepository = sessionRepository;
  }

  async _requireSessionDir(userId, sessionId, persistenceContext) {
    const scope = await this.sessionRepository.requireSessionScope(
      userId,
      sessionId,
      persistenceContext,
    );
    return scope.sessionDir;
  }

  async _mutateSessionDir(userId, sessionId, persistenceContext, write) {
    return this.sessionRepository.withSessionMutation(
      userId,
      sessionId,
      async (scope) => {
        await fsMkdir(scope.sessionDir, { recursive: true });
        return write(scope.sessionDir);
      },
      { persistenceContext },
    );
  }

  async getTurnLogs(userId, sessionId, dialogProcessId, { persistenceContext } = {}) {
    const sessionDir = await this._requireSessionDir(userId, sessionId, persistenceContext);
    return readTurnExecutionLogs({
      storageService: this.storageService,
      sessionDir,
      dialogProcessId: requireDialogProcessKey(dialogProcessId),
    });
  }

  async saveReport(userId, sessionId, report, { persistenceContext } = {}) {
    await this._mutateSessionDir(userId, sessionId, persistenceContext, (sessionDir) =>
      writeExecutionReportArtifact({
        storageService: this.storageService,
        sessionDir,
        reportPayload: report,
        atomic: true,
      }),
    );
  }

  async getReport(userId, sessionId, dialogProcessId, { persistenceContext } = {}) {
    const sessionDir = await this._requireSessionDir(userId, sessionId, persistenceContext);
    return readExecutionReportArtifact({
      storageService: this.storageService,
      sessionDir,
      dialogProcessId,
    });
  }

  async appendLog(userId, sessionId, executionLog, { persistenceContext } = {}) {
    await this._mutateSessionDir(userId, sessionId, persistenceContext, (sessionDir) =>
      appendExecutionLogArtifact({
        storageService: this.storageService,
        sessionDir,
        executionLog,
        maxSegmentBytes: LENGTH_THRESHOLDS.artifact.executionEventSegmentBytes,
        alreadyLocked: true,
      }),
    );
  }
}
