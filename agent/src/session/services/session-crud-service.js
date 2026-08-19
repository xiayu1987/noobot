/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { normalizeSelectedConnectors } from "@noobot/agent-config-protocol/enums";
import {
  buildSessionDisplaySummary,
  SESSION_DETAIL_MESSAGE_PROJECTION,
  isSessionDisplaySummaryPayload,
} from "../session-summary-builders.js";
import { resolveAuthoritativeTurnTerminal } from "@noobot/authoritative-state/application";
import { createTurnTerminalResolution } from "@noobot/session-protocol";
import { buildThinkingDetailPayload } from "../session-thinking-detail.js";
import { reconcileSessionSummaryIndex } from "@noobot/session-repair";
import { projectSessionAttachmentState } from "./session-attachment-projection.js";

function projectSessionTreeDepth(summary = {}, depth = 0) {
  const normalizedDepth = Number.isFinite(Number(depth)) ? Number(depth) : 0;
  return {
    ...summary,
    depth: normalizedDepth,
  };
}

export class SessionCrudService {
  constructor({
    sessionRepo,
    taskRepo = null,
    treeRepo,
    sessionTreeService = null,
    attachmentService,
    now = () => new Date().toISOString(),
  } = {}) {
    this.sessionRepo = sessionRepo;
    this.taskRepo = taskRepo;
    this.treeRepo = treeRepo;
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
    if (typeof this.sessionRepo?.withSessionMutation === "function") {
      return this.sessionRepo.withSessionMutation(
        userId,
        sessionId,
        parentSessionId,
        operation,
        persistenceContext,
      );
    }
    return operation();
  }

  async listSessionIds({ userId }) {
    return this.sessionRepo.listSessionIds(userId);
  }

  async ensureSession(
    userId,
    sessionId,
    parentSessionId = "",
    meta = {},
    persistenceContext = null,
  ) {
    await this.sessionRepo.ensureSession({
      userId,
      sessionId,
      parentSessionId,
      meta,
      persistenceContext,
    });
  }

  async createSession({
    userId,
    sessionId,
    parentSessionId = "",
    caller = "user",
    modelAlias = "",
    persistenceContext = null,
  }) {
    await this.ensureSession(
      userId,
      sessionId,
      parentSessionId,
      {
        caller,
        modelAlias,
      },
      persistenceContext,
    );
    return this.getSessionBundle({ userId, sessionId, parentSessionId, persistenceContext });
  }

  async getSessionBundle({ userId, sessionId, parentSessionId = "", persistenceContext = null }) {
    const session = await this.sessionRepo.findById(
      userId,
      sessionId,
      parentSessionId,
      persistenceContext,
    );
    if (!session) return { exists: false, session: null, task: null };
    const task = this.taskRepo
      ? await this.taskRepo.getBundle(userId, sessionId, parentSessionId, persistenceContext)
      : await this.sessionRepo.getTaskBundle?.(
          userId,
          sessionId,
          parentSessionId,
          persistenceContext,
        );
    return { exists: true, session, task: task || null };
  }

