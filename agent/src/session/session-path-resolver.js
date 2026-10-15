/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { filePath as path } from "@noobot/path-resolver";
import { fatalSystemError } from "../shared/errors/index.js";
import { tSystem } from "noobot-i18n/agent/system-text";
import { ERROR_CODE } from "../shared/errors/constants.js";
import { buildSessionLocationScope } from "./session-location-resolver.js";
import {
  SESSION_TREE_ERROR,
  resolveSessionTreePlacement,
} from "@noobot/workspace-protocol/session-tree";
import { text } from "@noobot/shared/value";

const SESSION_TREE_FATAL_CODE = Object.freeze({
  [SESSION_TREE_ERROR.NODE_MISSING]: ERROR_CODE.FATAL_SESSION_TREE_NODE_MISSING,
  [SESSION_TREE_ERROR.PARENT_MISMATCH]: ERROR_CODE.FATAL_PARENT_SESSION_MISSING,
  [SESSION_TREE_ERROR.CYCLE]: ERROR_CODE.FATAL_SESSION_TREE_NODE_MISSING,
});

function toSessionTreeFatalError(error, sessionId) {
  const code = SESSION_TREE_FATAL_CODE[error?.code];
  if (!code) throw error;
  return fatalSystemError(`${tSystem("session.treeNodeMissing")}: ${error.message}`, {
    code,
    details: { sessionId, protocolCode: error.code, ...error.details },
  });
}

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
    const hintedParentSessionId = text(parentSessionId);
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

    const normalizedSessionId = text(sessionId);
    if (!normalizedSessionId) return "";

    const tree = await this.treeRepository.getTree(userId);
    return text(tree?.nodes?.[normalizedSessionId]?.parentSessionId);
  }

  async resolveSessionDir(userId, sessionId, parentSessionId = "") {
    const normalizedSessionId = text(sessionId);
    if (!normalizedSessionId) return this._sessionRoot(userId);
    const tree = await this.treeRepository.getTree(userId);
    let chain;
    try {
      chain = resolveSessionTreePlacement(tree, normalizedSessionId, parentSessionId);
    } catch (error) {
      throw toSessionTreeFatalError(error, normalizedSessionId);
    }
    return path.join(this._sessionRoot(userId), ...chain);
  }

  async resolveSessionScope(userId, sessionId, parentSessionId = "") {
    const resolvedParentSessionId = await this.resolveParentSessionId(
      userId,
      sessionId,
      parentSessionId,
    );
    const sessionDir = await this.resolveSessionDir(userId, sessionId, resolvedParentSessionId);
    return buildSessionLocationScope(sessionDir, resolvedParentSessionId);
  }
}
