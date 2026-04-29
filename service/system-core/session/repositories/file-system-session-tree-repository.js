/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { fatalSystemError } from "../../error/index.js";
import { normalizeSessionTreeEntity } from "../entities.js";

export class FileSystemSessionTreeRepository {
  constructor({ pathResolver, storageService, now = () => new Date().toISOString() } = {}) {
    this.pathResolver = pathResolver;
    this.storageService = storageService;
    this.now = now;
    this._locks = new Map();
  }

  _basePath(userId = "") {
    return this.pathResolver.resolveBasePath(userId);
  }

  _treeFile(userId = "") {
    return this.pathResolver.sessionTreeFile(this._basePath(userId));
  }

  loopSession(sessionId, tree, chain = []) {
    const normalizedSessionId = String(sessionId || "").trim();
    if (!normalizedSessionId) return chain;
    const parentSessionId = String(
      tree?.nodes?.[normalizedSessionId]?.parentSessionId || "",
    ).trim();
    const nextChain = chain.concat(normalizedSessionId);
    if (!parentSessionId) return nextChain;
    return this.loopSession(parentSessionId, tree, nextChain);
  }

  resolveRootSessionIdFromTree(sessionId = "", tree = {}) {
    const normalizedSessionId = String(sessionId || "").trim();
    if (!normalizedSessionId) return "";
    const nodes =
      tree?.nodes && typeof tree.nodes === "object" ? tree.nodes : {};
    if (!nodes?.[normalizedSessionId]) return normalizedSessionId;
    const chain = this.loopSession(normalizedSessionId, tree, []);
    return String(chain?.[chain.length - 1] || normalizedSessionId).trim();
  }

  async getTree(userId) {
    const basePath = this._basePath(userId);
    const ensured = await this.storageService.ensureRuntimeDirsByBasePath(basePath);
    if (!ensured) {
      return { roots: [], nodes: {}, updatedAt: this.now() };
    }
    const tree = await this.storageService.readJson(this._treeFile(userId), {
      roots: [],
      nodes: {},
      updatedAt: this.now(),
    });
    return normalizeSessionTreeEntity(tree, this.now);
  }

  async saveTree(userId, tree = {}) {
    const basePath = this._basePath(userId);
    const ensured = await this.storageService.ensureRuntimeDirsByBasePath(basePath);
    if (!ensured) {
      throw fatalSystemError(`workspace not initialized: ${basePath}`, {
        code: "FATAL_WORKSPACE_NOT_INITIALIZED",
        details: { basePath },
      });
    }
    const normalizedTree = normalizeSessionTreeEntity(tree, this.now);
    await this.storageService.writeJsonAtomic(this._treeFile(userId), {
      roots: normalizedTree.roots,
      nodes: normalizedTree.nodes,
      updatedAt: this.now(),
    });
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
