/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { normalizeSelectedConnectorIds } from "@noobot/connector-protocol";
import {
  resolveAuthoritativeTurnTerminal,
  resolveIndexedTurnTerminal,
} from "@noobot/authoritative-state/application";
import {
  SESSION_NOT_FOUND_REASON,
  createSessionArtifactNotFoundError,
  createSessionUnavailableReason,
  createTurnTerminalResolution,
  requireTurnTerminalResolutionIdentity,
  requireAcceptedTurnRecord,
} from "@noobot/session-protocol";
import { requireTurnLookupKey } from "@noobot/session-protocol/turn-lookup-key";
import {
  createAvailableSessionDetailEntry,
  createMissingSessionDetailDocument,
  createSessionDetailDocument,
} from "@noobot/session-protocol/session-detail";
import { buildThinkingDetailPayload } from "../session-thinking-detail.js";
import { requireSessionTreeNode } from "@noobot/workspace-protocol/session-tree";
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

  async getSessionThinkingDetail({ userId, sessionId, turnScopeId, dialogProcessId }) {
    const lookupKey = requireTurnLookupKey({ turnScopeId, dialogProcessId });
    const persistenceContext = this.sessionRepo.treePersistenceContext(userId, sessionId);
    const turn = await this.sessionRepo.readSessionTurn(userId, sessionId, {
      lookupKey,
      persistenceContext,
    });
    return buildThinkingDetailPayload(turn);
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
    if (!source) {
      return createTurnTerminalResolution({
        ...identity,
        reason: SESSION_NOT_FOUND_REASON,
        generatedAt: this.now(),
      });
    }
    if (Object.hasOwn(source, "turn"))
      return resolveIndexedTurnTerminal({
        turn: source.turn,
        turnTimings: source.turnTimings,
        aggregateVersion: source.aggregateVersion,
        generatedAt: this.now(),
        ...identity,
      });
    return resolveAuthoritativeTurnTerminal({
      lifecycle: source.turnLifecycle,
      turnTimings: source.turnTimings,
      aggregateVersion: source.aggregateVersion,
      generatedAt: this.now(),
      ...identity,
    });
  }

  async getSessionDisplayData({ userId, sessionId }) {
    const sessionTree = await this.sessionTreeService.getSessionTree({ userId });
    if (!Object.hasOwn(sessionTree.nodes, sessionId)) {
      return createMissingSessionDetailDocument({ sessionId });
    }
    const branchSessionIds = this.sessionTreeService.collectBranchSessionIds(
      sessionId,
      sessionTree,
    );
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
    let summary;
    try {
      summary = await this.sessionRepo.readSessionDisplaySummary(userId, node.sessionId, {
        persistenceContext: this.sessionRepo.treePersistenceContext(userId, node.sessionId),
      });
    } catch (error) {
      return this.sessionRepo.buildUnavailableSessionSummary(node, error);
    }
    return createAvailableSessionDetailEntry(
      await projectSessionAttachmentState({
        attachmentService: this.attachmentService,
        userId,
        session: summary,
      }),
    );
  }

  async getAllSessionsData({ userId, failures }) {
    const sessionTree = await this.sessionTreeService.getSessionTree({ userId });
    const sessionIds = await this.listSessionIds({ userId });
    const reads = await Promise.all(
      sessionIds.map(async (sessionId) => {
        requireSessionTreeNode(sessionTree, sessionId);
        try {
          const bundle = await this.getSessionBundle({
            userId,
            sessionId,
            persistenceContext: this.sessionRepo.treePersistenceContext(userId, sessionId),
          });
          if (!bundle.exists) throw createSessionArtifactNotFoundError("session manifest");
          return { session: bundle.session };
        } catch (error) {
          return { failure: { sessionId, ...createSessionUnavailableReason(error) } };
        }
      }),
    );
    const sessionList = [];
    for (const read of reads) {
      if (read.failure) failures.push(read.failure);
      else sessionList.push(read.session);
    }
    sessionList.sort((leftSession, rightSession) =>
      rightSession.updatedAt.localeCompare(leftSession.updatedAt),
    );
    return sessionList;
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
