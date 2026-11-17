/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  assertSessionScopeIdentity,
  createSessionDeletedError,
  createSessionNotFoundError,
} from "@noobot/session-protocol";
import {
  openImmutableSessionReader,
  withImmutableSessionReader,
} from "../../session-artifact-session/immutable-session-reader.js";
import { commitSessionChanges } from "../../session-artifact-session/commit-session-changes.js";

function commitScopedChanges(scope, sessionId, request) {
  const { expectedGeneration, operationId, changes, committedAt } = request;
  return commitSessionChanges({
    sessionDir: scope.sessionDir,
    sessionId,
    expectedGeneration,
    operationId,
    changes,
    committedAt,
    validateSnapshot: async ({ get }) => {
      assertSessionScopeIdentity({
        session: await get("metadata", "session"),
        sessionId,
        parentSessionId: scope.resolvedParentSessionId,
      });
    },
  });
}

class ImmutableSessionMethods {
  async findImmutableSessionReader(userId, sessionId, { persistenceContext } = {}) {
    if (await this.isSessionDeleted(userId, sessionId))
      throw createSessionDeletedError({ userId, sessionId });
    const scope = await this.locateSessionScope(userId, sessionId, persistenceContext);
    if (!scope) return null;
    return openImmutableSessionReader({
      sessionDir: scope.sessionDir,
      sessionId,
      parentSessionId: scope.resolvedParentSessionId,
    });
  }

  async requireSessionReader(userId, sessionId, { persistenceContext } = {}) {
    if (await this.isSessionDeleted(userId, sessionId))
      throw createSessionDeletedError({ userId, sessionId });
    const scope = await this.locateSessionScope(userId, sessionId, persistenceContext);
    if (!scope) throw createSessionNotFoundError({ userId, sessionId });
    return openImmutableSessionReader({
      sessionDir: scope.sessionDir,
      sessionId,
      parentSessionId: scope.resolvedParentSessionId,
    });
  }

  async withSessionReader(userId, sessionId, run, { persistenceContext } = {}) {
    return this.withSessionMutation(
      userId,
      sessionId,
      (scope) =>
        withImmutableSessionReader(
          {
            sessionDir: scope.sessionDir,
            sessionId,
            parentSessionId: scope.resolvedParentSessionId,
          },
          (reader, commit) => run(reader, scope, commit),
        ),
      { persistenceContext },
    );
  }

  async commitChanges(
    userId,
    sessionId,
    { persistenceContext, expectedGeneration, operationId, changes, committedAt },
  ) {
    return this.withSessionMutation(
      userId,
      sessionId,
      (scope) =>
        commitScopedChanges(scope, sessionId, {
          expectedGeneration,
          operationId,
          changes,
          committedAt,
        }),
      { persistenceContext },
    );
  }
}

export const immutableSessionMethods = ImmutableSessionMethods.prototype;
