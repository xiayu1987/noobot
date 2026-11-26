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
  _openSessionReader(userId, sessionId, { locateScope, required }) {
    return this._withSessionLifecycleLock(userId, sessionId, async () => {
      if (await this.isSessionDeleted(userId, sessionId)) {
        if (required) throw createSessionDeletedError({ userId, sessionId });
        return null;
      }
      const scope = await locateScope();
      if (!scope) {
        if (required) throw createSessionNotFoundError({ userId, sessionId });
        return null;
      }
      return this.sessionReaderAccess.open(readerScope(sessionId, scope));
    });
  }

  async _openReaderWithPersistenceContext(userId, sessionId, { persistenceContext, required }) {
    await this.sessionTreeRepository.assertWorkspaceInitialized(userId);
    return this._openSessionReader(userId, sessionId, {
      locateScope: () => this.locateSessionScope(userId, sessionId, persistenceContext),
      required,
    });
  }

  findSessionReader(userId, sessionId, { persistenceContext } = {}) {
    return this._openReaderWithPersistenceContext(userId, sessionId, {
      persistenceContext,
      required: false,
    });
  }

  requireSessionReader(userId, sessionId, { persistenceContext } = {}) {
    return this._openReaderWithPersistenceContext(userId, sessionId, {
      persistenceContext,
      required: true,
    });
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
