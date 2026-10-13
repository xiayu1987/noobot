/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { requireDialogProcessKey } from "@noobot/session-protocol";
import { fsMkdir } from "../../shared/storage/fs-adapter.js";
import {
  appendExecutionLogArtifact,
  readExecutionReportArtifact,
  readExecutionLogs,
  writeExecutionReportArtifact,
} from "../session-artifact-store.js";

export class FileSystemExecutionRepository {
  constructor({ pathResolver, sessionPathResolver, storageService, sessionRepository } = {}) {
    this.pathResolver = pathResolver;
    this.sessionPathResolver = sessionPathResolver;
    this.storageService = storageService;
    this.sessionRepository = sessionRepository;
  }

  async _resolveSessionDir(userId, sessionId, parentSessionId = "", persistenceContext = null) {
    const resolver = persistenceContext?.locationResolver || this.sessionPathResolver;
    const { sessionDir } = await resolver.resolveSessionScope(userId, sessionId, parentSessionId);
    return sessionDir;
  }

  async _mutateSessionDir(userId, sessionId, parentSessionId, persistenceContext, write) {
    return this.sessionRepository.withSessionMutation(
      userId,
      sessionId,
      parentSessionId,
      async () => {
        const sessionDir = await this._resolveSessionDir(
          userId,
          sessionId,
          parentSessionId,
          persistenceContext,
        );
        await fsMkdir(sessionDir, { recursive: true });
        return write(sessionDir);
      },
      persistenceContext,
    );
  }

  async getTurnLogs(
    userId,
    sessionId,
    dialogProcessId,
    parentSessionId = "",
    persistenceContext = null,
  ) {
    const sessionDir = await this._resolveSessionDir(
      userId,
      sessionId,
      parentSessionId,
      persistenceContext,
    );
    return readExecutionLogs(sessionDir, {
      dialogProcessId: requireDialogProcessKey(dialogProcessId),
    });
  }

  async saveReport(
    userId,
    sessionId,
    report = {},
    parentSessionId = "",
    persistenceContext = null,
  ) {
    await this._mutateSessionDir(
      userId,
      sessionId,
      parentSessionId,
      persistenceContext,
      (sessionDir) =>
        writeExecutionReportArtifact({
          storageService: this.storageService,
          sessionDir,
          reportPayload: report,
        }),
    );
  }

  async getReport(
    userId,
    sessionId,
    dialogProcessId,
    parentSessionId = "",
    persistenceContext = null,
  ) {
    const sessionDir = await this._resolveSessionDir(
      userId,
      sessionId,
      parentSessionId,
      persistenceContext,
    );
    return readExecutionReportArtifact({
      storageService: this.storageService,
      sessionDir,
      dialogProcessId,
    });
  }

  async appendLog(
    userId,
    sessionId,
    executionLog = {},
    parentSessionId = "",
    persistenceContext = null,
  ) {
    await this._mutateSessionDir(
      userId,
      sessionId,
      parentSessionId,
      persistenceContext,
      (sessionDir) => appendExecutionLogArtifact({ sessionDir, executionLog, alreadyLocked: true }),
    );
  }
}
