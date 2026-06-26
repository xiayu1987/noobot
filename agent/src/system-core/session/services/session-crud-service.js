/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { normalizeSelectedConnectors } from "../entities/session-entity.js";
import { isSessionDisplaySummaryPayload } from "../session-summary-builders.js";

export class SessionCrudService {
  constructor({
    sessionRepo,
    taskRepo = null,
    treeRepo,
    sessionTreeService = null,
    now = () => new Date().toISOString(),
  } = {}) {
    this.sessionRepo = sessionRepo;
    this.taskRepo = taskRepo;
    this.treeRepo = treeRepo;
    this.sessionTreeService = sessionTreeService;
    this.now = now;
  }

  async listSessionIds({ userId }) {
    return this.sessionRepo.listSessionIds(userId);
  }

  async ensureSession(userId, sessionId, parentSessionId = "", meta = {}) {
    await this.sessionRepo.ensureSession({
      userId,
      sessionId,
      parentSessionId,
      meta,
    });
  }

  async createSession({
    userId,
    sessionId,
    parentSessionId = "",
    caller = "user",
    modelAlias = "",
  }) {
    await this.ensureSession(userId, sessionId, parentSessionId, {
      caller,
      modelAlias,
    });
    return this.getSessionBundle({ userId, sessionId, parentSessionId });
  }

  async getSessionBundle({ userId, sessionId, parentSessionId = "" }) {
    const session = await this.sessionRepo.findById(
      userId,
      sessionId,
      parentSessionId,
    );
    if (!session) return { exists: false, session: null, task: null };
    const task = this.taskRepo
      ? await this.taskRepo.getBundle(userId, sessionId, parentSessionId)
      : await this.sessionRepo.getTaskBundle?.(userId, sessionId, parentSessionId);
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
      sessions.push({
        ...currentBundle.session,
        sessionId: currentSessionId,
        parentSessionId: currentParentSessionId,
        depth: this.sessionTreeService
          ? await this.sessionTreeService.getSessionDepth({
            userId,
            sessionId: currentSessionId,
          })
          : 0,
      });
    }

    return {
      exists: true,
      sessionId: normalizedSessionId,
      sessions,
    };
  }

  async getSessionDisplayData({ userId, sessionId }) {
    const normalizedSessionId = String(sessionId || "").trim();
    const sessionBundle = await this.getSessionBundle({
      userId,
      sessionId: normalizedSessionId,
    });
    if (!sessionBundle.exists) {
      return { exists: false, sessionId: normalizedSessionId, sessions: [], summary: true };
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
      const depth = this.sessionTreeService
        ? await this.sessionTreeService.getSessionDepth({ userId, sessionId: currentSessionId })
        : this._getDepthFromTree(currentSessionId, sessionTree);
      let summary = typeof this.sessionRepo?.readSessionDisplaySummary === "function"
        ? await this.sessionRepo.readSessionDisplaySummary(userId, currentSessionId, currentParentSessionId)
        : null;
      const needsRebuild = !isSessionDisplaySummaryPayload(summary, currentSessionId) ||
        Number(summary?.depth || 0) !== Number(depth || 0) ||
        (Array.isArray(summary?.toolLogSummaries) &&
          summary.toolLogSummaries.some((item) => Number(item?.depth || 0) !== Number(depth || 0)));
      if (needsRebuild && typeof this.sessionRepo?.rebuildSessionDisplaySummary === "function") {
        summary = await this.sessionRepo.rebuildSessionDisplaySummary(
          userId,
          currentSessionId,
          currentParentSessionId,
          { depth },
        );
      }
      if (!summary) continue;
      sessions.push({
        ...summary,
        sessionId: currentSessionId,
        parentSessionId: currentParentSessionId,
        depth,
        toolLogSummaries: Array.isArray(summary?.toolLogSummaries)
          ? summary.toolLogSummaries.map((item) => ({ ...item, depth }))
          : [],
      });
    }

    return {
      exists: true,
      sessionId: normalizedSessionId,
      summary: true,
      sessions,
    };
  }

  async getAllSessionsData({ userId }) {
    const sessionTree = this.sessionTreeService
      ? await this.sessionTreeService.getSessionTree({ userId })
      : await this.treeRepo.getTree(userId);
    const treeSessionIds = Object.keys(sessionTree?.nodes || {});
    const sessionIds = treeSessionIds.length
      ? treeSessionIds
      : await this.listSessionIds({ userId });

    const sessionList = (await Promise.all(sessionIds.map(async (sessionId) => {
      const parentSessionId = String(
        sessionTree?.nodes?.[sessionId]?.parentSessionId || "",
      );
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
    }))).filter(Boolean);

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
    const treeSessionIds = Object.keys(sessionTree?.nodes || {});
    const sessionIds = treeSessionIds.length
      ? treeSessionIds
      : await this.listSessionIds({ userId });
    const expectedIds = new Set(sessionIds.map((item) => String(item || "").trim()).filter(Boolean));
    let payload = typeof this.sessionRepo?.readSessionsSummary === "function"
      ? await this.sessionRepo.readSessionsSummary(userId)
      : { sessions: [], updatedAt: this.now() };
    const summaries = Array.isArray(payload?.sessions) ? payload.sessions : [];
    const summaryIds = new Set(summaries.map((item) => String(item?.sessionId || "").trim()).filter(Boolean));
    const needsRebuild =
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
    const resolvedParentSessionId = await this.sessionRepo.resolveParentSessionId(
      userId,
      sessionId,
      "",
    );
    const session = await this.sessionRepo.findById(
      userId,
      sessionId,
      resolvedParentSessionId,
    );
    if (!session) return null;
    session.modelAlias = String(modelAlias || "");
    session.updatedAt = this.now();
    await this.sessionRepo.save(userId, session, resolvedParentSessionId);
    return session;
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
  }
}
