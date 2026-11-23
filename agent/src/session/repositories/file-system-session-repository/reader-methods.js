/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { createSessionDeletedError, createSessionNotFoundError } from "@noobot/session-protocol";

function readerScope(sessionId, scope) {
  return {
    sessionDir: scope.sessionDir,
    sessionId,
    parentSessionId: scope.resolvedParentSessionId,
  };
}

class SessionReaderMethods {
  _openSessionReader(userId, sessionId, { persistenceContext, required }) {
    return this.withSessionLifecycleMutation(userId, sessionId, async () => {
      if (await this.isSessionDeleted(userId, sessionId)) {
        if (required) throw createSessionDeletedError({ userId, sessionId });
        return null;
      }
      const scope = await this.locateSessionScope(userId, sessionId, persistenceContext);
      if (!scope) {
        if (required) throw createSessionNotFoundError({ userId, sessionId });
        return null;
      }
      return this.sessionReaderAccess.open(readerScope(sessionId, scope));
    });
  }

  findSessionReader(userId, sessionId, { persistenceContext } = {}) {
    return this._openSessionReader(userId, sessionId, { persistenceContext, required: false });
  }

  requireSessionReader(userId, sessionId, { persistenceContext } = {}) {
    return this._openSessionReader(userId, sessionId, { persistenceContext, required: true });
  }

  withSessionCommit(userId, sessionId, run, { persistenceContext } = {}) {
    return this.withSessionMutation(
      userId,
      sessionId,
      (scope) =>
        this.sessionReaderAccess.withCommit(readerScope(sessionId, scope), (operations) =>
          run({ ...operations, scope }),
        ),
      { persistenceContext },
    );
  }

  withSessionOutboxMutation(userId, sessionId, plan, { persistenceContext } = {}) {
    return this.withSessionMutation(
      userId,
      sessionId,
      (scope) => this.sessionReaderAccess.withOutboxMutation(readerScope(sessionId, scope), plan),
      { persistenceContext },
    );
  }

  async withSessionReader(userId, sessionId, run, { persistenceContext } = {}) {
    return this.withSessionMutation(
      userId,
      sessionId,
      (scope) =>
        this.sessionReaderAccess.withMutation(
          readerScope(sessionId, scope),
          (reader, commitChanges, readCurrent) =>
            run({ reader, scope, commitChanges, readCurrent }),
        ),
      { persistenceContext },
    );
  }
}

export const sessionReaderMethods = SessionReaderMethods.prototype;
