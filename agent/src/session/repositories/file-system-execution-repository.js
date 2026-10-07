/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { fsMkdir } from "../../shared/storage/fs-adapter.js";
import {
  appendExecutionLogArtifact,
  buildSessionArtifactFileMap,
  normalizeExecutionReportKey,
  readExecutionReportArtifact,
  readJsonlArtifactFile,
  writeExecutionArtifact,
  writeExecutionReportArtifact,
} from "../session-artifact-store.js";

export class FileSystemExecutionRepository {
  constructor({
    pathResolver,
    sessionPathResolver,
    storageService,
    sessionRepository,
    now = () => new Date().toISOString(),
  } = {}) {
    this.pathResolver = pathResolver;
    this.sessionPathResolver = sessionPathResolver;
    this.storageService = storageService;
    this.sessionRepository = sessionRepository;
    this.now = now;
  }

  _basePath(userId = "") {
    return this.pathResolver.resolveBasePath(userId);
  }

  async _resolveExecutionScope(userId, sessionId, parentSessionId = "", persistenceContext = null) {
    const basePath = this._basePath(userId);
    await this.storageService.ensureRuntimeDirsByBasePath(basePath);
    const resolver = persistenceContext?.locationResolver || this.sessionPathResolver;
    const scope = await resolver.resolveSessionScope(userId, sessionId, parentSessionId);
    const { sessionDir } = scope;
    const files = buildSessionArtifactFileMap(sessionDir);
    return {
      sessionDir,
      executionFile: scope.executionFile || files.execution,
      executionEventsFile: scope.executionEventsFile || files.executionEvents,
    };
  }

  async _mutateSessionDir(userId, sessionId, parentSessionId, persistenceContext, write) {
    if (await this.sessionRepository.isSessionDeleted(userId, sessionId)) return false;
    const mutate = async () => {
      const { sessionDir } = await this._resolveExecutionScope(
        userId,
        sessionId,
        parentSessionId,
        persistenceContext,
      );
      await fsMkdir(sessionDir, { recursive: true });
      await write(sessionDir);
    };
    await this.sessionRepository.withSessionMutation(
      userId,
      sessionId,
      parentSessionId,
      mutate,
      persistenceContext,
    );
    return true;
  }

  _buildExecutionPayload(sessionId, executionBundle = {}) {
    return {
      sessionId,
      ...(executionBundle?.dialogProcessId
        ? { dialogProcessId: executionBundle.dialogProcessId }
        : {}),
      updatedAt: this.now(),
    };
  }

  async getBundle(userId, sessionId, parentSessionId = "", persistenceContext = null) {
    const { executionFile, executionEventsFile } = await this._resolveExecutionScope(
      userId,
      sessionId,
      parentSessionId,
      persistenceContext,
    );
    const bundle = await this.storageService.readJson(executionFile, {
      sessionId,
      updatedAt: this.now(),
    });
    const jsonlLogs = await readJsonlArtifactFile(executionEventsFile);
    const dialogProcessId = String(bundle?.dialogProcessId || "").trim();
    return {
      sessionId: String(bundle?.sessionId || sessionId || "").trim(),
      ...(dialogProcessId ? { dialogProcessId } : {}),
      logs: jsonlLogs,
      updatedAt: bundle?.updatedAt || this.now(),
    };
  }

  async getBundleMetadata(userId, sessionId, parentSessionId = "", persistenceContext = null) {
    const { executionFile } = await this._resolveExecutionScope(
      userId,
      sessionId,
      parentSessionId,
      persistenceContext,
    );
    const bundle = await this.storageService.readJson(executionFile, {
      sessionId,
      updatedAt: this.now(),
    });
    const dialogProcessId = String(bundle?.dialogProcessId || "").trim();
    return {
      sessionId: String(bundle?.sessionId || sessionId || "").trim(),
      ...(dialogProcessId ? { dialogProcessId } : {}),
      updatedAt: bundle?.updatedAt || this.now(),
    };
  }

  async saveBundle(
    userId,
    sessionId,
    executionBundle = {},
    parentSessionId = "",
    persistenceContext = null,
  ) {
    return this._mutateSessionDir(
      userId,
      sessionId,
      parentSessionId,
      persistenceContext,
      (sessionDir) =>
        writeExecutionArtifact({
          storageService: this.storageService,
          sessionDir,
          executionPayload: this._buildExecutionPayload(sessionId, executionBundle),
        }),
    );
  }

  async saveReport(
    userId,
    sessionId,
    report = {},
    parentSessionId = "",
    persistenceContext = null,
  ) {
    if (!normalizeExecutionReportKey(report?.dialogProcessId)) return false;
    return this._mutateSessionDir(
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
    dialogProcessId = "",
    parentSessionId = "",
    persistenceContext = null,
  ) {
    if (!normalizeExecutionReportKey(dialogProcessId)) return null;
    const { sessionDir } = await this._resolveExecutionScope(
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
    executionBundle = {},
    parentSessionId = "",
    persistenceContext = null,
  ) {
    return this._mutateSessionDir(
      userId,
      sessionId,
      parentSessionId,
      persistenceContext,
      (sessionDir) =>
        appendExecutionLogArtifact({
          storageService: this.storageService,
          sessionDir,
          executionLog,
          executionPayload: this._buildExecutionPayload(sessionId, executionBundle),
          resetExecutionLogs: executionBundle?.resetExecutionLogs === true,
          alreadyLocked: true,
        }),
    );
  }
}
