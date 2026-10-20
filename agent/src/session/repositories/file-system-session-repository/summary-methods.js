/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  buildSessionSummary,
  buildUnavailableSessionSummary,
  requireSessionsSummaryPayload,
  SESSIONS_SUMMARY_SCHEMA_VERSION,
} from "../../session-summary-builders.js";
import { readJsonArtifactFile } from "../../session-artifact-store.js";
import { buildSessionListFacts } from "../../session-artifact-session/session-list-facts.js";
import { PERSISTED_JSON_READ_ERROR_CODE } from "../../../shared/storage/json-file-reader.js";
import { requireSessionTreeNode } from "@noobot/workspace-protocol/session-tree";

const UNAVAILABLE_METADATA_FIELDS = Object.freeze({
  title: "customTitle",
  createdAt: "createdAt",
  updatedAt: "updatedAt",
});

function projectUnavailableMetadata(manifest) {
  const metadata = {};
  for (const [field, key] of Object.entries(UNAVAILABLE_METADATA_FIELDS)) {
    const value = manifest === null ? undefined : manifest[key];
    metadata[field] = typeof value === "string" ? value : "";
  }
  return metadata;
}

function requireUnavailableError(error) {
  if (typeof error?.code === "string" && error.code && typeof error.message === "string") {
    return error;
  }
  throw error;
}

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
    const payload = await this.storageService.readJson(this._sessionsSummaryFile(userId), null);
    if (payload === null) {
      return {
        schemaVersion: SESSIONS_SUMMARY_SCHEMA_VERSION,
        sessions: [],
        updatedAt: this.now(),
      };
    }
    if (payload.schemaVersion !== SESSIONS_SUMMARY_SCHEMA_VERSION) {
      const error = new Error(
        `sessions summary schema ${payload.schemaVersion} is not ${SESSIONS_SUMMARY_SCHEMA_VERSION}; rebuild required`,
      );
      error.code = "SESSIONS_SUMMARY_SCHEMA_UNSUPPORTED";
      throw error;
    }
    return requireSessionsSummaryPayload(payload);
  }

  async ensureSessionsSummarySchema(userId) {
    try {
      await this.readSessionsSummary(userId);
    } catch (error) {
      if (error.code !== "SESSIONS_SUMMARY_SCHEMA_UNSUPPORTED") throw error;
      await this.rebuildSessionsSummary(userId);
    }
  }

  async writeSessionsSummary(userId, sessions) {
    const payload = {
      schemaVersion: SESSIONS_SUMMARY_SCHEMA_VERSION,
      sessions,
      updatedAt: this.now(),
    };
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
    const unavailable = await this.buildUnavailableSessionSummary(
      userId,
      requireSessionTreeNode(sessionTree, sessionId),
      error,
    );
    return this._replaceSessionSummary(userId, unavailable);
  }

  async _replaceSessionSummary(userId, summary) {
    return this._withSessionSummaryMutation(userId, async () => {
      const current = await this.readSessionsSummary(userId);
      const next = current.sessions.filter((item) => item.sessionId !== summary.sessionId);
      next.push(summary);
      await this.writeSessionsSummary(userId, next);
      return summary;
    });
  }

  async removeSessionSummaries(userId, sessionIds) {
    const ids = new Set(sessionIds);
    return this._withSessionSummaryMutation(userId, async () => {
      const current = await this.readSessionsSummary(userId);
      const next = current.sessions.filter((item) => !ids.has(item.sessionId));
      if (next.length === current.sessions.length) return 0;
      await this.writeSessionsSummary(userId, next);
      return current.sessions.length - next.length;
    });
  }

  async rebuildSessionsSummary(userId) {
    const sessionTree = await this.sessionTreeRepository.getTree(userId);
    const sessionIds = await this.listSessionIds(userId);
    const summaries = [];
    for (const sessionId of sessionIds) {
      const node = requireSessionTreeNode(sessionTree, sessionId);
      try {
        const session = await this.findById(userId, sessionId, {
          persistenceContext: this.treePersistenceContext(userId, sessionId),
        });
        if (!session) {
          const error = new Error("Canonical session artifact is missing");
          error.code = "SESSION_ARTIFACT_MISSING";
          throw error;
        }
        summaries.push(buildSessionSummary(session, { listFacts: buildSessionListFacts(session) }));
      } catch (error) {
        summaries.push(await this.buildUnavailableSessionSummary(userId, node, error));
      }
    }
    return this.writeSessionsSummary(userId, summaries);
  }

  async buildUnavailableSessionSummary(userId, node, error) {
    const { sessionId, parentSessionId, caller } = node;
    return buildUnavailableSessionSummary({
      sessionId,
      parentSessionId,
      caller,
      metadata: await this._readSessionSummaryMetadata(userId, sessionId),
      error: requireUnavailableError(error),
    });
  }

  async _readSessionSummaryMetadata(userId, sessionId) {
    const scope = await this.requireSessionScope(
      userId,
      sessionId,
      this.treePersistenceContext(userId, sessionId),
    );
    try {
      return projectUnavailableMetadata(await readJsonArtifactFile(scope.sessionFile, null));
    } catch (error) {
      if (error.code !== PERSISTED_JSON_READ_ERROR_CODE.CORRUPTED) throw error;
      return projectUnavailableMetadata(null);
    }
  }
}

export const sessionSummaryMethods = SessionSummaryMethods.prototype;
