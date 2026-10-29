/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { buildSessionSummary } from "../../session-summary-builders.js";
import { buildSessionListFacts } from "../../session-artifact-session/session-list-facts.js";
import { requireSessionTreeNode } from "@noobot/workspace-protocol/session-tree";
import {
  SESSIONS_SUMMARY_SCHEMA_VERSION,
  createSessionsSummaryProjectionError,
  createUnavailableSessionSummary,
  isSessionsSummaryMembershipCurrent,
  isSessionsSummarySchemaCurrent,
  requireSessionsSummaryPayload,
} from "@noobot/session-protocol/sessions-summary";

class SessionSummaryMethods {
  _basePath(userId) {
    return this.pathResolver.resolveBasePath(userId);
  }

  _sessionTombstoneFile(userId) {
    return this.pathResolver.sessionTombstoneFile(this._basePath(userId));
  }

  _sessionsSummaryFile(userId) {
    return this.pathResolver.sessionsSummaryFile(this._basePath(userId));
  }

  async readSessionsSummary(userId) {
    return this._withSessionsSummary(userId, async (current) => {
      const sessionIds = await this.listSessionIds(userId);
      if (isSessionsSummaryMembershipCurrent(current, sessionIds)) return current;
      return this._rebuildSessionsSummaryUnlocked(userId);
    });
  }

  async rebuildSessionsSummary(userId) {
    return this._withSessionSummaryMutation(userId, () =>
      this._rebuildSessionsSummaryUnlocked(userId),
    );
  }

  async writeSessionsSummary(userId, sessions) {
    const payload = requireSessionsSummaryPayload({
      schemaVersion: SESSIONS_SUMMARY_SCHEMA_VERSION,
      sessions,
      updatedAt: this.now(),
    });
    await this.storageService.writeJsonAtomic(this._sessionsSummaryFile(userId), payload);
    return payload;
  }

  async upsertSessionSummary(userId, session, { listFacts, scope }) {
    if (!scope.indexed) return null;
    const summary = buildSessionSummary(session, { listFacts });
    return this._replaceSessionSummary(userId, summary);
  }

  async markSessionSummaryUnavailable(userId, sessionId, { error, scope }) {
    if (!scope.indexed) return null;
    const sessionTree = await this.sessionTreeRepository.getTree(userId);
    const unavailable = this.buildUnavailableSessionSummary(
      requireSessionTreeNode(sessionTree, sessionId),
      error,
    );
    return this._replaceSessionSummary(userId, unavailable);
  }

  async _projectUnavailableOnFailure(userId, sessionId, scope, read) {
    try {
      return await read();
    } catch (error) {
      try {
        await this.markSessionSummaryUnavailable(userId, sessionId, { error, scope });
      } catch (projectionError) {
        throw createSessionsSummaryProjectionError({ sessionId, cause: error, projectionError });
      }
      throw error;
    }
  }

  async _replaceSessionSummary(userId, summary) {
    return this._withSessionsSummary(userId, async (current) => {
      const next = current.sessions.filter((item) => item.sessionId !== summary.sessionId);
      next.push(summary);
      await this.writeSessionsSummary(userId, next);
      return summary;
    });
  }

  async removeSessionSummaries(userId, sessionIds) {
    const ids = new Set(sessionIds);
    return this._withSessionsSummary(userId, async (current) => {
      const next = current.sessions.filter((item) => !ids.has(item.sessionId));
      if (next.length === current.sessions.length) return 0;
      await this.writeSessionsSummary(userId, next);
      return current.sessions.length - next.length;
    });
  }

  async _withSessionsSummary(userId, apply) {
    return this._withSessionSummaryMutation(userId, async () =>
      apply(await this._readCurrentSessionsSummary(userId)),
    );
  }

  async _readCurrentSessionsSummary(userId) {
    const stored = await this.storageService.readOptionalJson(this._sessionsSummaryFile(userId));
    if (stored !== null && isSessionsSummarySchemaCurrent(stored)) {
      return requireSessionsSummaryPayload(stored);
    }
    return this._rebuildSessionsSummaryUnlocked(userId);
  }

  async _rebuildSessionsSummaryUnlocked(userId) {
    const sessionTree = await this.sessionTreeRepository.getTree(userId);
    const sessionIds = await this.listSessionIds(userId);
    const summaries = [];
    for (const sessionId of sessionIds) {
      summaries.push(
        await this._projectSessionSummaryFromSource(
          userId,
          requireSessionTreeNode(sessionTree, sessionId),
        ),
      );
    }
    return this.writeSessionsSummary(userId, summaries);
  }

  async _projectSessionSummaryFromSource(userId, node) {
    const { sessionId } = node;
    try {
      const scope = await this.requireSessionScope(
        userId,
        sessionId,
        this.treePersistenceContext(userId, sessionId),
      );
      const session = await this._readNormalizedSession(scope, sessionId);
      return buildSessionSummary(session, { listFacts: buildSessionListFacts(session) });
    } catch (error) {
      return this.buildUnavailableSessionSummary(node, error);
    }
  }

  buildUnavailableSessionSummary(node, error) {
    const { sessionId, parentSessionId, caller } = node;
    return createUnavailableSessionSummary({ sessionId, parentSessionId, caller, error });
  }
}

export const sessionSummaryMethods = SessionSummaryMethods.prototype;
