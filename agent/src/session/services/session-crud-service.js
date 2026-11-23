/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { normalizeSelectedConnectorIds } from "@noobot/connector-protocol";
import { resolveIndexedTurnTerminal } from "@noobot/authoritative-state/application";
import {
  SESSION_NOT_FOUND_REASON,
  createTurnTerminalResolution,
  requireTurnTerminalResolutionIdentity,
  requireAcceptedTurnRecord,
  requireSessionAggregateVersion,
} from "@noobot/session-protocol";
import { requireTurnLookupKey } from "@noobot/session-protocol/turn-lookup-key";
import {
  createAvailableSessionDetailEntry,
  createMissingSessionDetailDocument,
  createSessionDetailDocument,
} from "@noobot/session-protocol/session-detail";
import {
  collectSessionTreeBranches,
  requireSessionTreeNode,
} from "@noobot/workspace-protocol/session-tree";
import { projectSessionAttachmentState } from "./session-attachment-projection.js";
import { isFunction, text } from "@noobot/shared/value";

export class SessionCrudService {
  constructor({ sessionRepo, sessionTreeService, attachmentService, now } = {}) {
    if (!isFunction(now)) throw new TypeError("SessionCrudService requires now function");
    this.sessionRepo = sessionRepo;
    this.sessionTreeService = sessionTreeService;
    this.attachmentService = attachmentService;
    this.now = now;
  }

  async listSessionIds({ userId }) {
    return this.sessionRepo.listSessionIds(userId);
  }

  async createSession({ userId, sessionId, parentSessionId, caller, persistenceContext }) {
    await this.sessionRepo.ensureSession({
      userId,
      sessionId,
      parentSessionId,
      caller,
      persistenceContext,
    });
    return this.getSessionBundle({ userId, sessionId, persistenceContext });
  }

  async getSessionBundle({ userId, sessionId, persistenceContext }) {
    const session = await this.sessionRepo.findById(userId, sessionId, { persistenceContext });
    if (!session) return { exists: false, session: null };
    return { exists: true, session };
  }

  async getSessionRunContext({
    userId,
    sessionId,
    turnScopeId,
    dialogProcessId,
    persistenceContext,
  }) {
    const lookupKey = requireTurnLookupKey({ turnScopeId, dialogProcessId });
    const source = await this.sessionRepo.requireRunContextSource(userId, sessionId, {
      persistenceContext,
      lookupKey,
    });
    const { startedAt } = requireAcceptedTurnRecord(source.turnLifecycle, lookupKey);
    return {
      startedAt,
      modelAlias: text(source.modelAlias),
      parentSessionId: source.parentSessionId,
      sessionDir: source.sessionDir,
    };
  }

  async locateSessionScope({ userId, sessionId, persistenceContext }) {
    return this.sessionRepo.locateSessionScope(userId, sessionId, persistenceContext);
  }

  async readSessionAggregateVersion({ userId, sessionId }) {
    await using reader = await this.sessionRepo.requireSessionReader(userId, sessionId, {
      persistenceContext: this.sessionRepo.treePersistenceContext(userId, sessionId),
    });
    const { aggregateVersion } = await reader.readMetadata();
    return requireSessionAggregateVersion(aggregateVersion);
  }

  async getSessionDetailStart({ userId, request }) {
    return this.sessionRepo.readSessionDetailStart(userId, request, {
      persistenceContext: this.sessionRepo.treePersistenceContext(userId, request.sessionId),
    });
  }

  async getSessionDisplayPage({ userId, request }) {
    return this.sessionRepo.readSessionDisplayPage(userId, request, {
      persistenceContext: this.sessionRepo.treePersistenceContext(userId, request.sessionId),
    });
  }

  async releaseSessionDisplayPage({ userId, request }) {
    return this.sessionRepo.releaseSessionDisplayPage(userId, request);
  }

  async getSessionDisplayArtifactPage({ userId, request }) {
    return this.sessionRepo.readSessionDisplayArtifactPage(userId, request, {
      persistenceContext: this.sessionRepo.treePersistenceContext(userId, request.sessionId),
    });
  }

  async releaseSessionDisplayArtifactPage({ userId, request }) {
    return this.sessionRepo.releaseSessionDisplayArtifactPage(userId, request);
  }

  async getSessionThinkingDetail({
    userId,
    sessionId,
    turnScopeId,
    dialogProcessId,
    cursor,
    limit,
    maxBytes,
  }) {
    const lookupKey = requireTurnLookupKey({ turnScopeId, dialogProcessId });
    const persistenceContext = this.sessionRepo.treePersistenceContext(userId, sessionId);
    return this.sessionRepo.readSessionThinkingDetail(userId, sessionId, {
      lookupKey,
      cursor,
      limit,
      maxBytes,
      persistenceContext,
    });
  }

