/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { randomUUID } from "node:crypto";
import { requireTurnLookupKey } from "@noobot/session-protocol/turn-lookup-key";
import { fsRm } from "../../../shared/storage/fs-adapter.js";
import { applySessionSettings } from "@noobot/session-protocol";
import {
  requireThinkingDetailPageSelection,
  requireThinkingDetailReleaseSelection,
  treeSessionPageScope,
} from "@noobot/session-protocol/message-read-budget";
import {
  readSessionThinkingDetail,
  releaseSessionThinkingDetail,
} from "../../session-thinking-detail.js";
import {
  readRetainedDisplayArtifactPage,
  readRetainedSessionDetailStart,
  readRetainedSessionDisplayPage,
  releaseRetainedDisplayArtifactPage,
  releaseRetainedSessionDisplayPage,
} from "../../session-display-page.js";

class SessionArtifactMethods {
  async requireContextSource(
    userId,
    sessionId,
    { persistenceContext, scope, historyLimit, limits },
  ) {
    await using reader = await this.requireSessionReader(userId, sessionId, { persistenceContext });
    return await reader.readContextSource({ scope, historyLimit, limits });
  }

  async requireRunContextSource(userId, sessionId, { persistenceContext, lookupKey }) {
    await using reader = await this.requireSessionReader(userId, sessionId, { persistenceContext });
    const metadata = await reader.readMetadata();
    const turn = await reader.readTurnState(lookupKey.turnScopeId);
    const placement = await this.requireSessionScope(userId, sessionId, persistenceContext);
    return {
      turnLifecycle: {
        ...(await reader.readLifecycleHead()),
        turns: turn ? { [lookupKey.turnScopeId]: turn } : {},
      },
      modelAlias: metadata.modelAlias,
      parentSessionId: metadata.parentSessionId,
      sessionDir: placement.sessionDir,
    };
  }

  async findTurnTerminalSource(userId, sessionId, { persistenceContext, turnScopeId }) {
    await using reader = await this.findSessionReader(userId, sessionId, {
      persistenceContext,
    });
    if (reader === null) return null;
    const { aggregateVersion } = await reader.readMetadata();
    const turn = await reader.readTurnState(turnScopeId);
    const timing = await reader.readTurnTiming(turnScopeId);
    return { turn, turnTimings: timing === null ? [] : [timing], aggregateVersion };
  }

  async findTurnLifecycleSource(userId, sessionId, { persistenceContext, terminalLimit }) {
    await using reader = await this.findSessionReader(userId, sessionId, { persistenceContext });
    if (reader === null) return null;
    return await reader.readLifecycleSource({ terminalLimit });
  }

  async updateSessionSettings(userId, sessionId, { settings, persistenceContext }) {
    return this.withSessionReader(
      userId,
      sessionId,
      async ({ reader, commitChanges }) => {
        const committedAt = this.now();
        const metadata = applySessionSettings(await reader.readMetadata(), settings, committedAt);
        await commitChanges(
          await reader.prepareRequest({
            operationId: randomUUID(),
            changes: { sessionMetadata: settings },
            committedAt,
          }),
        );
        return metadata;
      },
      { persistenceContext },
    );
  }

  async readSessionDisplaySummary(
    userId,
    sessionId,
    { persistenceContext, includeThinkingTimeline },
  ) {
    await using reader = await this.requireSessionReader(userId, sessionId, {
      persistenceContext,
    });
    return {
      ...(await reader.readDisplayProjection({ includeThinkingTimeline })),
      generation: reader.generation,
    };
  }

  _sessionPageAccess(userId, sessionId, persistenceContext) {
    return {
      pageSnapshots: this.pageSnapshots.withReadAuthority(() =>
        this.assertSessionWritable(userId, sessionId),
      ),
      identity: treeSessionPageScope(userId, sessionId),
      open: () => this.requireSessionReader(userId, sessionId, { persistenceContext }),
    };
  }

  async readSessionDetailStart(userId, request, { persistenceContext }) {
    return readRetainedSessionDetailStart({
      ...this._sessionPageAccess(userId, request.sessionId, persistenceContext),
      request,
    });
  }

  async readSessionDisplayPage(userId, request, { persistenceContext }) {
    return readRetainedSessionDisplayPage({
      ...this._sessionPageAccess(userId, request.sessionId, persistenceContext),
      request,
    });
  }

  async releaseSessionDisplayPage(userId, request) {
    return releaseRetainedSessionDisplayPage({
      pageSnapshots: this.pageSnapshots,
      identity: treeSessionPageScope(userId, request.sessionId),
      request,
    });
  }

  async readSessionDisplayArtifactPage(userId, request, { persistenceContext }) {
    return readRetainedDisplayArtifactPage({
      ...this._sessionPageAccess(userId, request.sessionId, persistenceContext),
      request,
    });
  }

  async releaseSessionDisplayArtifactPage(userId, request) {
    return releaseRetainedDisplayArtifactPage({
      pageSnapshots: this.pageSnapshots,
      identity: treeSessionPageScope(userId, request.sessionId),
      request,
    });
  }

  async readSessionThinkingDetail(
    userId,
    sessionId,
    { lookupKey, cursor, limit, maxBytes, persistenceContext },
  ) {
    const key = requireTurnLookupKey(lookupKey);
    requireThinkingDetailPageSelection({ sessionId, ...key, cursor, limit });
    return readSessionThinkingDetail({
      ...this._sessionPageAccess(userId, sessionId, persistenceContext),
      sessionId,
      lookupKey: key,
      cursor,
      limit,
      maxBytes,
    });
  }

  async releaseSessionThinkingDetail(userId, sessionId, { lookupKey, cursor }) {
    const key = requireTurnLookupKey(lookupKey);
    requireThinkingDetailReleaseSelection({ sessionId, ...key, cursor });
    return releaseSessionThinkingDetail({
      pageSnapshots: this.pageSnapshots,
      identity: treeSessionPageScope(userId, sessionId),
      sessionId,
      lookupKey: key,
      cursor,
    });
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
