/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { fsMkdir } from "../../store/fs-adapter.js";
import {
  appendExecutionLogArtifact,
  buildSessionArtifactFileMap,
  readJsonlArtifactFile,
  writeExecutionArtifact,
} from "../session-artifact-store.js";

export class FileSystemExecutionRepository {
  constructor({
    pathResolver,
    sessionPathResolver,
    storageService,
    sessionRepository = null,
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

  async _resolveExecutionScope(userId, sessionId, parentSessionId = "") {
    const basePath = this._basePath(userId);
    await this.storageService.ensureRuntimeDirsByBasePath(basePath);
    const { sessionDir } = await this.sessionPathResolver.resolveSessionScope(
      userId,
      sessionId,
      parentSessionId,
    );
    const files = buildSessionArtifactFileMap(sessionDir);
    return {
      sessionDir,
      executionFile: files.execution,
      executionEventsFile: files.executionEvents,
    };
  }

  async getBundle(userId, sessionId, parentSessionId = "") {
    const { executionFile, executionEventsFile } = await this._resolveExecutionScope(
      userId,
      sessionId,
      parentSessionId,
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

  async saveBundle(userId, sessionId, executionBundle = {}, parentSessionId = "") {
    if (await this.sessionRepository?.isSessionDeleted(userId, sessionId)) return false;
    const { sessionDir } = await this._resolveExecutionScope(
      userId,
      sessionId,
      parentSessionId,
    );
    await fsMkdir(sessionDir, { recursive: true });
    await writeExecutionArtifact({
      storageService: this.storageService,
      sessionDir,
      executionPayload: {
        sessionId,
        ...(executionBundle?.dialogProcessId ? { dialogProcessId: executionBundle.dialogProcessId } : {}),
        updatedAt: this.now(),
      },
    });
    return true;
  }

  async appendLog(userId, sessionId, executionLog = {}, executionBundle = {}, parentSessionId = "") {
    if (await this.sessionRepository?.isSessionDeleted(userId, sessionId)) return false;
    const { sessionDir } = await this._resolveExecutionScope(
      userId,
      sessionId,
      parentSessionId,
    );
    await fsMkdir(sessionDir, { recursive: true });
    await appendExecutionLogArtifact({
      storageService: this.storageService,
      sessionDir,
      executionLog,
      executionPayload: {
        sessionId,
        ...(executionBundle?.dialogProcessId ? { dialogProcessId: executionBundle.dialogProcessId } : {}),
        updatedAt: this.now(),
      },
      resetExecutionLogs: executionBundle?.resetExecutionLogs === true,
    });
    return true;
  }
}
