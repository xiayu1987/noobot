/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { fatalSystemError } from "../error/index.js";
import { tSystem } from "../i18n/system-text.js";
import { normalizeMessageEntity, normalizeSelectedConnectors } from "./entities.js";

export class SessionService {
  constructor({
    sessionRepo,
    treeRepo,
    now = () => new Date().toISOString(),
  } = {}) {
    this.sessionRepo = sessionRepo;
    this.treeRepo = treeRepo;
    this.now = now;
  }

  async ensureRuntimeDirs(userId) {
    await this.sessionRepo.storageService.ensureRuntimeDirsByBasePath(
      this.sessionRepo.pathResolver.resolveBasePath(userId),
    );
  }

  async upsertSessionTree({ userId, sessionId, parentSessionId = "" }) {
    if (!sessionId) return;
    await this.treeRepo.withLock(userId, async () => {
      const sessionTree = await this.treeRepo.getTree(userId);
      const now = this.now();
      const normalizedSessionId = String(sessionId || "").trim();
      const normalizedParentSessionId = String(parentSessionId || "").trim();

      if (!sessionTree.nodes[normalizedSessionId]) {
        sessionTree.nodes[normalizedSessionId] = {
          sessionId: normalizedSessionId,
          parentSessionId: normalizedParentSessionId,
          children: [],
          createdAt: now,
          updatedAt: now,
        };
      } else {
        sessionTree.nodes[normalizedSessionId].parentSessionId =
          normalizedParentSessionId;
        sessionTree.nodes[normalizedSessionId].updatedAt = now;
        if (!Array.isArray(sessionTree.nodes[normalizedSessionId].children)) {
          sessionTree.nodes[normalizedSessionId].children = [];
        }
      }

      for (const [nodeId, node] of Object.entries(sessionTree.nodes || {})) {
        if (nodeId === normalizedParentSessionId) continue;
        const children = Array.isArray(node?.children) ? node.children : [];
        sessionTree.nodes[nodeId].children = children.filter(
          (childId) => String(childId || "").trim() !== normalizedSessionId,
        );
      }

      if (normalizedParentSessionId) {
        if (!sessionTree.nodes[normalizedParentSessionId]) {
          throw fatalSystemError(
            `${tSystem("session.parentSessionNotFoundPossiblyDeleted")}: ${normalizedParentSessionId}`,
            {
              code: "FATAL_PARENT_SESSION_MISSING",
              details: { normalizedParentSessionId },
            },
          );
        }
        const parentChildren = Array.isArray(
          sessionTree.nodes[normalizedParentSessionId].children,
        )
          ? sessionTree.nodes[normalizedParentSessionId].children
          : [];
        if (!parentChildren.includes(normalizedSessionId)) {
          parentChildren.push(normalizedSessionId);
        }
        sessionTree.nodes[normalizedParentSessionId].children = parentChildren;
        sessionTree.nodes[normalizedParentSessionId].updatedAt = now;
        sessionTree.roots = (sessionTree.roots || []).filter(
          (rootSessionId) => rootSessionId !== normalizedSessionId,
        );
        if (
          !sessionTree.roots.includes(normalizedParentSessionId) &&
          !String(
            sessionTree.nodes[normalizedParentSessionId].parentSessionId || "",
          )
        ) {
          sessionTree.roots.push(normalizedParentSessionId);
        }
      }

      await this.treeRepo.saveTree(userId, sessionTree);
    });
  }

  async getSessionTree({ userId }) {
    return this.treeRepo.getTree(userId);
  }

  async getRootSessionId({ userId, sessionId, sessionTree = null }) {
    const normalizedSessionId = String(sessionId || "").trim();
    if (!normalizedSessionId) return "";
    const tree = sessionTree && typeof sessionTree === "object"
      ? sessionTree
      : await this.treeRepo.getTree(userId);
    return this.treeRepo.resolveRootSessionIdFromTree(normalizedSessionId, tree);
  }

  async getSessionDepth({ userId, sessionId }) {
    const normalizedSessionId = String(sessionId || "").trim();
    if (!normalizedSessionId) return 0;
    const sessionTree = await this.treeRepo.getTree(userId);
    if (sessionTree?.nodes?.[normalizedSessionId]) {
      return this.treeRepo.loopSession(normalizedSessionId, sessionTree, []).length;
    }
    const session = await this.sessionRepo.findById(userId, normalizedSessionId);
    return session ? 1 : 0;
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
    const task = await this.sessionRepo.getTaskBundle(
      userId,
      sessionId,
      parentSessionId,
    );
    return { exists: true, session, task };
  }

