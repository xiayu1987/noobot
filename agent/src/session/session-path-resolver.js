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
import { SESSION_ERROR_CODE } from "@noobot/session-protocol";
import {
  SESSION_TREE_ERROR,
  createSessionTreeNode,
  isSessionTreeNodeRegistered,
  placeSessionTreeChain,
  resolveSessionTreeChain,
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

  async locateSessionScope(userId, sessionId) {
    const tree = await this.treeRepository.getTree(userId);
    if (!isSessionTreeNodeRegistered(tree, sessionId)) return null;
    return this._scopeOf(userId, sessionId, true, () => resolveSessionTreeChain(tree, sessionId));
  }

  async placeSessionScope(userId, { sessionId, parentSessionId }) {
    const tree = await this.treeRepository.getTree(userId);
    return this._scopeOf(userId, sessionId, isSessionTreeNodeRegistered(tree, sessionId), () =>
      placeSessionTreeChain(tree, { sessionId, parentSessionId }),
    );
  }

  async commitSessionPlacement(userId, { sessionId, parentSessionId, caller }) {
    const node = createSessionTreeNode({ sessionId, parentSessionId, caller });
    return this.treeRepository.withLock(userId, async () => {
      const tree = await this.treeRepository.getTree(userId);
      this._scopeOf(userId, node.sessionId, false, () => placeSessionTreeChain(tree, node));
      const current = tree.nodes[node.sessionId];
      if (current) {
        if (current.caller === node.caller) return;
        const error = new Error("session tree node conflicts with requested node");
        error.statusCode = 409;
        error.code = SESSION_ERROR_CODE.SESSION_TREE_NODE_CONFLICT;
        throw error;
      }
      tree.nodes[node.sessionId] = node;
      await this.treeRepository.saveTree(userId, tree);
    });
  }

  _scopeOf(userId, sessionId, registered, resolveChain) {
    let chain;
    try {
      chain = resolveChain();
    } catch (error) {
      throw toSessionTreeFatalError(error, sessionId);
    }
    const sessionDir = path.join(this._sessionRoot(userId), ...chain);
    return buildSessionLocationScope(sessionDir, chain.length > 1 ? chain.at(-2) : "", {
      indexed: true,
      registered,
    });
  }
}
