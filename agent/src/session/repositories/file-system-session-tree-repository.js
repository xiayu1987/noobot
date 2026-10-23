/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { fatalSystemError } from "../../shared/errors/index.js";
import { tSystem } from "noobot-i18n/agent/system-text";
import { normalizeSessionTreeEntity } from "../entities/session-entity.js";
import { ERROR_CODE } from "../../shared/errors/constants.js";
import {
  SESSION_TREE_ERROR,
  resolveSessionTreeChain,
} from "@noobot/workspace-protocol/session-tree";
import {
  SESSION_STORE_ERROR,
  parseWorkspaceSessionTree,
} from "@noobot/workspace-protocol/session-store";
import { text } from "@noobot/shared/value";

export class FileSystemSessionTreeRepository {
  constructor({ pathResolver, storageService } = {}) {
    this.pathResolver = pathResolver;
    this.storageService = storageService;
    this._locks = new Map();
  }

  _basePath(userId = "") {
    return this.pathResolver.resolveBasePath(userId);
  }

  _treeFile(userId = "") {
    return this.pathResolver.sessionTreeFile(this._basePath(userId));
  }

  resolveRootSessionIdFromTree(sessionId, tree) {
    const normalizedSessionId = text(sessionId);
    if (!normalizedSessionId) {
      throw fatalSystemError(tSystem("common.sessionIdRequired"), {
        code: ERROR_CODE.FATAL_SESSION_ID_REQUIRED,
      });
    }
    try {
      return resolveSessionTreeChain(tree, normalizedSessionId)[0];
    } catch (error) {
      if (error?.code !== SESSION_TREE_ERROR.NODE_MISSING) throw error;
      const { missingSessionId } = error.details;
      throw fatalSystemError(`${tSystem("session.treeNodeMissing")}: ${missingSessionId}`, {
        code: ERROR_CODE.FATAL_SESSION_TREE_NODE_MISSING,
        details: { sessionId: normalizedSessionId, missingSessionId },
      });
    }
  }

  workspaceNotInitializedError(basePath, details) {
    return fatalSystemError(`${tSystem("session.workspaceNotInitialized")}: ${basePath}`, {
      code: ERROR_CODE.FATAL_WORKSPACE_NOT_INITIALIZED,
      details: { basePath, ...details },
    });
  }

  async _readTree(userId) {
    const basePath = this._basePath(userId);
    const file = this._treeFile(userId);
    try {
      const raw = await this.storageService.readTextOrNull(file);
      return normalizeSessionTreeEntity(parseWorkspaceSessionTree({ raw, file }));
    } catch (error) {
      if (error?.code !== SESSION_STORE_ERROR.WORKSPACE_NOT_INITIALIZED) throw error;
      throw this.workspaceNotInitializedError(basePath, {
        missingFile: error.details.missingFile,
      });
    }
  }

  async _assertWorkspaceDirectories(userId) {
    const basePath = this._basePath(userId);
    const requiredDirectories = [
      this.pathResolver.sessionRoot(basePath),
      this.pathResolver.sessionLifecycleLocksDir(basePath),
    ];
    for (const directory of requiredDirectories) {
      if (await this.storageService.isDirectory(directory)) continue;
      throw this.workspaceNotInitializedError(basePath, { missingDirectory: directory });
    }
  }

  async assertWorkspaceInitialized(userId) {
    await this.getTree(userId);
  }

  async getTree(userId) {
    await this._assertWorkspaceDirectories(userId);
    return this._readTree(userId);
  }

  async saveTree(userId, tree) {
    await this.assertWorkspaceInitialized(userId);
    await this.storageService.writeJsonAtomic(
      this._treeFile(userId),
      normalizeSessionTreeEntity(tree),
    );
  }

  async withLock(userId, callback) {
    const lockKey = this._basePath(userId);
    const previousLock = this._locks.get(lockKey) || Promise.resolve();
    let releaseCurrentLock = () => {};
    const currentLock = new Promise((resolve) => {
      releaseCurrentLock = resolve;
    });
    const lockMarker = previousLock.then(() => currentLock);
    this._locks.set(lockKey, lockMarker);

    await previousLock;
    try {
      return await callback();
    } finally {
      releaseCurrentLock();
      if (this._locks.get(lockKey) === lockMarker) {
        this._locks.delete(lockKey);
      }
    }
  }
}