  async appendTurn({
    userId,
    sessionId,
    role,
    content,
    type = "",
    taskId = null,
    taskStatus = null,
    dialogProcessId = "",
    parentDialogProcessId = "",
    tool_calls = null,
    tool_call_id = "",
    attachmentMetas = [],
    modelAlias = "",
    modelName = "",
    parentSessionId = "",
  }) {
    const resolvedParentSessionId = await this.sessionRepo.resolveParentSessionId(
      userId,
      sessionId,
      parentSessionId,
    );
    await this.ensureSession(userId, sessionId, resolvedParentSessionId);
    const session = await this.sessionRepo.findById(
      userId,
      sessionId,
      resolvedParentSessionId,
    );
    if (!session) return;

    const resolvedTaskId = taskId ?? session?.currentTaskId ?? "";
    const resolvedTaskStatus = taskStatus ?? (resolvedTaskId ? "start" : "");

    const turn = normalizeMessageEntity({
      role,
      content,
      type: type || "",
      dialogProcessId: dialogProcessId || "",
      parentDialogProcessId: parentDialogProcessId || "",
      taskId: resolvedTaskId,
      taskStatus: resolvedTaskStatus,
      modelAlias: String(modelAlias || "").trim(),
      modelName: String(modelName || "").trim(),
      ts: this.now(),
    }, this.now);

    if (tool_call_id) turn.tool_call_id = tool_call_id;
    if (Array.isArray(tool_calls) && tool_calls.length) turn.tool_calls = tool_calls;
    if (Array.isArray(attachmentMetas) && attachmentMetas.length) {
      turn.attachmentMetas = attachmentMetas;
    }

    session.messages = Array.isArray(session.messages) ? session.messages : [];
    session.messages.push(turn);
    session.updatedAt = this.now();
    if (session.shortMemoryCheckpoint === undefined) session.shortMemoryCheckpoint = 0;
    await this.sessionRepo.save(userId, session, resolvedParentSessionId);
  }

  async getSessionTurns({ userId, sessionId }) {
    const session = await this.sessionRepo.findById(userId, sessionId);
    return session?.messages || [];
  }

  async hasDialogProcessIdInSession({
    userId,
    sessionId,
    dialogProcessId = "",
    parentSessionId = "",
  }) {
    const normalizedDialogProcessId = String(dialogProcessId || "").trim();
    if (!normalizedDialogProcessId) return false;
    const session = await this.sessionRepo.findById(
      userId,
      sessionId,
      parentSessionId,
    );
    if (!session) return false;
    const messages = Array.isArray(session?.messages) ? session.messages : [];
    return messages.some(
      (messageItem) =>
        String(messageItem?.dialogProcessId || "").trim() ===
        normalizedDialogProcessId,
    );
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
        depth: await this.getSessionDepth({ userId, sessionId: currentSessionId }),
      });
    }

    return {
      exists: true,
      sessionId: normalizedSessionId,
      sessions,
    };
  }

  async getAllSessionsData({ userId }) {
    const sessionTree = await this.getSessionTree({ userId });
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
        depth: await this.getSessionDepth({ userId, sessionId }),
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
    const rootSessionId = await this.getRootSessionId({ userId, sessionId });
    if (!rootSessionId) return normalizeSelectedConnectors({});
    const session = await this.sessionRepo.findById(userId, rootSessionId);
    if (!session) return normalizeSelectedConnectors({});
    return normalizeSelectedConnectors(session.selectedConnectors || {});
  }

  async setRootSessionSelectedConnectors({ userId, sessionId, selectedConnectors = {} }) {
    const rootSessionId = await this.getRootSessionId({ userId, sessionId });
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

  async deleteSessionBranch({ userId, sessionId }) {
    const normalizedSessionId = String(sessionId || "").trim();
    if (!normalizedSessionId) {
      throw fatalSystemError(tSystem("common.sessionIdRequired"), {
        code: "FATAL_SESSION_ID_REQUIRED",
      });
    }

    return this.treeRepo.withLock(userId, async () => {
      const sessionTree = await this.treeRepo.getTree(userId);
      const nodeExists = Boolean(sessionTree?.nodes?.[normalizedSessionId]);

      const toDelete = [];
      if (nodeExists) {
        const queue = [normalizedSessionId];
        const visited = new Set();
        while (queue.length) {
          const currentId = String(queue.shift() || "").trim();
          if (!currentId || visited.has(currentId)) continue;
          visited.add(currentId);
          toDelete.push(currentId);
          const children = Array.isArray(sessionTree?.nodes?.[currentId]?.children)
            ? sessionTree.nodes[currentId].children
            : [];
          for (const child of children) queue.push(child);
        }
      } else {
        toDelete.push(normalizedSessionId);
      }

      const deletedSessionIds = [];
      for (const id of toDelete) {
        await this.sessionRepo.delete(userId, id);
        deletedSessionIds.push(id);
      }

      if (nodeExists) {
        const deleteSet = new Set(deletedSessionIds);
        const nextNodes = {};
        for (const [id, node] of Object.entries(sessionTree?.nodes || {})) {
          if (deleteSet.has(id)) continue;
          nextNodes[id] = {
            ...node,
            children: Array.isArray(node?.children)
              ? node.children.filter((childId) => !deleteSet.has(String(childId || "").trim()))
              : [],
            updatedAt: this.now(),
          };
        }
        await this.treeRepo.saveTree(userId, {
          roots: (sessionTree?.roots || []).filter(
            (rootId) => !deleteSet.has(String(rootId || "").trim()),
          ),
          nodes: nextNodes,
          updatedAt: this.now(),
        });
      }

      return {
        ok: true,
        sessionId: normalizedSessionId,
        deletedSessionIds,
      };
    });
  }
}