  async releaseSessionThinkingDetail({ userId, sessionId, turnScopeId, dialogProcessId, cursor }) {
    return this.sessionRepo.releaseSessionThinkingDetail(userId, sessionId, {
      lookupKey: requireTurnLookupKey({ turnScopeId, dialogProcessId }),
      cursor,
    });
  }

  async resolveTurnTerminalState({
    userId,
    sessionId,
    turnScopeId,
    commandId,
    persistenceContext,
  }) {
    const identity = requireTurnTerminalResolutionIdentity({ commandId, sessionId, turnScopeId });
    const source = await this.sessionRepo.findTurnTerminalSource(userId, sessionId, {
      persistenceContext,
      turnScopeId: identity.turnScopeId,
    });
    if (source === null) {
      return createTurnTerminalResolution({
        ...identity,
        reason: SESSION_NOT_FOUND_REASON,
        generatedAt: this.now(),
      });
    }
    return resolveIndexedTurnTerminal({
      turn: source.turn,
      turnTimings: source.turnTimings,
      aggregateVersion: requireSessionAggregateVersion(source.aggregateVersion),
      generatedAt: this.now(),
      ...identity,
    });
  }

  async getSessionDisplayData({ userId, sessionId }) {
    const sessionTree = await this.sessionTreeService.getSessionTree({ userId });
    if (!Object.hasOwn(sessionTree.nodes, sessionId)) {
      return createMissingSessionDetailDocument({ sessionId });
    }
    const branchSessionIds = collectSessionTreeBranches(sessionTree, [sessionId]);
    const sessions = [];
    for (const branchSessionId of branchSessionIds) {
      sessions.push(
        await this._readSessionDetailEntry(
          userId,
          requireSessionTreeNode(sessionTree, branchSessionId),
        ),
      );
    }
    return createSessionDetailDocument({ sessionId, sessions });
  }

  async _readSessionDetailEntry(userId, node) {
    let projected;
    try {
      const summary = await this.sessionRepo.readSessionDisplaySummary(userId, node.sessionId, {
        persistenceContext: this.sessionRepo.treePersistenceContext(userId, node.sessionId),
        includeThinkingTimeline: true,
      });
      projected = await projectSessionAttachmentState({
        attachmentService: this.attachmentService,
        userId,
        session: summary,
      });
    } catch (error) {
      return this.sessionRepo.buildUnavailableSessionSummary(node, error);
    }
    return createAvailableSessionDetailEntry(projected);
  }

  async getAllSessionSummaries({ userId }) {
    return this.sessionRepo.readSessionsSummary(userId);
  }

  async setSessionModelAlias({ userId, sessionId, modelAlias, persistenceContext }) {
    return this.sessionRepo.updateSessionSettings(userId, sessionId, {
      settings: { modelAlias: String(modelAlias || "") },
      persistenceContext,
    });
  }

  async renameSession({ userId, sessionId, title, persistenceContext }) {
    const normalizedTitle = text(title);
    if (!normalizedTitle) {
      const error = new Error("Session title is required");
      error.statusCode = 400;
      throw error;
    }
    return this.sessionRepo.updateSessionSettings(userId, sessionId, {
      settings: { customTitle: normalizedTitle },
      persistenceContext,
    });
  }

  async getRootSessionSelectedConnectorIds({ userId, sessionId }) {
    const rootSessionId = await this.sessionTreeService.getRootSessionId({ userId, sessionId });
    return this.sessionRepo.readSelectedConnectorIds(userId, rootSessionId, {
      persistenceContext: this.sessionRepo.treePersistenceContext(userId, rootSessionId),
    });
  }

  async setRootSessionSelectedConnectorIds({ userId, sessionId, selectedConnectorIds = [] }) {
    const rootSessionId = await this.sessionTreeService.getRootSessionId({ userId, sessionId });
    const session = await this.sessionRepo.updateSessionSettings(userId, rootSessionId, {
      persistenceContext: this.sessionRepo.treePersistenceContext(userId, rootSessionId),
      settings: { selectedConnectorIds: normalizeSelectedConnectorIds(selectedConnectorIds) },
    });
    return session.selectedConnectorIds;
  }

  async writeSessionMetadata({ userId, sessionId, metadata, persistenceContext }) {
    await this.sessionRepo.writeSessionMetadata(userId, sessionId, metadata, {
      persistenceContext,
    });
  }
}
