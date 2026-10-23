/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { normalizeSelectedConnectorIds } from "@noobot/connector-protocol";
import {
  buildSessionDisplaySummary,
  SESSION_DETAIL_MESSAGE_PROJECTION,
} from "../session-summary-builders.js";
import { resolveAuthoritativeTurnTerminal } from "@noobot/authoritative-state/application";
import {
  SESSION_NOT_FOUND_REASON,
  createSessionNotFoundError,
  createTurnTerminalResolution,
} from "@noobot/session-protocol";
import { buildThinkingDetailPayload } from "../session-thinking-detail.js";
import { reconcileSessionSummaryIndex } from "@noobot/session-repair";
import {
  requireSessionTreeNode,
  resolveSessionTreeDepth,
} from "@noobot/workspace-protocol/session-tree";
import { projectSessionAttachmentState } from "./session-attachment-projection.js";
import { text } from "@noobot/shared/value";

export class SessionCrudService {
  constructor({
    sessionRepo,
    taskRepo,
    sessionTreeService,
    attachmentService,
    now = () => new Date().toISOString(),
  } = {}) {
    this.sessionRepo = sessionRepo;
    this.taskRepo = taskRepo;
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
    if (!session) return { exists: false, session: null, task: null };
    const task = await this.taskRepo.getBundle(userId, sessionId, { persistenceContext });
    return { exists: true, session, task };
  }

  async locateSessionScope({ userId, sessionId, persistenceContext }) {
    return this.sessionRepo.locateSessionScope(userId, sessionId, persistenceContext);
  }

  async getSessionData({ userId, sessionId }) {
    const normalizedSessionId = text(sessionId);
    let sessionBundle;
    try {
      sessionBundle = await this.getSessionBundle({
        userId,
        sessionId: normalizedSessionId,
        persistenceContext: this.sessionRepo.treePersistenceContext(userId, normalizedSessionId),
      });
    } catch (error) {
      if (error?.code !== "SESSION_PROTOCOL_INVALID") throw error;
      const sessionTree = await this.sessionTreeService.getSessionTree({ userId });
      return {
        exists: true,
        sessionId: normalizedSessionId,
        sessions: [
          await this.sessionRepo.buildUnavailableSessionSummary(
            userId,
            requireSessionTreeNode(sessionTree, normalizedSessionId),
            error,
          ),
        ],
        availability: "unavailable",
        unavailableReason: { code: error.code, message: error.message },
      };
    }
    if (!sessionBundle.exists) {
      return { exists: false, sessionId: normalizedSessionId, sessions: [] };
    }

    const sessionTree = await this.sessionTreeService.getSessionTree({ userId });
    const allSessionIds = this.sessionTreeService.collectBranchSessionIds(
      normalizedSessionId,
      sessionTree,
    );

    const sessions = [];
    for (const currentSessionId of allSessionIds) {
      const currentNode = requireSessionTreeNode(sessionTree, currentSessionId);
      const currentParentSessionId = currentNode.parentSessionId;
      const depth = resolveSessionTreeDepth(sessionTree, currentSessionId);
      const currentBundle = await this.getSessionBundle({
        userId,
        sessionId: currentSessionId,
        persistenceContext: this.sessionRepo.treePersistenceContext(userId, currentSessionId),
      });
      if (!currentBundle.exists) {
        if (await this.sessionRepo.isSessionDeleted(userId, currentSessionId)) continue;
        const missing = new Error("Canonical session artifact is missing");
        missing.code = "SESSION_ARTIFACT_MISSING";
        const unavailable = await this.sessionRepo.buildUnavailableSessionSummary(
          userId,
          currentNode,
          missing,
        );
        sessions.push({ ...unavailable, depth });
        continue;
      }
      const rawMessages = currentBundle.session.messages;
      sessions.push(
        await projectSessionAttachmentState({
          attachmentService: this.attachmentService,
          userId,
          session: {
            ...currentBundle.session,
            ...buildSessionDisplaySummary(currentBundle.session),
            depth,
            sessionId: currentSessionId,
            parentSessionId: currentParentSessionId,
            rawMessages,
          },
        }),
      );
    }

    return {
      exists: true,
      sessionId: normalizedSessionId,
      detailMode: "full",
      messageProjection: SESSION_DETAIL_MESSAGE_PROJECTION,
      sessions,
    };
  }

