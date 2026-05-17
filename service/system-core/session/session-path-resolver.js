/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import path from "node:path";
import { fatalSystemError } from "../error/index.js";
import { tSystem } from "../i18n/system-text.js";
import { ERROR_CODE } from "../error/constants.js";

export class SessionPathResolver {
  constructor({ pathResolver, treeRepository } = {}) {
    this.pathResolver = pathResolver;
    this.treeRepository = treeRepository;
  }

  _basePath(userId = "") {
    return this.pathResolver.resolveBasePath(userId);
  }

  _sessionRoot(userId = "") {
    return this.pathResolver.sessionRoot(this._basePath(userId));
  }

  async resolveParentSessionId(userId, sessionId, parentSessionId = "") {
    const hintedParentSessionId = String(parentSessionId || "").trim();
    if (hintedParentSessionId) {
      const tree = await this.treeRepository.getTree(userId);
      if (!tree?.nodes?.[hintedParentSessionId]) {
        throw fatalSystemError(
          `${tSystem("session.parentSessionNotFoundPossiblyDeleted")}: ${hintedParentSessionId}`,
          {
            code: ERROR_CODE.FATAL_PARENT_SESSION_MISSING,
            details: { hintedParentSessionId },
          },
        );
      }
      return hintedParentSessionId;
    }

    const normalizedSessionId = String(sessionId || "").trim();
    if (!normalizedSessionId) return "";

    const tree = await this.treeRepository.getTree(userId);
    return String(tree?.nodes?.[normalizedSessionId]?.parentSessionId || "").trim();
  }

  async resolveSessionDir(userId, sessionId, parentSessionId = "") {
    const normalizedSessionId = String(sessionId || "").trim();
    if (!normalizedSessionId) return this._sessionRoot(userId);

    const normalizedParentSessionId = String(parentSessionId || "").trim();
    if (normalizedParentSessionId && normalizedParentSessionId !== normalizedSessionId) {
      const parentDir = await this.resolveSessionDir(userId, normalizedParentSessionId);
      return path.join(parentDir, normalizedSessionId);
    }

    const tree = await this.treeRepository.getTree(userId);
    const chain = this.treeRepository.loopSession(normalizedSessionId, tree, []);
    return path.join(this._sessionRoot(userId), ...chain.reverse());
  }

  async resolveSessionScope(userId, sessionId, parentSessionId = "") {
    const resolvedParentSessionId = await this.resolveParentSessionId(
      userId,
      sessionId,
      parentSessionId,
    );
    const sessionDir = await this.resolveSessionDir(
      userId,
      sessionId,
      resolvedParentSessionId,
    );
    return {
      resolvedParentSessionId,
      sessionDir,
      sessionFile: path.join(sessionDir, "session.json"),
      taskFile: path.join(sessionDir, "task.json"),
      executionFile: path.join(sessionDir, "execution.json"),
    };
  }
}
