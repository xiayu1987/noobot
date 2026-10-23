/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { fsRm } from "../../../shared/storage/fs-adapter.js";
import { normalizeStoredSession } from "../../session-read-validation.js";
import { isSessionDisplaySummaryCurrent } from "../../session-summary-builders.js";
import { createSessionDisplaySourceRevision } from "../../session-display-source-revision.js";
import {
  readSessionArtifact,
  readSessionDisplaySummaryArtifact as readDisplaySummaryArtifact,
  readSessionTurn,
  readSessionTurnView,
  rebuildSessionDisplaySummaryArtifact,
} from "../../session-artifact-store.js";
import { buildSessionListFacts } from "../../session-artifact-session/session-list-facts.js";
import { assertSessionScopeIdentity } from "@noobot/session-protocol";
import { text } from "@noobot/shared/value";

class SessionArtifactMethods {
  async readSessionDisplaySummary(userId, sessionId, { persistenceContext } = {}) {
    const result = await this.ensureSessionDisplaySummary(userId, sessionId, {
      persistenceContext,
    });
    return result.summary;
  }

  async ensureSessionDisplaySummary(userId, sessionId, { persistenceContext } = {}) {
    const normalizedSessionId = text(sessionId);
    if (!normalizedSessionId) return { summary: null, rebuilt: false };
    const scope = await this.locateSessionScope(userId, normalizedSessionId, persistenceContext);
    if (!scope) return { summary: null, rebuilt: false };
    try {
      const [manifest, summary] = await Promise.all([
        this.storageService.readJson(scope.sessionFile, null),
        readDisplaySummaryArtifact({
          storageService: this.storageService,
          sessionDir: scope.sessionDir,
          sessionId: normalizedSessionId,
        }),
      ]);
      if (isSessionDisplaySummaryCurrent(summary, manifest)) {
        return { summary, rebuilt: false };
      }
      const session = await this.findById(userId, normalizedSessionId, { persistenceContext });
      if (!session) return { summary: null, rebuilt: false };
      let rebuilt = await readDisplaySummaryArtifact({
        storageService: this.storageService,
        sessionDir: scope.sessionDir,
        sessionId: normalizedSessionId,
      });
      let currentManifest = await this.storageService.readJson(scope.sessionFile, null);
      if (isSessionDisplaySummaryCurrent(rebuilt, currentManifest)) {
        await this.upsertSessionSummary(userId, session, {
          listFacts: buildSessionListFacts(session),
          scope,
        });
        return { summary: rebuilt, rebuilt: true };
      }
      await this._refreshSessionDisplaySummary(
        userId,
        normalizedSessionId,
        session,
        persistenceContext,
      );
      rebuilt = await readDisplaySummaryArtifact({
        storageService: this.storageService,
        sessionDir: scope.sessionDir,
        sessionId: normalizedSessionId,
      });
      currentManifest = await this.storageService.readJson(scope.sessionFile, null);
      if (isSessionDisplaySummaryCurrent(rebuilt, currentManifest)) {
        return { summary: rebuilt, rebuilt: true };
      }
      const error = new Error("rebuilt Session display summary is not current");
      error.code = "SESSION_DISPLAY_SUMMARY_REBUILD_INVALID";
      throw error;
    } catch (error) {
      try {
        await this.markSessionSummaryUnavailable(userId, normalizedSessionId, { error, scope });
      } catch (projectionError) {
        error.unavailableProjectionCause = projectionError;
      }
      throw error;
    }
  }

  async _refreshSessionDisplaySummary(userId, sessionId, candidateSession, persistenceContext) {
    return this.withSessionMutation(
      userId,
      sessionId,
      async (scope) => {
        const manifest = await this.storageService.readJson(scope.sessionFile, null);
        const session =
          manifest &&
          createSessionDisplaySourceRevision(candidateSession) ===
            createSessionDisplaySourceRevision(manifest)
            ? candidateSession
            : await this._readNormalizedSession(scope, sessionId);
        await rebuildSessionDisplaySummaryArtifact({
          storageService: this.storageService,
          sessionDir: scope.sessionDir,
          sessionPayload: session,
        });
        await this.upsertSessionSummary(userId, session, {
          listFacts: buildSessionListFacts(session),
          scope,
        });
        return session;
      },
      { persistenceContext },
    );
  }

  async readSessionTurn(
    userId,
    sessionId,
    { turnScopeId = "", dialogProcessId = "", persistenceContext } = {},
  ) {
    const normalizedSessionId = text(sessionId);
    if (!normalizedSessionId) return null;
    const scope = await this.locateSessionScope(userId, normalizedSessionId, persistenceContext);
    if (!scope) return null;
    return readSessionTurn({ sessionDir: scope.sessionDir, turnScopeId, dialogProcessId });
  }

  async _readNormalizedSession(scope, sessionId) {
    const session = await readSessionArtifact({
      storageService: this.storageService,
      sessionDir: scope.sessionDir,
    });
    return this._normalizeReadSession(session, sessionId, scope);
  }

  async _readNormalizedTurnView(scope, sessionId, turnScopeIds) {
    const view = await readSessionTurnView({
      storageService: this.storageService,
      sessionDir: scope.sessionDir,
      turnScopeIds,
    });
    return {
      session: this._normalizeReadSession(view?.session, sessionId, scope),
      turnScopeIds: view.turnScopeIds,
    };
  }

  _normalizeReadSession(session, sessionId, scope) {
    const normalized = normalizeStoredSession(session, { now: this.now });
    assertSessionScopeIdentity({
      session: normalized,
      sessionId,
      parentSessionId: scope.resolvedParentSessionId,
    });
    return normalized;
  }

  async removeSessionDisplaySummaries(userId, sessionIds) {
    let removed = 0;
    for (const sessionId of sessionIds) {
      const scope = await this.locateSessionScope(
        userId,
        sessionId,
        this.treePersistenceContext(userId, sessionId),
      );
      if (!scope) continue;
      await fsRm(scope.sessionSummaryFile, { force: true });
      removed += 1;
    }
    return removed;
  }
}

export const sessionArtifactMethods = SessionArtifactMethods.prototype;
