/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { normalizeSelectedConnectors } from "../entities/session-entity.js";

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
