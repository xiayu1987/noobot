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

  async _resolveExecutionScope(userId, sessionId, parentSessionId = "", persistenceContext = null) {
    const basePath = this._basePath(userId);
    await this.storageService.ensureRuntimeDirsByBasePath(basePath);
    const resolver = persistenceContext?.locationResolver || this.sessionPathResolver;
    const scope = await resolver.resolveSessionScope(
      userId,
      sessionId,
      parentSessionId,
    );
    const { sessionDir } = scope;
    const files = buildSessionArtifactFileMap(sessionDir);
    return {
      sessionDir,
      executionFile: scope.executionFile || files.execution,
      executionEventsFile: scope.executionEventsFile || files.executionEvents,
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

  async saveBundle(userId, sessionId, executionBundle = {}, parentSessionId = "", persistenceContext = null) {
    if (await this.sessionRepository?.isSessionDeleted(userId, sessionId)) return false;
    const save = async () => {
      const { sessionDir } = await this._resolveExecutionScope(
        userId,
        sessionId,
        parentSessionId,
        persistenceContext,
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
    };
    if (typeof this.sessionRepository?.withSessionMutation === "function") {
      await this.sessionRepository.withSessionMutation(
        userId, sessionId, parentSessionId, save, persistenceContext,
      );
    } else {
      await save();
    }
    return true;
  }

  async appendLog(userId, sessionId, executionLog = {}, executionBundle = {}, parentSessionId = "", persistenceContext = null) {
    if (await this.sessionRepository?.isSessionDeleted(userId, sessionId)) return false;
    const append = async () => {
      const { sessionDir } = await this._resolveExecutionScope(
        userId,
        sessionId,
        parentSessionId,
        persistenceContext,
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
        alreadyLocked: Boolean(this.sessionRepository?.withSessionMutation),
      });
    };
    if (typeof this.sessionRepository?.withSessionMutation === "function") {
      await this.sessionRepository.withSessionMutation(
        userId, sessionId, parentSessionId, append, persistenceContext,
      );
    } else {
      await append();
    }
    return true;
  }
}