  async getSessionData({ userId, sessionId }) {
    const normalizedSessionId = String(sessionId || "").trim();
    const sessionBundle = await this.getSessionBundle({
      userId,
      sessionId: normalizedSessionId,
    });
    if (!sessionBundle.exists) {
      return { exists: false, sessionId: normalizedSessionId, sessions: [] };
    }

    const sessionTree = await this.treeRepo.getTree(userId);
    const allSessionIds = [];
    const queue = [normalizedSessionId];
    const visited = new Set();
    while (queue.length) {
      const currentSessionId = queue.shift();
      if (!currentSessionId || visited.has(currentSessionId)) continue;
      visited.add(currentSessionId);
      allSessionIds.push(currentSessionId);
      const children = Array.isArray(sessionTree?.nodes?.[currentSessionId]?.children)
        ? sessionTree.nodes[currentSessionId].children
        : [];
      for (const childSessionId of children) queue.push(childSessionId);
    }

    const sessions = [];
    for (const currentSessionId of allSessionIds) {
      const currentParentSessionId = String(
        sessionTree?.nodes?.[currentSessionId]?.parentSessionId || "",
      );
      const currentBundle = await this.getSessionBundle({
        userId,
        sessionId: currentSessionId,
        parentSessionId: currentParentSessionId,
      });
      if (!currentBundle?.exists || !currentBundle?.session) continue;
      const rawMessages = Array.isArray(currentBundle.session.messages)
        ? currentBundle.session.messages
        : [];
      const depth = this.sessionTreeService
        ? await this.sessionTreeService.getSessionDepth({
            userId,
            sessionId: currentSessionId,
          })
        : this._getDepthFromTree(currentSessionId, sessionTree);
      const displayProjection = projectSessionTreeDepth(
        buildSessionDisplaySummary(currentBundle.session),
        depth,
      );
      sessions.push(
        await projectSessionAttachmentState({
          attachmentService: this.attachmentService,
          userId,
          session: {
            ...currentBundle.session,
            ...displayProjection,
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
    const normalizedSessionId = String(sessionId || "").trim();
    const [turn, displaySummary] = await Promise.all([
      this.sessionRepo.readSessionTurn(userId, normalizedSessionId, {
        turnScopeId,
        dialogProcessId,
      }),
      this.sessionRepo.readSessionDisplaySummary(userId, normalizedSessionId),
    ]);
    const summaryMessage = (Array.isArray(displaySummary?.messages) ? displaySummary.messages : [])
      .find((message = {}) => (
        String(message?.turnScopeId || "").trim() === String(turnScopeId || "").trim() &&
        (!dialogProcessId ||
          String(message?.dialogProcessId || "").trim() === String(dialogProcessId).trim())
      ));
    const detailContentHash = String(summaryMessage?.thinkingDetailRef?.contentHash || "").trim();
    return buildThinkingDetailPayload(
      {
        sessionId: normalizedSessionId,
        revision: detailContentHash || (
          turn ? `turn-journal:${turn.turnId}:${turn.committedBytes}` : ""
        ),
        sessions: turn ? [{ sessionId: normalizedSessionId, rawMessages: turn.messages }] : [],
      },
      { turnScopeId, dialogProcessId },
    );
  }

  async resolveTurnTerminalState({
    userId,
    sessionId,
    turnScopeId,
    commandId = "",
    parentSessionId = "",
    persistenceScope = null,
    persistenceContext = null,
  }) {
    const normalizedSessionId = String(sessionId || "").trim();
    const normalizedTurnScopeId = String(turnScopeId || "").trim();
    const normalizedCommandId = String(commandId || "").trim();
    if (!userId || !normalizedSessionId || !normalizedTurnScopeId || !normalizedCommandId) {
      return createTurnTerminalResolution({
        commandId: normalizedCommandId || "invalid",
        sessionId: normalizedSessionId,
        turnScopeId: normalizedTurnScopeId,
        reason: "invalid_terminal_resolution_request",
      });
    }
    const bundle = await this.getSessionBundle({
      userId,
      sessionId: normalizedSessionId,
      parentSessionId: String(parentSessionId || persistenceScope?.parentSessionId || "").trim(),
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
      String(bundle.session.sessionId || bundle.session.id || "").trim() !== normalizedSessionId ||
      (persistenceScope?.parentSessionId &&
        String(bundle.session.parentSessionId || "").trim() !==
          String(persistenceScope.parentSessionId).trim())
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
    const normalizedSessionId = String(sessionId || "").trim();
    const sessionTree = await this.treeRepo.getTree(userId);
    if (!sessionTree?.nodes?.[normalizedSessionId]) {
      return {
        exists: false,
        sessionId: normalizedSessionId,
        detailMode: "summary",
        messageProjection: SESSION_DETAIL_MESSAGE_PROJECTION,
        sessions: [],
        summary: true,
      };
    }

    const allSessionIds = [];
    const queue = [normalizedSessionId];
    const visited = new Set();
    while (queue.length) {
      const currentSessionId = queue.shift();
      if (!currentSessionId || visited.has(currentSessionId)) continue;
      visited.add(currentSessionId);
      allSessionIds.push(currentSessionId);
      const children = Array.isArray(sessionTree?.nodes?.[currentSessionId]?.children)
        ? sessionTree.nodes[currentSessionId].children
        : [];
      for (const childSessionId of children) queue.push(childSessionId);
    }

    const sessions = [];
    for (const currentSessionId of allSessionIds) {
      const currentParentSessionId = String(
        sessionTree?.nodes?.[currentSessionId]?.parentSessionId || "",
      );
      const depth = this.sessionTreeService
        ? await this.sessionTreeService.getSessionDepth({ userId, sessionId: currentSessionId })
        : this._getDepthFromTree(currentSessionId, sessionTree);
      const summary =
        typeof this.sessionRepo?.readSessionDisplaySummary === "function"
          ? await this.sessionRepo.readSessionDisplaySummary(
              userId,
              currentSessionId,
              currentParentSessionId,
            )
          : null;
      const canonicalMessageCount =
        typeof this.sessionRepo?.getTurnMessageCount === "function"
          ? await this.sessionRepo.getTurnMessageCount(
              userId,
              currentSessionId,
              currentParentSessionId,
            )
          : 0;
      const summaryCurrent =
        isSessionDisplaySummaryPayload(summary, currentSessionId) &&
        canonicalMessageCount <=
          Number(summary?.stats?.messageCount || summary?.messages?.length || 0);
      if (!summaryCurrent) {
        const error = new Error(
          `session display summary requires maintenance: ${currentSessionId}`,
        );
        error.code = "SESSION_DISPLAY_SUMMARY_MAINTENANCE_REQUIRED";
        error.statusCode = 503;
        throw error;
      }
      if (!summary) continue;
      sessions.push(
        await projectSessionAttachmentState({
          attachmentService: this.attachmentService,
          userId,
          session: projectSessionTreeDepth(
            {
              ...summary,
              sessionId: currentSessionId,
              parentSessionId: currentParentSessionId,
            },
            depth,
          ),
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
    const sessionTree = this.sessionTreeService
      ? await this.sessionTreeService.getSessionTree({ userId })
      : await this.treeRepo.getTree(userId);
    // The filesystem Session artifact is the sole source of list membership.
    // The tree is relationship metadata and may retain historical orphan nodes.
    const sessionIds = await this.listSessionIds({ userId });
    const rebuiltSessionIds = [];
    const migratedSessionIds = [];
    const failures = [];
    for (const sessionId of sessionIds) {
      const parentSessionId = String(sessionTree?.nodes?.[sessionId]?.parentSessionId || "").trim();
      try {
        const artifactMaintenance = await this.sessionRepo.maintainCanonicalSessionArtifacts(
          userId,
          sessionId,
          parentSessionId,
        );
        if (artifactMaintenance?.migrated === true) migratedSessionIds.push(sessionId);
        const summary = await this.sessionRepo.readSessionDisplaySummary(
          userId,
          sessionId,
          parentSessionId,
        );
        const canonicalMessageCount = await this.sessionRepo.getTurnMessageCount(
          userId,
          sessionId,
          parentSessionId,
        );
        const current =
          isSessionDisplaySummaryPayload(summary, sessionId) &&
          canonicalMessageCount <=
            Number(summary?.stats?.messageCount || summary?.messages?.length || 0);
        if (current) continue;
        await this.sessionRepo.rebuildSessionDisplaySummary(userId, sessionId, parentSessionId, {});
        rebuiltSessionIds.push(sessionId);
      } catch (error) {
        failures.push({
          sessionId,
          code: String(error?.code || error?.errorCode || ""),
          message: String(error?.message || error || ""),
        });
      }
    }
    return { userId, migratedSessionIds, rebuiltSessionIds, failures };
  }

  async getAllSessionsData({ userId }) {
    const sessionTree = this.sessionTreeService
      ? await this.sessionTreeService.getSessionTree({ userId })
      : await this.treeRepo.getTree(userId);
    // Session artifacts define list membership; the tree only supplies relationships.
    const sessionIds = await this.listSessionIds({ userId });

    const sessionList = (
      await Promise.all(
        sessionIds.map(async (sessionId) => {
          const parentSessionId = String(sessionTree?.nodes?.[sessionId]?.parentSessionId || "");
          const sessionBundle = await this.getSessionBundle({
            userId,
            sessionId,
            parentSessionId,
          });
          if (!sessionBundle?.exists || !sessionBundle?.session) return null;
          return {
            ...sessionBundle.session,
            sessionId,
            parentSessionId,
            depth: this.sessionTreeService
              ? await this.sessionTreeService.getSessionDepth({ userId, sessionId })
              : 0,
          };
        }),
      )
    ).filter(Boolean);

    sessionList.sort(
      (leftSession, rightSession) =>
        new Date(rightSession.updatedAt || 0).getTime() -
        new Date(leftSession.updatedAt || 0).getTime(),
    );
    return sessionList;
  }

  _getDepthFromTree(sessionId = "", sessionTree = null) {
    const normalizedSessionId = String(sessionId || "").trim();
    if (!normalizedSessionId || !sessionTree?.nodes?.[normalizedSessionId]) return 0;
    if (typeof this.treeRepo?.loopSession === "function") {
      return this.treeRepo.loopSession(normalizedSessionId, sessionTree, []).length;
    }
    const visited = new Set();
    let depth = 0;
    let currentId = normalizedSessionId;
    while (currentId && !visited.has(currentId) && sessionTree?.nodes?.[currentId]) {
      visited.add(currentId);
      depth += 1;
      currentId = String(sessionTree.nodes[currentId]?.parentSessionId || "").trim();
    }
    return depth;
  }

  async getAllSessionSummaries({ userId }) {
    const sessionTree = this.sessionTreeService
      ? await this.sessionTreeService.getSessionTree({ userId })
      : await this.treeRepo.getTree(userId);
    const sessionIds = await this.listSessionIds({ userId });
    const expectedIds = new Set(
      sessionIds.map((item) => String(item || "").trim()).filter(Boolean),
    );
    let payload =
      typeof this.sessionRepo?.readSessionsSummary === "function"
        ? await this.sessionRepo.readSessionsSummary(userId)
        : { sessions: [], updatedAt: this.now() };
    const summaries = Array.isArray(payload?.sessions) ? payload.sessions : [];
    const summaryIndex = reconcileSessionSummaryIndex({ sessions: summaries, sessionIds });
    const summaryIds = new Set(
      summaries.map((item) => String(item?.sessionId || "").trim()).filter(Boolean),
    );
    const needsRebuild =
      summaryIndex.changed ||
      !summaries.length ||
      summaryIds.size !== expectedIds.size ||
      [...expectedIds].some((sessionId) => !summaryIds.has(sessionId)) ||
      summaries.some((summary) => {
        const sessionId = String(summary?.sessionId || "").trim();
        if (!expectedIds.has(sessionId)) return true;
        if (!sessionTree?.nodes?.[sessionId]) return false;
        return Number(summary?.depth || 0) !== this._getDepthFromTree(sessionId, sessionTree);
      });
    if (needsRebuild && typeof this.sessionRepo?.rebuildSessionsSummary === "function") {
      payload = await this.sessionRepo.rebuildSessionsSummary(userId, { sessionTree });
    }
    const sessions = (Array.isArray(payload?.sessions) ? payload.sessions : [])
      .filter((item) => expectedIds.has(String(item?.sessionId || "").trim()))
      .sort(
        (leftSession, rightSession) =>
          new Date(rightSession.updatedAt || 0).getTime() -
          new Date(leftSession.updatedAt || 0).getTime(),
      );
    return sessions;
  }

  async setSessionModelAlias({ userId, sessionId, modelAlias }) {
    return this._withSessionMutation(userId, sessionId, "", async () => {
      const resolvedParentSessionId = await this.sessionRepo.resolveParentSessionId(
        userId,
        sessionId,
        "",
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
    const normalizedTitle = String(title || "").trim();
    if (!normalizedTitle) {
      const error = new Error("Session title is required");
      error.statusCode = 400;
      throw error;
    }
    return this._withSessionMutation(userId, sessionId, "", async () => {
      const resolvedParentSessionId = await this.sessionRepo.resolveParentSessionId(
        userId,
        sessionId,
        "",
      );
      const session = await this.sessionRepo.findById(userId, sessionId, resolvedParentSessionId);
      if (!session) return null;
      session.customTitle = normalizedTitle;
      session.updatedAt = this.now();
      await this.sessionRepo.save(userId, session, resolvedParentSessionId);
      return session;
    });
  }

  async getRootSessionSelectedConnectors({ userId, sessionId }) {
    const rootSessionId = this.sessionTreeService
      ? await this.sessionTreeService.getRootSessionId({ userId, sessionId })
      : String(sessionId || "").trim();
    if (!rootSessionId) return normalizeSelectedConnectors({});
    const session = await this.sessionRepo.findById(userId, rootSessionId);
    if (!session) return normalizeSelectedConnectors({});
    return normalizeSelectedConnectors(session.selectedConnectors || {});
  }

  async setRootSessionSelectedConnectors({ userId, sessionId, selectedConnectors = {} }) {
    const rootSessionId = this.sessionTreeService
      ? await this.sessionTreeService.getRootSessionId({ userId, sessionId })
      : String(sessionId || "").trim();
    if (!rootSessionId) return normalizeSelectedConnectors({});
    return this._withSessionMutation(userId, rootSessionId, "", async () => {
      const resolvedParentSessionId = await this.sessionRepo.resolveParentSessionId(
        userId,
        rootSessionId,
        "",
      );
      const session = await this.sessionRepo.findById(
        userId,
        rootSessionId,
        resolvedParentSessionId,
      );
      if (!session) return normalizeSelectedConnectors({});
      session.selectedConnectors = normalizeSelectedConnectors(selectedConnectors);
      session.updatedAt = this.now();
      await this.sessionRepo.save(userId, session, resolvedParentSessionId);
      return session.selectedConnectors;
    });
  }
}
