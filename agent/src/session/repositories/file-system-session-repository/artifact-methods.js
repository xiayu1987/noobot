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
import {
  assertSessionScopeIdentity,
  createSessionArtifactNotFoundError,
  createSessionNotFoundError,
} from "@noobot/session-protocol";

class SessionArtifactMethods {
  async readSessionDisplaySummary(userId, sessionId, { persistenceContext }) {
    const result = await this.ensureSessionDisplaySummary(userId, sessionId, {
      persistenceContext,
    });
    return result.summary;
  }

  async ensureSessionDisplaySummary(userId, sessionId, { persistenceContext }) {
    const scope = await this.requireSessionScope(userId, sessionId, persistenceContext);
    return this._projectUnavailableOnFailure(userId, sessionId, scope, async () => {
      const cached = await this._readCurrentDisplaySummary(scope, sessionId);
      if (cached !== null) return { summary: cached, rebuilt: false };
      const session = await this.findById(userId, sessionId, { persistenceContext });
      if (!session) throw createSessionNotFoundError({ userId, sessionId });
      return this._rebuildSessionDisplaySummary(userId, sessionId, session, persistenceContext);
    });
  }

  async _readCurrentDisplaySummary(scope, sessionId) {
    const [manifest, summary] = await Promise.all([
      this._readSessionManifest(scope),
      readDisplaySummaryArtifact({
        storageService: this.storageService,
        sessionDir: scope.sessionDir,
        sessionId,
      }),
    ]);
    return isSessionDisplaySummaryCurrent(summary, manifest) ? summary : null;
  }

  async _rebuildSessionDisplaySummary(userId, sessionId, session, persistenceContext) {
    const outcome = await this._refreshSessionDisplaySummary(
      userId,
      sessionId,
      session,
      persistenceContext,
    );
    if (outcome.summary !== null) return outcome;
    const error = new Error("rebuilt Session display summary is not current");
    error.code = "SESSION_DISPLAY_SUMMARY_REBUILD_INVALID";
    throw error;
  }

  async _refreshSessionDisplaySummary(userId, sessionId, candidateSession, persistenceContext) {
    return this.withSessionMutation(
      userId,
      sessionId,
      async (scope) => {
        const current = await this._readCurrentDisplaySummary(scope, sessionId);
        if (current !== null) return { summary: current, rebuilt: false };
        const manifest = await this._readSessionManifest(scope);
        const session =
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
        return { summary: await this._readCurrentDisplaySummary(scope, sessionId), rebuilt: true };
      },
      { persistenceContext },
    );
  }

  async readSessionTurn(userId, sessionId, { lookupKey, persistenceContext }) {
    const scope = await this.locateSessionScope(userId, sessionId, persistenceContext);
    if (!scope) throw createSessionNotFoundError({ userId, sessionId });
    return readSessionTurn({
      storageService: this.storageService,
      sessionDir: scope.sessionDir,
      ...lookupKey,
    });
  }

  async _readSessionManifest(scope) {
    const manifest = await this.storageService.readOptionalJson(scope.sessionFile);
    if (manifest === null) throw createSessionArtifactNotFoundError("session manifest");
    return manifest;
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
    if (view === null) throw createSessionArtifactNotFoundError("session turn view manifest");
    return {
      session: this._normalizeReadSession(view.session, sessionId, scope),
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
