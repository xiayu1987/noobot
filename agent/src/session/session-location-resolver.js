/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { filePath as path } from "@noobot/path-resolver";
import { buildSessionArtifactFileMap } from "./session-artifact-store.js";
import { text, isFunction } from "@noobot/shared/value";

const SESSION_PERSISTENCE_SCOPE_KIND = "noobot.session_persistence_scope";
const SESSION_PERSISTENCE_SCOPE_VERSION = 1;

function buildScope(sessionDir, resolvedParentSessionId = "") {
  const files = buildSessionArtifactFileMap(sessionDir);
  return Object.freeze({
    resolvedParentSessionId: text(resolvedParentSessionId),
    sessionDir,
    sessionFile: files.session,
    sessionSummaryFile: files.sessionSummary,
    taskFile: files.task,
    executionEventsDir: files.executionEventsDir,
    turnsDir: files.turnsDir,
    turnSnapshotsDir: files.turnSnapshotsDir,
    metadataFile: files.meta,
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
    this.userId = text(userId);
    this.sessionId = text(sessionId);
    this.parentSessionId = text(parentSessionId);
    this.scopeId = text(scopeId);
    this.relativeDir = text(relativeDir);
    this.allowedRoot = text(allowedRoot);
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

  async resolveSessionDir(userId, sessionId) {
    this._assertIdentity(userId, sessionId);
    return this.sessionDir;
  }

  async resolveSessionScope(userId, sessionId, parentSessionId = "") {
    this._assertIdentity(userId, sessionId);
    const resolvedParentSessionId = text(parentSessionId);
    if (this.parentSessionId && resolvedParentSessionId !== this.parentSessionId) {
      throw new Error("scoped session parent does not match its execution scope");
    }
    return buildScope(this.sessionDir, resolvedParentSessionId);
  }

  _assertIdentity(userId, sessionId) {
    if (text(userId) !== this.userId) {
      throw new Error("scoped session location user does not match its execution scope");
    }
    const normalizedSessionId = text(sessionId);
    if (!normalizedSessionId) {
      throw new Error("scoped session location requires a sessionId");
    }
    if (this.sessionId && normalizedSessionId !== this.sessionId) {
      throw new Error("scoped session id does not match its execution scope");
    }
  }
}

export function createPersistenceContext({ locationResolver, metadataContributor = null } = {}) {
  if (!locationResolver || !isFunction(locationResolver.resolveSessionScope)) {
    throw new TypeError("persistence context requires a locationResolver");
  }
  if (
    !text(locationResolver?.userId) ||
    !text(locationResolver?.sessionId) ||
    !text(locationResolver?.scopeId)
  ) {
    throw new TypeError("persistence context requires a bound userId, sessionId and scopeId");
  }
  if (metadataContributor !== null && !isFunction(metadataContributor)) {
    throw new TypeError("metadataContributor must be a function");
  }
  return Object.freeze({
    kind: SESSION_PERSISTENCE_SCOPE_KIND,
    version: SESSION_PERSISTENCE_SCOPE_VERSION,
    scopeId: text(locationResolver?.scopeId),
    userId: text(locationResolver?.userId),
    sessionId: text(locationResolver?.sessionId),
    parentSessionId: text(locationResolver?.parentSessionId),
    locationResolver,
    metadataContributor,
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
    userId: text(userId),
    sessionId: text(sessionId),
    parentSessionId: text(parentSessionId),
    scopeId: text(scopeId),
  };
  for (const key of Object.keys(expected)) {
    if (expected[key] && text(context[key]) !== expected[key]) {
      throw new Error(`scoped session persistence ${key} does not match its execution scope`);
    }
  }
  return context;
}

export { buildScope as buildSessionLocationScope };
