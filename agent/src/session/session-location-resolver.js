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

function buildScope(sessionDir, resolvedParentSessionId, { indexed, registered }) {
  const files = buildSessionArtifactFileMap(sessionDir);
  return Object.freeze({
    resolvedParentSessionId: text(resolvedParentSessionId),
    indexed,
    registered,
    sessionDir,
    sessionFile: files.session,
    sessionSummaryFile: files.sessionSummary,
    executionEventsDir: files.executionEventsDir,
    turnsDir: files.turnsDir,
    turnSnapshotsDir: files.turnSnapshotsDir,
    metadataFile: files.meta,
  });
}

function assertBoundIdentity(resolver, userId, sessionId) {
  if (text(userId) !== resolver.userId) {
    throw new Error("session location user does not match its bound scope");
  }
  const normalizedSessionId = text(sessionId);
  if (!normalizedSessionId) {
    throw new Error("session location requires a sessionId");
  }
  if (normalizedSessionId !== resolver.sessionId) {
    throw new Error("session id does not match its bound location scope");
  }
}

export class SessionTreeLocationContext {
  constructor({ sessionPathResolver, userId, sessionId }) {
    this.sessionPathResolver = sessionPathResolver;
    this.userId = text(userId);
    this.sessionId = text(sessionId);
    this.scopeId = "";
    if (!this.sessionPathResolver || !this.userId || !this.sessionId) {
      throw new TypeError(
        "session tree location requires sessionPathResolver, userId and sessionId",
      );
    }
    Object.freeze(this);
  }

  async locateSessionScope(userId, sessionId) {
    assertBoundIdentity(this, userId, sessionId);
    return this.sessionPathResolver.locateSessionScope(this.userId, this.sessionId);
  }

  async placeSessionScope(userId, { sessionId, parentSessionId }) {
    assertBoundIdentity(this, userId, sessionId);
    return this.sessionPathResolver.placeSessionScope(this.userId, {
      sessionId: this.sessionId,
      parentSessionId,
    });
  }

  async commitSessionPlacement(userId, { sessionId, parentSessionId, caller }) {
    assertBoundIdentity(this, userId, sessionId);
    return this.sessionPathResolver.commitSessionPlacement(this.userId, {
      sessionId: this.sessionId,
      parentSessionId,
      caller,
    });
  }
}

export class ScopedSessionLocationResolver {
  constructor({
    pathResolver,
    userId,
    sessionId,
    parentSessionId,
    scopeId,
    relativeDir,
    allowedRoot,
  }) {
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
      !this.parentSessionId ||
      !this.scopeId ||
      !this.relativeDir ||
      !this.allowedRoot
    ) {
      throw new TypeError(
        "scoped session location requires pathResolver, userId, sessionId, parentSessionId, scopeId, relativeDir and allowedRoot",
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

  async locateSessionScope(userId, sessionId) {
    assertBoundIdentity(this, userId, sessionId);
    return buildScope(this.sessionDir, this.parentSessionId, { indexed: false, registered: true });
  }

  async placeSessionScope(userId, { sessionId, parentSessionId }) {
    assertBoundIdentity(this, userId, sessionId);
    if (parentSessionId !== this.parentSessionId) {
      throw new Error("scoped session parent does not match its execution scope");
    }
    return buildScope(this.sessionDir, this.parentSessionId, { indexed: false, registered: true });
  }

  async commitSessionPlacement(userId, { sessionId, parentSessionId }) {
    await this.placeSessionScope(userId, { sessionId, parentSessionId });
  }
}

export function createPersistenceContext({ locationResolver }) {
  if (
    !isFunction(locationResolver?.locateSessionScope) ||
    !isFunction(locationResolver?.placeSessionScope) ||
    !isFunction(locationResolver?.commitSessionPlacement)
  ) {
    throw new TypeError("persistence context requires a locationResolver");
  }
  const scoped = locationResolver instanceof ScopedSessionLocationResolver;
  if (!scoped && !(locationResolver instanceof SessionTreeLocationContext)) {
    throw new TypeError("persistence context requires a session location implementation");
  }
  return Object.freeze({
    kind: SESSION_PERSISTENCE_SCOPE_KIND,
    version: SESSION_PERSISTENCE_SCOPE_VERSION,
    scoped,
    scopeId: locationResolver.scopeId,
    userId: locationResolver.userId,
    sessionId: locationResolver.sessionId,
    locationResolver,
  });
}

export function createSessionTreePersistenceContext({ sessionPathResolver, userId, sessionId }) {
  return createPersistenceContext({
    locationResolver: new SessionTreeLocationContext({ sessionPathResolver, userId, sessionId }),
  });
}

export { buildScope as buildSessionLocationScope };
