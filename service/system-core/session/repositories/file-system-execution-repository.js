/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { mkdir } from "node:fs/promises";

export class FileSystemExecutionRepository {
  constructor({
    pathResolver,
    sessionPathResolver,
    storageService,
    now = () => new Date().toISOString(),
  } = {}) {
    this.pathResolver = pathResolver;
    this.sessionPathResolver = sessionPathResolver;
    this.storageService = storageService;
    this.now = now;
  }

  _basePath(userId = "") {
    return this.pathResolver.resolveBasePath(userId);
  }

  async _resolveExecutionScope(userId, sessionId, parentSessionId = "") {
    const basePath = this._basePath(userId);
    await this.storageService.ensureRuntimeDirsByBasePath(basePath);
    const { sessionDir, executionFile } = await this.sessionPathResolver.resolveSessionScope(
      userId,
      sessionId,
      parentSessionId,
    );
    return { sessionDir, executionFile };
  }

  async getBundle(userId, sessionId, parentSessionId = "") {
    const { executionFile } = await this._resolveExecutionScope(
      userId,
      sessionId,
      parentSessionId,
    );
    const bundle = await this.storageService.readJson(executionFile, {
      sessionId,
      logs: [],
      updatedAt: this.now(),
    });
    return {
      sessionId: String(bundle?.sessionId || sessionId || "").trim(),
      logs: Array.isArray(bundle?.logs) ? bundle.logs : [],
      updatedAt: bundle?.updatedAt || this.now(),
    };
  }

  async saveBundle(userId, sessionId, executionBundle = {}, parentSessionId = "") {
    const { sessionDir, executionFile } = await this._resolveExecutionScope(
      userId,
      sessionId,
      parentSessionId,
    );
    await mkdir(sessionDir, { recursive: true });
    await this.storageService.writeJsonAtomic(executionFile, {
      sessionId,
      logs: Array.isArray(executionBundle?.logs) ? executionBundle.logs : [],
      updatedAt: this.now(),
    });
  }
}
