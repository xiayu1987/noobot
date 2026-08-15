/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  buildSessionSummary,
  buildUnavailableSessionSummary,
  normalizeSessionsSummaryPayload,
  SESSIONS_SUMMARY_SCHEMA_VERSION,
} from "../../session-summary-builders.js";
import { readJsonArtifactFile } from "../../session-artifact-store.js";

class SessionSummaryMethods {
  _basePath(userId = "") {
    return this.pathResolver.resolveBasePath(userId);
  }

  _sessionRoot(userId = "") {
    return this.pathResolver.sessionRoot(this._basePath(userId));
  }

  _deletedSessionMarkerFile(userId = "") {
    if (typeof this.pathResolver?.deletedSessionMarkerFile === "function") {
      return this.pathResolver.deletedSessionMarkerFile(this._basePath(userId));
    }
    return `${this._sessionRoot(userId)}/.deleted-sessions.json`;
  }

  _sessionsSummaryFile(userId = "") {
    if (typeof this.pathResolver?.sessionsSummaryFile === "function") {
      return this.pathResolver.sessionsSummaryFile(this._basePath(userId));
    }
    return `${this._sessionRoot(userId)}/sessions.json`;
  }

  _sortSummaries(sessions = []) {
    return [...sessions].sort(
      (leftSession, rightSession) =>
        new Date(rightSession.updatedAt || 0).getTime() -
        new Date(leftSession.updatedAt || 0).getTime(),
    );
  }

  _withSummaryDepth(session = {}, sessionTree = null) {
    const sessionId = String(session?.sessionId || "").trim();
    if (!sessionId || !sessionTree?.nodes?.[sessionId])
      return buildSessionSummary(session, { depth: 0 });
    return buildSessionSummary(session, { depth: this._getSummaryDepth(sessionId, sessionTree) });
  }

  async readSessionsSummary(userId = "") {
    const normalizedUserId = String(userId || "").trim();
    if (!normalizedUserId) return { sessions: [], updatedAt: this.now() };
    const payload = await this.storageService.readJson(
      this._sessionsSummaryFile(normalizedUserId),
      { sessions: [], updatedAt: this.now() },
    );
    if (Number(payload?.schemaVersion || 0) !== SESSIONS_SUMMARY_SCHEMA_VERSION) {
      return this.rebuildSessionsSummary(normalizedUserId);
    }
    return normalizeSessionsSummaryPayload(payload, this.now);
  }

  async writeSessionsSummary(userId = "", sessions = []) {
    const normalizedUserId = String(userId || "").trim();
    if (!normalizedUserId) return { sessions: [], updatedAt: this.now() };
    await this.storageService.ensureRuntimeDirsByBasePath(this._basePath(normalizedUserId));
    const payload = normalizeSessionsSummaryPayload(
      { sessions: this._sortSummaries(sessions), updatedAt: this.now() },
      this.now,
    );
    await this.storageService.writeJsonAtomic(this._sessionsSummaryFile(normalizedUserId), payload);
    return payload;
  }

  async upsertSessionSummary(userId = "", session = {}, { sessionTree = null } = {}) {
    const summary = this._withSummaryDepth(session, sessionTree);
    if (!summary.sessionId) return null;
    return this._withSessionSummaryMutation(userId, async () => {
      const current = await this.readSessionsSummary(userId);
      const nextMap = new Map(current.sessions.map((item) => [item.sessionId, item]));
      nextMap.set(summary.sessionId, summary);
      await this.writeSessionsSummary(userId, Array.from(nextMap.values()));
      return summary;
    });
  }

  async removeSessionSummaries(userId = "", sessionIds = []) {
    const ids = new Set(
      (Array.isArray(sessionIds) ? sessionIds : [sessionIds])
        .map((item) => String(item || "").trim())
        .filter(Boolean),
    );
    if (!ids.size) return 0;
    return this._withSessionSummaryMutation(userId, async () => {
      const current = await this.readSessionsSummary(userId);
      const next = current.sessions.filter((item) => !ids.has(item.sessionId));
      if (next.length === current.sessions.length) return 0;
      await this.writeSessionsSummary(userId, next);
      return current.sessions.length - next.length;
    });
  }

  async rebuildSessionsSummary(userId = "", { sessionTree = null } = {}) {
    const tree = sessionTree || null;
    // Only materialized Session directories belong in the list. The tree may
    // contain historical nodes whose artifacts were deleted or never created.
    const sessionIds = await this.listSessionIds(userId);
    const summaries = [];
    for (const sessionId of sessionIds) {
      const parentSessionId = String(tree?.nodes?.[sessionId]?.parentSessionId || "").trim();
      try {
        const session = await this.findById(userId, sessionId, parentSessionId);
        if (!session) {
          const error = new Error("Canonical session artifact is missing");
          error.code = "SESSION_ARTIFACT_MISSING";
          throw error;
        }
        summaries.push(this._withSummaryDepth(session, tree));
      } catch (error) {
        const metadata = await this._readSessionSummaryMetadata(userId, sessionId, parentSessionId);
        summaries.push(
          buildUnavailableSessionSummary({
            sessionId,
            parentSessionId,
            title: metadata.title,
            caller: metadata.caller,
            createdAt: metadata.createdAt,
            updatedAt: metadata.updatedAt,
            depth: this._getSummaryDepth(sessionId, tree),
            errorCode: error?.code || error?.errorCode || "SESSION_PROTOCOL_INVALID",
            reason: error?.message || "Session uses an unsupported protocol",
          }),
        );
      }
    }
    return this.writeSessionsSummary(userId, summaries);
  }

  _getSummaryDepth(sessionId = "", tree = null) {
    const node = tree?.nodes?.[sessionId];
    if (!node) return 0;
    let depth = 0;
    const visited = new Set();
    let currentId = sessionId;
    while (currentId && !visited.has(currentId) && tree?.nodes?.[currentId]) {
      visited.add(currentId);
      depth += 1;
      currentId = String(tree.nodes[currentId]?.parentSessionId || "").trim();
    }
    return depth;
  }

  async _readSessionSummaryMetadata(userId = "", sessionId = "", parentSessionId = "") {
    try {
      const scope = await this.resolveSessionScope(userId, sessionId, parentSessionId);
      const manifest = await readJsonArtifactFile(scope.sessionFile, null);
      return {
        title: String(manifest?.customTitle || "").trim(),
        caller: String(manifest?.caller || "user").trim() || "user",
        createdAt: String(manifest?.createdAt || "").trim(),
        updatedAt: String(manifest?.updatedAt || "").trim(),
      };
    } catch {
      return { title: "", caller: "user", createdAt: "", updatedAt: "" };
    }
  }
}

export const sessionSummaryMethods = SessionSummaryMethods.prototype;
