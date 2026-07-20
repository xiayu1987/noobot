/*
 * Copyright (c) 2026 xiayu
 * SPDX-License-Identifier: MIT
 */
import { filePath as path } from "../utils/path-resolver.js";
import { buildSessionArtifactFileMap } from "./session-artifact-store.js";

function buildScope(sessionDir, resolvedParentSessionId = "") {
  const files = buildSessionArtifactFileMap(sessionDir);
  return Object.freeze({
    resolvedParentSessionId: String(resolvedParentSessionId || "").trim(),
    sessionDir,
    sessionFile: files.session,
    sessionSummaryFile: files.sessionSummary,
    taskFile: files.task,
    executionFile: files.execution,
    executionEventsFile: files.executionEvents,
    metadataFile: files.meta,
    mutationLockDir: `${sessionDir}.mutation-lock`,
  });
}

/** Execution-scoped location strategy. It deliberately contains no plugin semantics. */
export class ScopedSessionLocationResolver {
  constructor({ pathResolver, userId = "", relativeDir = "", allowedRoot = "" } = {}) {
    this.pathResolver = pathResolver;
    this.userId = String(userId || "").trim();
    this.relativeDir = String(relativeDir || "").trim();
    this.allowedRoot = String(allowedRoot || "").trim();
    if (!this.pathResolver || !this.userId || !this.relativeDir || !this.allowedRoot) {
      throw new TypeError("scoped session location requires pathResolver, userId, relativeDir and allowedRoot");
    }
    if (path.isAbsolute(this.relativeDir) || path.isAbsolute(this.allowedRoot)) {
      throw new Error("scoped session location must be relative to the user workspace");
    }
    const basePath = this.pathResolver.resolveBasePath(this.userId);
    const root = path.resolve(basePath, this.allowedRoot);
    const target = path.resolve(basePath, this.relativeDir);
    const defaultRoot = path.resolve(this.pathResolver.sessionRoot(basePath));
    if (target === root) {
      throw new Error("scoped session location must target a child of its allowed root");
    }
    if (!target.startsWith(`${root}${path.sep}`)) {
      throw new Error("scoped session location escapes its allowed root");
    }
    if (target === defaultRoot || target.startsWith(`${defaultRoot}${path.sep}`)) {
      throw new Error("scoped session location cannot target the default session root");
    }
    this.sessionDir = target;
    Object.freeze(this);
  }

  async resolveParentSessionId(_userId, _sessionId, parentSessionId = "") {
    this._assertIdentity(_userId, _sessionId);
    return String(parentSessionId || "").trim();
  }

  async resolveSessionDir(userId, sessionId) {
    this._assertIdentity(userId, sessionId);
    return this.sessionDir;
  }

  async resolveSessionScope(userId, sessionId, parentSessionId = "") {
    this._assertIdentity(userId, sessionId);
    return buildScope(this.sessionDir, parentSessionId);
  }

  _assertIdentity(userId, sessionId) {
    if (String(userId || "").trim() !== this.userId) {
      throw new Error("scoped session location user does not match its execution scope");
    }
    if (!String(sessionId || "").trim()) {
      throw new Error("scoped session location requires a sessionId");
    }
  }
}

export function createPersistenceContext({ locationResolver, metadataContributor = null } = {}) {
  if (!locationResolver || typeof locationResolver.resolveSessionScope !== "function") {
    throw new TypeError("persistence context requires a locationResolver");
  }
  if (metadataContributor !== null && typeof metadataContributor !== "function") {
    throw new TypeError("metadataContributor must be a function");
  }
  return Object.freeze({ locationResolver, metadataContributor });
}

export { buildScope as buildSessionLocationScope };
