/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { normalizeSelectedConnectorIds } from "@noobot/connector-protocol";
import { resolveAuthoritativeTurnTerminal } from "@noobot/authoritative-state/application";
import {
  SESSION_NOT_FOUND_REASON,
  createSessionArtifactNotFoundError,
  createSessionNotFoundError,
  createSessionUnavailableReason,
  createTurnTerminalResolution,
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
import { text } from "@noobot/shared/value";

function ignoreSummaryProgress() {}

export class SessionCrudService {
  constructor({
    sessionRepo,
    sessionTreeService,
    attachmentService,
    now = () => new Date().toISOString(),
  } = {}) {
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
    const normalizedSessionId = text(sessionId);
    const normalizedTurnScopeId = text(turnScopeId);
    const normalizedCommandId = text(commandId);
    if (!userId || !normalizedSessionId) {
      throw new TypeError("terminal resolution requires userId and sessionId");
    }
    const bundle = await this.getSessionBundle({
      userId,
      sessionId: normalizedSessionId,
      persistenceContext,
    });
    if (!bundle.exists || !bundle.session) {
      return createTurnTerminalResolution({
        commandId: normalizedCommandId,
        sessionId: normalizedSessionId,
        turnScopeId: normalizedTurnScopeId,
        reason: SESSION_NOT_FOUND_REASON,
      });
    }
    return resolveAuthoritativeTurnTerminal({
      lifecycle: bundle.session.turnLifecycle,
      turnTimings: bundle.session.turnTimings,
      aggregateVersion: bundle.session.aggregateVersion,
      commandId: normalizedCommandId,
      sessionId: normalizedSessionId,
      turnScopeId: normalizedTurnScopeId,
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

  async maintainSessionDisplaySummaries({ userId, onProgress = ignoreSummaryProgress }) {
    const sessionIds = await this.listSessionIds({ userId });
    const rebuiltSessionIds = [];
    const failures = [];
    for (const [index, sessionId] of sessionIds.entries()) {
      onProgress({ sessionIndex: index + 1, sessionCount: sessionIds.length });
      try {
        const result = await this.sessionRepo.ensureSessionDisplaySummary(userId, sessionId, {
          persistenceContext: this.sessionRepo.treePersistenceContext(userId, sessionId),
        });
        if (result.rebuilt) rebuiltSessionIds.push(sessionId);
      } catch (error) {
        failures.push({ sessionId, ...createSessionUnavailableReason(error) });
      }
    }
    return { userId, rebuiltSessionIds, failures };
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
    return this._mutateSessionDocument(userId, sessionId, persistenceContext, (session) => {
      session.modelAlias = String(modelAlias || "");
      return session;
    });
  }

  async renameSession({ userId, sessionId, title, persistenceContext }) {
    const normalizedTitle = text(title);
    if (!normalizedTitle) {
      const error = new Error("Session title is required");
      error.statusCode = 400;
      throw error;
    }
    return this._mutateSessionDocument(userId, sessionId, persistenceContext, (session) => {
      session.customTitle = normalizedTitle;
      return session;
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
    const session = await this._mutateSessionDocument(
      userId,
      rootSessionId,
      this.sessionRepo.treePersistenceContext(userId, rootSessionId),
      (current) => {
        current.selectedConnectorIds = normalizeSelectedConnectorIds(selectedConnectorIds);
        return current;
      },
    );
    return session.selectedConnectorIds;
  }

  async writeSessionMetadata({ userId, sessionId, metadata, persistenceContext }) {
    await this.sessionRepo.writeSessionMetadata(userId, sessionId, metadata, {
      persistenceContext,
    });
  }

  async _mutateSessionDocument(userId, sessionId, persistenceContext, mutate) {
    return this.sessionRepo.withSessionMutation(
      userId,
      sessionId,
      async () => {
        const session = await this.sessionRepo.findById(userId, sessionId, { persistenceContext });
        if (!session) throw createSessionNotFoundError({ userId, sessionId });
        mutate(session);
        session.updatedAt = this.now();
        await this.sessionRepo.save(userId, session, { persistenceContext });
        return session;
      },
      { persistenceContext },
    );
  }
}
