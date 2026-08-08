/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { filePath as path } from "../shared/utils/path-resolver.js";
import { buildSessionArtifactFileMap } from "./session-artifact-store.js";

export const SESSION_PERSISTENCE_SCOPE_KIND = "noobot.session_persistence_scope";
export const SESSION_PERSISTENCE_SCOPE_VERSION = 1;

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
    executionEventsDir: files.executionEventsDir,
    turnsDir: files.turnsDir,
    turnSnapshotsDir: files.turnSnapshotsDir,
    metadataFile: files.meta,
    mutationLockDir: `${sessionDir}.mutation-lock`,
  });
}

export class ScopedSessionLocationResolver {
  constructor({
    pathResolver,
    userId = "",
    sessionId = "",
    parentSessionId = "",
    scopeId = "",
    relativeDir = "",
    allowedRoot = "",
  } = {}) {
    this.pathResolver = pathResolver;
    this.userId = String(userId || "").trim();
    this.sessionId = String(sessionId || "").trim();
    this.parentSessionId = String(parentSessionId || "").trim();
    this.scopeId = String(scopeId || "").trim();
    this.relativeDir = String(relativeDir || "").trim();
    this.allowedRoot = String(allowedRoot || "").trim();
    if (
      !this.pathResolver ||
      !this.userId ||
      !this.sessionId ||
      !this.scopeId ||
      !this.relativeDir ||
      !this.allowedRoot
    ) {
      throw new TypeError(
        "scoped session location requires pathResolver, userId, sessionId, scopeId, relativeDir and allowedRoot",
      );
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
    const resolvedParentSessionId = String(parentSessionId || "").trim();
    if (this.parentSessionId && resolvedParentSessionId !== this.parentSessionId) {
      throw new Error("scoped session parent does not match its execution scope");
    }
    return resolvedParentSessionId;
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
    const normalizedSessionId = String(sessionId || "").trim();
    if (!normalizedSessionId) {
      throw new Error("scoped session location requires a sessionId");
    }
    if (this.sessionId && normalizedSessionId !== this.sessionId) {
      throw new Error("scoped session id does not match its execution scope");
    }
  }
}

export function createPersistenceContext({ locationResolver, metadataContributor = null, sessionGeneration = null } = {}) {
  if (!locationResolver || typeof locationResolver.resolveSessionScope !== "function") {
    throw new TypeError("persistence context requires a locationResolver");
  }
  if (
    !String(locationResolver?.userId || "").trim() ||
    !String(locationResolver?.sessionId || "").trim() ||
    !String(locationResolver?.scopeId || "").trim()
  ) {
    throw new TypeError("persistence context requires a bound userId, sessionId and scopeId");
  }
  if (metadataContributor !== null && typeof metadataContributor !== "function") {
    throw new TypeError("metadataContributor must be a function");
  }
  return Object.freeze({
    kind: SESSION_PERSISTENCE_SCOPE_KIND,
    version: SESSION_PERSISTENCE_SCOPE_VERSION,
    scopeId: String(locationResolver?.scopeId || "").trim(),
    userId: String(locationResolver?.userId || "").trim(),
    sessionId: String(locationResolver?.sessionId || "").trim(),
    parentSessionId: String(locationResolver?.parentSessionId || "").trim(),
    locationResolver,
    metadataContributor,
    sessionGeneration: Number.isInteger(Number(sessionGeneration)) && Number(sessionGeneration) > 0
      ? Number(sessionGeneration)
      : null,
  });
}

export function assertPersistenceContextIdentity(
  context = null,
  { userId = "", sessionId = "", parentSessionId = "", scopeId = "" } = {},
) {
  if (!context?.locationResolver) return null;
  if (
    context.kind !== SESSION_PERSISTENCE_SCOPE_KIND ||
    Number(context.version) !== SESSION_PERSISTENCE_SCOPE_VERSION
  ) {
    throw new TypeError("invalid scoped session persistence context");
  }
  const expected = {
    userId: String(userId || "").trim(),
    sessionId: String(sessionId || "").trim(),
    parentSessionId: String(parentSessionId || "").trim(),
    scopeId: String(scopeId || "").trim(),
  };
  for (const key of Object.keys(expected)) {
    if (expected[key] && String(context[key] || "").trim() !== expected[key]) {
      throw new Error(`scoped session persistence ${key} does not match its execution scope`);
    }
  }
  return context;
}

export { buildScope as buildSessionLocationScope };
