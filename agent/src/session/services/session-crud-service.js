/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { normalizeSelectedConnectorIds } from "@noobot/connector-protocol";
import { readRepositoryParentSessionId } from "./session-scope-resolution.js";
import {
  buildSessionDisplaySummary,
  SESSION_DETAIL_MESSAGE_PROJECTION,
} from "../session-summary-builders.js";
import { resolveAuthoritativeTurnTerminal } from "@noobot/authoritative-state/application";
import { createTurnTerminalResolution } from "@noobot/session-protocol";
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

  async _withSessionMutation(
    userId,
    sessionId,
    parentSessionId,
    operation,
    persistenceContext = null,
  ) {
    return this.sessionRepo.withSessionMutation(
      userId,
      sessionId,
      parentSessionId,
      operation,
      persistenceContext,
    );
  }

  async listSessionIds({ userId }) {
    return this.sessionRepo.listSessionIds(userId);
  }

  async ensureSession(userId, sessionId, parentSessionId, caller, persistenceContext = null) {
    await this.sessionRepo.ensureSession({
      userId,
      sessionId,
      parentSessionId,
      caller,
      persistenceContext,
    });
  }

  async createSession({ userId, sessionId, parentSessionId, caller, persistenceContext = null }) {
    await this.ensureSession(userId, sessionId, parentSessionId, caller, persistenceContext);
    return this.getSessionBundle({ userId, sessionId, parentSessionId, persistenceContext });
  }

  async repairSession({ userId, sessionId, parentSessionId = "", persistenceContext = null }) {
    return this.sessionRepo.repairSessionProtocol(
      userId,
      sessionId,
      parentSessionId,
      persistenceContext,
    );
  }

  async getSessionBundle({ userId, sessionId, parentSessionId = "", persistenceContext = null }) {
    const session = await this.sessionRepo.findById(
      userId,
      sessionId,
      parentSessionId,
      persistenceContext,
    );
    if (!session) return { exists: false, session: null, task: null };
    const task = await this.taskRepo.getBundle(
      userId,
      sessionId,
      parentSessionId,
      persistenceContext,
    );
    return { exists: true, session, task: task || null };
  }

  async resolveSessionScope({
    userId = "",
    sessionId = "",
    parentSessionId = "",
    persistenceContext = null,
  } = {}) {
    return this.sessionRepo.resolveSessionScope(
      userId,
      sessionId,
      parentSessionId,
      persistenceContext,
    );
  }

  async getSessionData({ userId, sessionId }) {
    const normalizedSessionId = text(sessionId);
    let sessionBundle;
    try {
      sessionBundle = await this.getSessionBundle({
        userId,
        sessionId: normalizedSessionId,
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
        parentSessionId: currentParentSessionId,
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
    const [turn, displaySummary] = await Promise.all([
      this.sessionRepo.readSessionTurn(userId, normalizedSessionId, {
        turnScopeId,
        dialogProcessId,
      }),
      this.sessionRepo.readSessionDisplaySummary(userId, normalizedSessionId),
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
    parentSessionId = "",
    persistenceScope = null,
    persistenceContext = null,
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
      parentSessionId: text(parentSessionId || persistenceScope?.parentSessionId),
      persistenceContext,
    });
    if (!bundle.exists || !bundle.session) {
      return createTurnTerminalResolution({
        commandId: normalizedCommandId,
        sessionId: normalizedSessionId,
        turnScopeId: normalizedTurnScopeId,
        reason: "session_not_found",
      });
    }
    if (
      text(bundle.session.sessionId) !== normalizedSessionId ||
      (persistenceScope?.parentSessionId &&
        text(bundle.session.parentSessionId) !== String(persistenceScope.parentSessionId).trim())
    ) {
      return createTurnTerminalResolution({
        commandId: normalizedCommandId,
        sessionId: normalizedSessionId,
        turnScopeId: normalizedTurnScopeId,
        reason: "persistence_scope_identity_mismatch",
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
        summary = await this.sessionRepo.readSessionDisplaySummary(
          userId,
          currentSessionId,
          currentParentSessionId,
        );
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
    const sessionTree = await this.sessionTreeService.getSessionTree({ userId });

    const sessionIds = await this.listSessionIds({ userId });
    const rebuiltSessionIds = [];
    const migratedSessionIds = [];
    const failures = [];
    for (const sessionId of sessionIds) {
      const { parentSessionId } = requireSessionTreeNode(sessionTree, sessionId);
      try {
        const result = await this.sessionRepo.ensureSessionDisplaySummary(
          userId,
          sessionId,
          parentSessionId,
        );
        if (result.migrated) migratedSessionIds.push(sessionId);
        if (result.rebuilt) rebuiltSessionIds.push(sessionId);
      } catch (error) {
        failures.push({
          sessionId,
          code: String(error?.code || ""),
          message: String(error?.message || error || ""),
        });
      }
    }
    return { userId, migratedSessionIds, rebuiltSessionIds, failures };
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
              parentSessionId,
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
      const { parentSessionId } = requireSessionTreeNode(sessionTree, sessionId);
      try {
        await this.sessionRepo.ensureSessionDisplaySummary(userId, sessionId, parentSessionId);
      } catch (error) {
        await this.sessionRepo.markSessionSummaryUnavailable(userId, sessionId, { error });
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

  async setSessionModelAlias({ userId, sessionId, modelAlias }) {
    return this._withSessionMutation(userId, sessionId, "", async () => {
      const resolvedParentSessionId = await readRepositoryParentSessionId(
        this.sessionRepo,
        userId,
        sessionId,
        "",
        null,
      );
      const session = await this.sessionRepo.findById(userId, sessionId, resolvedParentSessionId);
      if (!session) return null;
      session.modelAlias = String(modelAlias || "");
      session.updatedAt = this.now();
      await this.sessionRepo.save(userId, session, resolvedParentSessionId);
      return session;
    });
  }

  async renameSession({ userId, sessionId, title }) {
    const normalizedTitle = text(title);
    if (!normalizedTitle) {
      const error = new Error("Session title is required");
      error.statusCode = 400;
      throw error;
    }
    return this._withSessionMutation(userId, sessionId, "", async () => {
      const resolvedParentSessionId = await readRepositoryParentSessionId(
        this.sessionRepo,
        userId,
        sessionId,
        "",
        null,
      );
      const session = await this.sessionRepo.findById(userId, sessionId, resolvedParentSessionId);
      if (!session) return null;
      session.customTitle = normalizedTitle;
      session.updatedAt = this.now();
      await this.sessionRepo.save(userId, session, resolvedParentSessionId);
      return session;
    });
  }

  async getRootSessionSelectedConnectorIds({ userId, sessionId }) {
    const rootSessionId = await this.sessionTreeService.getRootSessionId({ userId, sessionId });
    return this.sessionRepo.readSelectedConnectorIds(userId, rootSessionId);
  }

  async setRootSessionSelectedConnectorIds({ userId, sessionId, selectedConnectorIds = [] }) {
    const rootSessionId = await this.sessionTreeService.getRootSessionId({ userId, sessionId });
    return this._withSessionMutation(userId, rootSessionId, "", async () => {
      const resolvedParentSessionId = await readRepositoryParentSessionId(
        this.sessionRepo,
        userId,
        rootSessionId,
        "",
        null,
      );
      const session = await this.sessionRepo.findById(
        userId,
        rootSessionId,
        resolvedParentSessionId,
      );
      if (!session) return normalizeSelectedConnectorIds([]);
      session.selectedConnectorIds = normalizeSelectedConnectorIds(selectedConnectorIds);
      session.updatedAt = this.now();
      await this.sessionRepo.save(userId, session, resolvedParentSessionId);
      return session.selectedConnectorIds;
    });
  }
}
