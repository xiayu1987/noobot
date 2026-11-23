/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { buildSessionSummary } from "../../session-summary-builders.js";
import {
  SESSIONS_SUMMARY_SCHEMA_VERSION,
  createUnavailableSessionSummary,
  requireSessionsSummaryPayload,
} from "@noobot/session-protocol/sessions-summary";

class SessionSummaryMethods {
  _basePath(userId) {
    return this.pathResolver.resolveBasePath(userId);
  }

  _sessionTombstoneFile(userId) {
    return this.pathResolver.sessionTombstoneFile(this._basePath(userId));
  }

  async readSessionsSummary(userId) {
    const summaries = [];
    for (const node of await this.listLiveSessionTreeNodes(userId)) {
      summaries.push(await this._projectSessionSummaryFromSource(userId, node));
    }
    return requireSessionsSummaryPayload({
      schemaVersion: SESSIONS_SUMMARY_SCHEMA_VERSION,
      sessions: summaries,
      updatedAt: this.now(),
    });
  }

  async _projectSessionSummaryFromSource(userId, node) {
    const { sessionId } = node;
    try {
      await using reader = await this.requireSessionReader(userId, sessionId, {
        persistenceContext: this.treePersistenceContext(userId, sessionId),
      });
      return await this._buildSessionSummaryFromReader(reader);
    } catch (error) {
      return this.buildUnavailableSessionSummary(node, error);
    }
  }

  async _buildSessionSummaryFromReader(reader) {
    const [metadata, listFacts, turnLifecycle] = await Promise.all([
      reader.readMetadata({ includeAutoTitle: true }),
      reader.readListProjection(),
      reader.readLifecycleHead(),
    ]);
    return buildSessionSummary({ ...metadata, turnLifecycle }, { listFacts });
  }

  buildUnavailableSessionSummary(node, error) {
    const { sessionId, parentSessionId, caller } = node;
    return createUnavailableSessionSummary({ sessionId, parentSessionId, caller, error });
  }
}

export const sessionSummaryMethods = SessionSummaryMethods.prototype;
