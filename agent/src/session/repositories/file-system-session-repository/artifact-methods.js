/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { randomUUID } from "node:crypto";
import { requireTurnLookupKey } from "@noobot/session-protocol/turn-lookup-key";
import { fsRm } from "../../../shared/storage/fs-adapter.js";
import { applySessionSettings } from "@noobot/session-protocol";

class SessionArtifactMethods {
  async requireContextSource(userId, sessionId, { persistenceContext, scope, historyLimit }) {
    await using reader = await this.requireSessionReader(userId, sessionId, { persistenceContext });
    return await reader.readContextSource({ scope, historyLimit });
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

  async findTurnTerminalSource(
    userId,
    sessionId,
    { persistenceContext, turnScopeId, terminalLimit },
  ) {
    if (await this.isSessionDeleted(userId, sessionId)) return null;
    await using reader = await this.findImmutableSessionReader(userId, sessionId, {
      persistenceContext,
    });
    if (!reader) return null;
    if (turnScopeId) {
      const metadata = await reader.readMetadata();
      const timing = await reader.readTurnTiming(turnScopeId);
      return {
        sessionId,
        turn: await reader.readTurnState(turnScopeId),
        turnTimings: timing ? [timing] : [],
        aggregateVersion: metadata.aggregateVersion,
      };
    }
    return await reader.readLifecycleSource({ terminalLimit });
  }

  async updateSessionSettings(userId, sessionId, { settings, persistenceContext }) {
    return this.withSessionMutation(
      userId,
      sessionId,
      async () => {
        await using reader = await this.requireSessionReader(userId, sessionId, {
          persistenceContext,
        });
        const committedAt = this.now();
        const metadata = applySessionSettings(await reader.readMetadata(), settings, committedAt);
        await this.commitChanges(userId, sessionId, {
          persistenceContext,
          expectedGeneration: reader.generation,
          operationId: randomUUID(),
          changes: { sessionMetadata: settings },
          committedAt,
        });
        return metadata;
      },
      { persistenceContext },
    );
  }

  async readSessionDisplaySummary(userId, sessionId, { persistenceContext }) {
    await using reader = await this.requireSessionReader(userId, sessionId, {
      persistenceContext,
    });
    return {
      ...(await reader.readDisplayProjection()),
      generation: reader.generation,
    };
  }

  async readSessionTurn(userId, sessionId, { lookupKey, persistenceContext }) {
    const key = requireTurnLookupKey(lookupKey);
    await using reader = await this.requireSessionReader(userId, sessionId, { persistenceContext });
    return await reader.readTurn(key);
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
