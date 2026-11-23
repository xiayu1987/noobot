/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  buildAuthoritativeExecutionReadModel,
  queryAuthoritativeExecution,
  queryAuthoritativeExecutionChildren,
  queryAuthoritativeExecutionTree,
} from "@noobot/authoritative-state/application";
import {
  EXECUTION_QUERY_COMMAND,
  EXECUTION_QUERY_INCOMPLETE,
  EXECUTION_QUERY_MISSING_TARGET,
  isExecutionQueryTargetValid,
} from "@noobot/session-protocol/execution-lifecycle";
import { createSessionUnavailableReason } from "@noobot/session-protocol/sessions-summary";

export class ExecutionReadService {
  constructor({ sessionRepo, scopedSessionRoots, now }) {
    this.sessionRepo = sessionRepo;
    this.scopedSessionRoots = scopedSessionRoots;
    this.now = now;
  }

  async _query(userId, command, query, target) {
    if (!isExecutionQueryTargetValid(command, target))
      return { found: false, reason: EXECUTION_QUERY_MISSING_TARGET };
    const sources = [];
    const unreadableSessions = [];
    let scopes;
    try {
      scopes = await this.sessionRepo.listExecutionSessionScopes(userId, this.scopedSessionRoots);
    } catch (error) {
      return {
        found: false,
        reason: EXECUTION_QUERY_INCOMPLETE,
        scopeDiscoveryFailure: createSessionUnavailableReason(error),
      };
    }
    for (const { sessionId, persistenceContext } of scopes) {
      try {
        sources.push(await this._readSession(userId, sessionId, persistenceContext));
      } catch (error) {
        unreadableSessions.push({ sessionId, ...createSessionUnavailableReason(error) });
      }
    }
    if (unreadableSessions.length)
      return { found: false, reason: EXECUTION_QUERY_INCOMPLETE, unreadableSessions };
    return query(buildAuthoritativeExecutionReadModel(sources), {
      ...target,
      generatedAt: this.now(),
    });
  }

  async _readSession(userId, sessionId, persistenceContext) {
    await using reader = await this.sessionRepo.requireSessionReader(userId, sessionId, {
      persistenceContext,
    });
    return await reader.readExecutionSource();
  }

  async getExecution({ userId, executionId }) {
    return this._query(userId, EXECUTION_QUERY_COMMAND.SNAPSHOT_GET, queryAuthoritativeExecution, {
      executionId,
    });
  }

  async getExecutionChildren({ userId, executionId }) {
    return this._query(
      userId,
      EXECUTION_QUERY_COMMAND.CHILDREN_GET,
      queryAuthoritativeExecutionChildren,
      { executionId },
    );
  }

  async getExecutionTree({ userId, executionId, rootExecutionId }) {
    return this._query(userId, EXECUTION_QUERY_COMMAND.TREE_GET, queryAuthoritativeExecutionTree, {
      executionId,
      rootExecutionId,
    });
  }
}