  async getSessionThinkingDetail({ userId, sessionId, turnScopeId = "", dialogProcessId = "" }) {
    const normalizedSessionId = text(sessionId);
    const persistenceContext = this.sessionRepo.treePersistenceContext(userId, normalizedSessionId);
    const [turn, displaySummary] = await Promise.all([
      this.sessionRepo.readSessionTurn(userId, normalizedSessionId, {
        turnScopeId,
        dialogProcessId,
        persistenceContext,
      }),
      this.sessionRepo.readSessionDisplaySummary(userId, normalizedSessionId, {
        persistenceContext,
      }),
    ]);
    const summaryMessage = (
      Array.isArray(displaySummary?.messages) ? displaySummary.messages : []
    ).find(
      (message = {}) =>
        text(message?.turnScopeId) === text(turnScopeId) &&
        (!dialogProcessId || text(message?.dialogProcessId) === String(dialogProcessId).trim()),
    );
    const detailContentHash = text(summaryMessage?.thinkingDetailRef?.contentHash);
    return buildThinkingDetailPayload(
      {
        sessionId: normalizedSessionId,
        revision:
          detailContentHash || (turn ? `turn-journal:${turn.turnId}:${turn.committedBytes}` : ""),
        sessions: turn ? [{ sessionId: normalizedSessionId, rawMessages: turn.messages }] : [],
      },
      { turnScopeId, dialogProcessId },
    );
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
    const normalizedSessionId = text(sessionId);
    const sessionTree = await this.sessionTreeService.getSessionTree({ userId });
    if (!Object.hasOwn(sessionTree.nodes, normalizedSessionId)) {
      return {
        exists: false,
        sessionId: normalizedSessionId,
        detailMode: "summary",
        messageProjection: SESSION_DETAIL_MESSAGE_PROJECTION,
        sessions: [],
        summary: true,
      };
    }

    const allSessionIds = this.sessionTreeService.collectBranchSessionIds(
      normalizedSessionId,
      sessionTree,
    );

    const sessions = [];
    for (const currentSessionId of allSessionIds) {
      const currentNode = requireSessionTreeNode(sessionTree, currentSessionId);
      const currentParentSessionId = currentNode.parentSessionId;
      const depth = resolveSessionTreeDepth(sessionTree, currentSessionId);
      let summary = null;
      try {
        summary = await this.sessionRepo.readSessionDisplaySummary(userId, currentSessionId, {
          persistenceContext: this.sessionRepo.treePersistenceContext(userId, currentSessionId),
        });
      } catch (error) {
        summary = await this.sessionRepo.buildUnavailableSessionSummary(userId, currentNode, error);
      }
      if (!summary) continue;
      sessions.push(
        await projectSessionAttachmentState({
          attachmentService: this.attachmentService,
          userId,
          session: {
            ...summary,
            sessionId: currentSessionId,
            parentSessionId: currentParentSessionId,
            depth,
          },
        }),
      );
    }

    return {
      exists: true,
      sessionId: normalizedSessionId,
      detailMode: "summary",
      messageProjection: SESSION_DETAIL_MESSAGE_PROJECTION,
      summary: true,
      sessions,
    };
  }

  async maintainSessionDisplaySummaries({ userId }) {
    await this.sessionRepo.ensureSessionsSummarySchema(userId);
    const sessionIds = await this.listSessionIds({ userId });
    const rebuiltSessionIds = [];
    const failures = [];
    for (const sessionId of sessionIds) {
      try {
        const result = await this.sessionRepo.ensureSessionDisplaySummary(userId, sessionId, {
          persistenceContext: this.sessionRepo.treePersistenceContext(userId, sessionId),
        });
        if (result.rebuilt) rebuiltSessionIds.push(sessionId);
      } catch (error) {
        failures.push({
          sessionId,
          code: String(error?.code || ""),
          message: String(error?.message || error || ""),
        });
      }
    }
    return { userId, rebuiltSessionIds, failures };
  }

  async getAllSessionsData({ userId, failures = null }) {
    const sessionTree = await this.sessionTreeService.getSessionTree({ userId });
    const sessionIds = await this.listSessionIds({ userId });

    const sessionList = (
      await Promise.all(
        sessionIds.map(async (sessionId) => {
          const { parentSessionId } = requireSessionTreeNode(sessionTree, sessionId);
          let sessionBundle;
          try {
            sessionBundle = await this.getSessionBundle({
              userId,
              sessionId,
              persistenceContext: this.sessionRepo.treePersistenceContext(userId, sessionId),
            });
          } catch (error) {
            if (Array.isArray(failures)) {
              failures.push({
                sessionId,
                code: String(error?.code || ""),
                message: String(error?.message || error || ""),
              });
            }
            return null;
          }
          if (!sessionBundle?.exists || !sessionBundle?.session) return null;
          return {
            ...sessionBundle.session,
            sessionId,
            parentSessionId,
            depth: resolveSessionTreeDepth(sessionTree, sessionId),
          };
        }),
      )
    ).filter(Boolean);

    sessionList.sort((leftSession, rightSession) =>
      rightSession.updatedAt.localeCompare(leftSession.updatedAt),
    );
    return sessionList;
  }

  async getAllSessionSummaries({ userId }) {
    const sessionTree = await this.sessionTreeService.getSessionTree({ userId });
    await this.sessionRepo.ensureSessionsSummarySchema(userId);
    const sessionIds = await this.listSessionIds({ userId });
    for (const sessionId of sessionIds) {
      const persistenceContext = this.sessionRepo.treePersistenceContext(userId, sessionId);
      try {
        await this.sessionRepo.ensureSessionDisplaySummary(userId, sessionId, {
          persistenceContext,
        });
      } catch (error) {
        const scope = await this.sessionRepo.requireSessionScope(
          userId,
          sessionId,
          persistenceContext,
        );
        await this.sessionRepo.markSessionSummaryUnavailable(userId, sessionId, { error, scope });
      }
    }
    let payload = await this.sessionRepo.readSessionsSummary(userId);
    if (reconcileSessionSummaryIndex({ sessions: payload.sessions, sessionIds }).changed) {
      payload = await this.sessionRepo.rebuildSessionsSummary(userId);
    }

    return payload.sessions
      .map((summary) => ({
        ...summary,
        depth: resolveSessionTreeDepth(sessionTree, summary.sessionId),
      }))
      .sort((leftSession, rightSession) =>
        rightSession.updatedAt.localeCompare(leftSession.updatedAt),
      );
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
