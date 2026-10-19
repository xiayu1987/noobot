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

const NODE_MISSING_FATAL = Object.freeze({
  code: ERROR_CODE.FATAL_SESSION_TREE_NODE_MISSING,
  messageKey: "session.treeNodeMissing",
});
const PARENT_MISSING_FATAL = Object.freeze({
  code: ERROR_CODE.FATAL_PARENT_SESSION_MISSING,
  messageKey: "session.parentSessionNotFoundPossiblyDeleted",
});
const SESSION_TREE_FATAL = Object.freeze({
  [SESSION_TREE_ERROR.NODE_MISSING]: NODE_MISSING_FATAL,
  [SESSION_TREE_ERROR.CYCLE]: NODE_MISSING_FATAL,
  [SESSION_TREE_ERROR.PARENT_MISSING]: PARENT_MISSING_FATAL,
  [SESSION_TREE_ERROR.PARENT_MISMATCH]: PARENT_MISSING_FATAL,
});

export function toSessionTreeFatalError(error, sessionId) {
  const fatal = SESSION_TREE_FATAL[error.code];
  if (!fatal) throw error;
  return fatalSystemError(`${tSystem(fatal.messageKey)}: ${error.message}`, {
    code: fatal.code,
    details: { sessionId, protocolCode: error.code, ...error.details },
  });
}

export class SessionPathResolver {
  constructor({ pathResolver, treeRepository }) {
    this.pathResolver = pathResolver;
    this.treeRepository = treeRepository;
  }

  _basePath(userId) {
    return this.pathResolver.resolveBasePath(userId);
  }

  _sessionRoot(userId) {
    return this.pathResolver.sessionRoot(this._basePath(userId));
  }

  async resolveSessionScope(userId, sessionId, parentSessionId) {
    const tree = await this.treeRepository.getTree(userId);
    let chain;
    try {
      chain = resolveSessionTreePlacement(tree, sessionId, parentSessionId);
    } catch (error) {
      throw toSessionTreeFatalError(error, sessionId);
    }
    const sessionDir = path.join(this._sessionRoot(userId), ...chain);
    return buildSessionLocationScope(sessionDir, chain.length > 1 ? chain.at(-2) : "");
  }
}
