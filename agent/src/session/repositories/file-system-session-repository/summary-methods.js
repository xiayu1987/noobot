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
import { PERSISTED_JSON_READ_ERROR_CODE } from "../../../shared/storage/json-file-reader.js";
import { text } from "@noobot/shared/value";

class SessionSummaryMethods {
  _basePath(userId = "") {
    return this.pathResolver.resolveBasePath(userId);
  }

  _sessionRoot(userId = "") {
    return this.pathResolver.sessionRoot(this._basePath(userId));
  }

  _sessionTombstoneFile(userId = "") {
    return this.pathResolver.sessionTombstoneFile(this._basePath(userId));
  }

  _sessionsSummaryFile(userId = "") {
    return this.pathResolver.sessionsSummaryFile(this._basePath(userId));
  }

  _sortSummaries(sessions = []) {
    return [...sessions].sort(
      (leftSession, rightSession) =>
        new Date(rightSession.updatedAt || 0).getTime() -
        new Date(leftSession.updatedAt || 0).getTime(),
    );
  }

  _withSummaryDepth(session = {}, sessionTree = null) {
    const sessionId = text(session?.sessionId);
    if (!sessionId || !sessionTree?.nodes?.[sessionId])
      return buildSessionSummary(session, { depth: 0 });
    return buildSessionSummary(session, { depth: this._getSummaryDepth(sessionId, sessionTree) });
  }

  async readSessionsSummary(userId = "") {
    const normalizedUserId = text(userId);
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
    const normalizedUserId = text(userId);
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

  async markSessionSummaryUnavailable(
    userId = "",
    sessionId = "",
    parentSessionId = "",
    error = null,
  ) {
    const normalizedSessionId = text(sessionId);
    if (!normalizedSessionId) return null;
    const metadata = await this._readSessionSummaryMetadata(
      userId,
      normalizedSessionId,
      parentSessionId,
    );
    return this._withSessionSummaryMutation(userId, async () => {
      const current = await this.readSessionsSummary(userId);
      const existing = current.sessions.find((item) => item.sessionId === normalizedSessionId);
      const unavailable = buildUnavailableSessionSummary({
        sessionId: normalizedSessionId,
        parentSessionId,
        title: metadata.title || existing?.title,
        caller: metadata.caller || existing?.caller,
        createdAt: metadata.createdAt || existing?.createdAt,
        updatedAt: metadata.updatedAt || existing?.updatedAt,
        depth: existing?.depth,
        errorCode: error?.code || "SESSION_PROTOCOL_INVALID",
        reason: error?.message || "Session uses an unsupported protocol",
      });
      const next = current.sessions.filter((item) => item.sessionId !== normalizedSessionId);
      next.push(unavailable);
      await this.writeSessionsSummary(userId, next);
      return unavailable;
    });
  }

  async removeSessionSummaries(userId = "", sessionIds = []) {
    const ids = new Set(
      (Array.isArray(sessionIds) ? sessionIds : [sessionIds])
        .map((item) => text(item))
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

    const sessionIds = await this.listSessionIds(userId);
    const summaries = [];
    for (const sessionId of sessionIds) {
      const parentSessionId = text(tree?.nodes?.[sessionId]?.parentSessionId);
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
            errorCode: error?.code || "SESSION_PROTOCOL_INVALID",
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
      currentId = text(tree.nodes[currentId]?.parentSessionId);
    }
    return depth;
  }

  async _readSessionSummaryMetadata(userId = "", sessionId = "", parentSessionId = "") {
    try {
      const scope = await this.resolveSessionScope(userId, sessionId, parentSessionId);
      const manifest = await readJsonArtifactFile(scope.sessionFile, null);
      return {
        title: text(manifest?.customTitle),
        caller: String(manifest?.caller || "user").trim() || "user",
        createdAt: text(manifest?.createdAt),
        updatedAt: text(manifest?.updatedAt),
      };
    } catch (error) {
      if (error?.code !== PERSISTED_JSON_READ_ERROR_CODE.CORRUPTED) throw error;
      return { title: "", caller: "user", createdAt: "", updatedAt: "" };
    }
  }
}

export const sessionSummaryMethods = SessionSummaryMethods.prototype;
