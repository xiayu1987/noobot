/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  readdir,
  rm,
} from "node:fs/promises";
import path from "node:path";
import { mergeConfig } from "../config/index.js";
import { fatalSystemError } from "../error/index.js";
import { PathResolver } from "./path-resolver.js";
import { StorageService } from "./storage-service.js";
import { SessionTreeManager } from "./session-tree-manager.js";
import { TaskManager } from "./task-manager.js";
import { ExecutionManager } from "./execution-manager.js";
import { SessionStoreManager } from "./session-store-manager.js";

export class SessionManager {
  constructor(globalConfig) {
    this.globalConfig = globalConfig;
    this.pathResolver = new PathResolver(globalConfig || {});
    this.storageService = new StorageService({
      pathResolver: this.pathResolver,
    });
    this.sessionTreeManager = new SessionTreeManager({
      storageService: this.storageService,
      pathResolver: this.pathResolver,
      now: () => this._now(),
    });
    this.sessionStoreManager = new SessionStoreManager({
      now: () => this._now(),
      ensureRuntimeDirsByBasePath: (...args) =>
        this._ensureRuntimeDirsByBasePath(...args),
      resolveParentSessionId: (...args) => this._resolveParentSessionId(...args),
      resolveSessionScope: (...args) => this._resolveSessionScope(...args),
      sessionDir: (...args) => this._sessionDir(...args),
      sessionFile: (...args) => this._sessionFile(...args),
      taskFile: (...args) => this._taskFile(...args),
      executionFile: (...args) => this._executionFile(...args),
      exists: (...args) => this.storageService.exists(...args),
      readJson: (...args) => this.storageService.readJson(...args),
      writeJson: (...args) => this.storageService.writeJson(...args),
      normalizeMessage: (...args) => this._normalizeMessage(...args),
      normalizeMessages: (...args) => this._normalizeMessages(...args),
    });
    this.taskManager = new TaskManager({
      now: () => this._now(),
      resolveSessionScope: (...args) => this._resolveSessionScope(...args),
      ensureSession: (...args) => this.ensureSession(...args),
      getSessionBundle: (...args) => this.getSessionBundle(...args),
      writeJson: (...args) => this.storageService.writeJson(...args),
      normalizeTaskItem: (...args) => this._normalizeTaskItem(...args),
    });
    this.executionManager = new ExecutionManager({
      now: () => this._now(),
      resolveSessionScope: (...args) => this._resolveSessionScope(...args),
      readJson: (...args) => this.storageService.readJson(...args),
      writeJson: (...args) => this.storageService.writeJson(...args),
    });
  }

  _now() {
    return new Date().toISOString();
  }

  _resolveBasePath(userId = "") {
    return this.pathResolver.resolveBasePath(userId);
  }

  _sessionRoot(basePath) {
    return this.pathResolver.sessionRoot(basePath);
  }

  _loopSession(sessionId, tree, chain = []) {
    const normalizedSessionId = String(sessionId || "").trim();
    if (!normalizedSessionId) return chain;
    const parentSessionId = String(
      tree?.nodes?.[normalizedSessionId]?.parentSessionId || "",
    ).trim();
    const nextChain = chain.concat(normalizedSessionId);
    if (!parentSessionId) {
      return nextChain;
    }
    return this._loopSession(parentSessionId, tree, nextChain);
  }

  _resolveRootSessionIdFromTree(sessionId = "", tree = {}) {
    return this.sessionTreeManager.resolveRootSessionIdFromTree(sessionId, tree);
  }

  async _sessionDir(basePath, sessionId, parentSessionId = "") {
    const normalizedSessionId = String(sessionId || "").trim();
    if (!normalizedSessionId) return this._sessionRoot(basePath);

    const normalizedParentSessionId = String(parentSessionId || "").trim();
    if (
      normalizedParentSessionId &&
      normalizedParentSessionId !== normalizedSessionId
    ) {
      const parentDir = await this._sessionDir(
        basePath,
        normalizedParentSessionId,
      );
      return path.join(parentDir, normalizedSessionId);
    }

    return path.join(
      this._sessionRoot(basePath),
      ...this._loopSession(
        normalizedSessionId,
        await this._readSessionTree(basePath),
        [],
      ).reverse(),
    );
  }

  async _sessionFile(basePath, sessionId, parentSessionId = "") {
    return path.join(
      await this._sessionDir(basePath, sessionId, parentSessionId),
      "session.json",
    );
  }

  async _taskFile(basePath, sessionId, parentSessionId = "") {
    return path.join(
      await this._sessionDir(basePath, sessionId, parentSessionId),
      "task.json",
    );
  }

  async _executionFile(basePath, sessionId, parentSessionId = "") {
    return path.join(
      await this._sessionDir(basePath, sessionId, parentSessionId),
      "execution.json",
    );
  }

  _sessionTreeFile(basePath) {
    return this.pathResolver.sessionTreeFile(basePath);
  }

  async _readJson(filePath, fallback = {}) {
    return this.storageService.readJson(filePath, fallback);
  }

  async _resolveParentSessionId(basePath, sessionId, parentSessionId = "") {
    const hintedParentSessionId = String(parentSessionId || "").trim();
    if (hintedParentSessionId) {
      const tree = await this._readSessionTree(basePath);
      if (!tree?.nodes?.[hintedParentSessionId]) {
        throw fatalSystemError(
          `parent session not found (possibly deleted): ${hintedParentSessionId}`,
          {
            code: "FATAL_PARENT_SESSION_MISSING",
            details: { hintedParentSessionId },
          },
        );
      }
      return hintedParentSessionId;
    }

    const normalizedSessionId = String(sessionId || "").trim();
    if (!normalizedSessionId) return "";

    const tree = await this._readSessionTree(basePath);
    return String(tree?.nodes?.[normalizedSessionId]?.parentSessionId || "").trim();
  }

  async _resolveSessionScope(basePath, sessionId, parentSessionId = "") {
    const resolvedParentSessionId = await this._resolveParentSessionId(
      basePath,
      sessionId,
      parentSessionId,
    );
    return {
      resolvedParentSessionId,
      sessionFile: await this._sessionFile(
        basePath,
        sessionId,
        resolvedParentSessionId,
      ),
      taskFile: await this._taskFile(basePath, sessionId, resolvedParentSessionId),
      executionFile: await this._executionFile(
        basePath,
        sessionId,
        resolvedParentSessionId,
      ),
    };
  }

  async _readExecutionBundle(basePath, sessionId, parentSessionId = "") {
    return this.executionManager.readExecutionBundle(
      basePath,
      sessionId,
      parentSessionId,
    );
  }

  async _writeExecutionBundle(
    basePath,
    sessionId,
    parentSessionId = "",
    execution = {},
  ) {
    await this.executionManager.writeExecutionBundle(
      basePath,
      sessionId,
      parentSessionId,
      execution,
    );
  }

  async _writeJson(filePath, data) {
    await this.storageService.writeJson(filePath, data);
  }

  _normalizeMessage(message = {}) {
    const normalizedAttachmentMetas = Array.isArray(message?.attachmentMetas)
      ? message.attachmentMetas
      : Array.isArray(message?.attachments)
        ? message.attachments
        : [];
    const normalizedMessage = {
      ...message,
      role: message?.role || "",
      content: message?.content || "",
      type: message?.type || "",
      dialogProcessId: message?.dialogProcessId || "",
      parentDialogProcessId: message?.parentDialogProcessId || "",
      taskId: message?.taskId || "",
      taskStatus: message?.taskStatus || "",
      modelAlias: String(message?.modelAlias || "").trim(),
      modelName: String(message?.modelName || "").trim(),
      attachmentMetas: normalizedAttachmentMetas,
      ts: message?.ts || this._now(),
    };
    delete normalizedMessage.attachmentIds;
    delete normalizedMessage.attachments;
    if (
      normalizedMessage.type === "tool_call" &&
      !Array.isArray(normalizedMessage.tool_calls)
    ) {
      normalizedMessage.tool_calls = [];
    }
    return normalizedMessage;
  }

  _normalizeMessages(messages = []) {
    return (messages || []).map((messageItem) =>
      this._normalizeMessage(messageItem),
    );
  }

  _normalizeTaskItem(task = {}) {
    const taskId = String(task?.taskId || "").trim();
    const taskStatus = String(task?.taskStatus || task?.status || "").trim();
    return {
      taskId,
      skillName: String(task?.skillName || "").trim(),
      taskName: String(task?.taskName || "").trim(),
      taskStatus:
        taskStatus === "start" || taskStatus === "completed" ? taskStatus : "",
      startedAt: String(task?.startedAt || "").trim(),
      endedAt: String(task?.endedAt || "").trim(),
      result: String(task?.result || "").trim(),
      meta: task?.meta && typeof task.meta === "object" ? task.meta : {},
    };
  }

  _normalizeSelectedConnectors(selectedConnectors = {}) {
    const source =
      selectedConnectors && typeof selectedConnectors === "object"
        ? selectedConnectors
        : {};
    const normalizeConnectorName = (value = "") => String(value || "").trim();
    return {
      database: normalizeConnectorName(source?.database),
      terminal: normalizeConnectorName(source?.terminal),
      email: normalizeConnectorName(source?.email),
    };
  }

  async _ensureRuntimeDirsByBasePath(basePath) {
    return this.storageService.ensureRuntimeDirsByBasePath(basePath);
  }

  async _readSessionTree(basePath) {
    return this.sessionTreeManager.readSessionTree(basePath);
  }

  async _writeSessionTree(basePath, tree) {
    await this.sessionTreeManager.writeSessionTree(basePath, tree);
  }

  _normalizeSessionTreeShape(tree = {}) {
    return this.sessionTreeManager.normalizeSessionTreeShape(tree);
  }

  async _withSessionTreeLock(basePath, run) {
    return this.sessionTreeManager.withSessionTreeLock(basePath, run);
  }

  async ensureRuntimeDirs(userId) {
    const basePath = this._resolveBasePath(userId);
    await this._ensureRuntimeDirsByBasePath(basePath);
  }

  async upsertSessionTree({ userId, sessionId, parentSessionId = "" }) {
    const basePath = this._resolveBasePath(userId);
    await this.sessionTreeManager.upsertSessionTree({
      basePath,
      sessionId,
      parentSessionId,
    });
  }

  async getSessionTree({ userId }) {
    const basePath = this._resolveBasePath(userId);
    return this._readSessionTree(basePath);
  }

  async getRootSessionId({ userId, sessionId, sessionTree = null }) {
    const normalizedSessionId = String(sessionId || "").trim();
    if (!normalizedSessionId) return "";
    const tree =
      sessionTree && typeof sessionTree === "object"
        ? this._normalizeSessionTreeShape(sessionTree)
        : await this.getSessionTree({ userId });
    return this._resolveRootSessionIdFromTree(normalizedSessionId, tree);
  }

  async getSessionDepth({ userId, sessionId }) {
    const normalizedSessionId = String(sessionId || "").trim();
    if (!normalizedSessionId) return 0;
    const basePath = this._resolveBasePath(userId);
    const sessionTree = await this._readSessionTree(basePath);
    if (sessionTree?.nodes?.[normalizedSessionId]) {
      return this._loopSession(normalizedSessionId, sessionTree, []).length;
    }
    const sessionBundle = await this.getSessionBundle({
      userId,
      sessionId: normalizedSessionId,
    });
    return sessionBundle?.exists ? 1 : 0;
  }

  async getSessionData({ userId, sessionId }) {
    const normalizedSessionId = String(sessionId || "").trim();
    const sessionBundle = await this.getSessionBundle({
      userId,
      sessionId: normalizedSessionId,
    });
    if (!sessionBundle.exists) {
      return {
        exists: false,
        sessionId: normalizedSessionId,
        sessions: [],
      };
    }
    const basePath = this._resolveBasePath(userId);
    const sessionTree = await this._readSessionTree(basePath);
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
      const depth = await this.getSessionDepth({
        userId,
        sessionId: currentSessionId,
      });
      sessions.push({
        ...currentBundle.session,
        sessionId: currentSessionId,
        parentSessionId: currentParentSessionId,
        depth,
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

  async listSessionIds({ userId }) {
    const basePath = this._resolveBasePath(userId);
    await this._ensureRuntimeDirsByBasePath(basePath);
    let entries = [];
    try {
      entries = await readdir(this._sessionRoot(basePath), { withFileTypes: true });
    } catch {
      return [];
    }
    return entries
      .filter((dirEntry) => dirEntry.isDirectory())
      .map((dirEntry) => dirEntry.name);
  }

  async ensureSession(userId, sessionId, parentSessionId = "", meta = {}) {
    const basePath = this._resolveBasePath(userId);
    await this.sessionStoreManager.ensureSession({
      basePath,
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
    const basePath = this._resolveBasePath(userId);
    return this.sessionStoreManager.getSessionBundle({
      basePath,
      sessionId,
      parentSessionId,
    });
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
    const basePath = this._resolveBasePath(userId);
    await this.sessionStoreManager.appendTurn({
      basePath,
      userId,
      sessionId,
      role,
      content,
      type,
      taskId,
      taskStatus,
      dialogProcessId,
      parentDialogProcessId,
      tool_calls,
      tool_call_id,
      attachmentMetas,
      modelAlias,
      modelName,
      parentSessionId,
    });
  }

  async getSessionTurns({ userId, sessionId }) {
    const sessionBundle = await this.getSessionBundle({ userId, sessionId });
    return sessionBundle.session?.messages || [];
  }

  async hasDialogProcessIdInSession({
    userId,
    sessionId,
    dialogProcessId = "",
    parentSessionId = "",
  }) {
    const normalizedDialogProcessId = String(dialogProcessId || "").trim();
    if (!normalizedDialogProcessId) return false;
    const sessionBundle = await this.getSessionBundle({
      userId,
      sessionId,
      parentSessionId,
    });
    if (!sessionBundle?.exists) return false;
    const messages = Array.isArray(sessionBundle?.session?.messages)
      ? sessionBundle.session.messages
      : [];
    return messages.some(
      (messageItem) =>
        String(messageItem?.dialogProcessId || "").trim() ===
        normalizedDialogProcessId,
    );
  }

  async getExecutionBundle({ userId, sessionId }) {
    const basePath = this._resolveBasePath(userId);
    const resolvedParentSessionId = await this._resolveParentSessionId(
      basePath,
      sessionId,
    );
    await this.ensureSession(userId, sessionId, resolvedParentSessionId);
    return this._readExecutionBundle(basePath, sessionId, resolvedParentSessionId);
  }

  async appendExecutionLog({
    userId,
    sessionId,
    dialogProcessId = "",
    event = "",
    category = "",
    type = "",
    data = {},
    ts = "",
    parentSessionId = "",
  }) {
    const basePath = this._resolveBasePath(userId);
    await this.executionManager.appendExecutionLog({
      basePath,
      sessionId,
      dialogProcessId,
      event,
      category,
      type,
      data,
      ts,
      parentSessionId,
    });
  }

  _sessionContextConfig(userConfig = {}) {
    const effectiveConfig = mergeConfig(this.globalConfig, userConfig);
    const sessionConfig = effectiveConfig?.session || {};
    return {
      recentMessageLimit: Number(sessionConfig.recentMessageLimit || 20),
      useLastRunningTaskRange: sessionConfig.useLastRunningTaskRange !== false,
      useLastCompletedTaskRange:
        sessionConfig.useLastCompletedTaskRange !== false,
    };
  }

  async getRecentSessionMessages({ userId, sessionId, limit, userConfig = {} }) {
    const messages = await this.getSessionTurns({ userId, sessionId });
    const resolvedLimit = Number(
      limit || this._sessionContextConfig(userConfig).recentMessageLimit || 20,
    );
    if (resolvedLimit <= 0) return [];
    return messages.slice(-resolvedLimit);
  }

  async getMessagesSinceLastRunningTask({ userId, sessionId }) {
    const messages = await this.getSessionTurns({ userId, sessionId });
    if (!messages.length) return [];

    let startIndex = -1;
    for (
      let messageIndex = messages.length - 1;
      messageIndex >= 0;
      messageIndex -= 1
    ) {
      if ((messages[messageIndex]?.taskStatus || "") === "start") {
        startIndex = messageIndex;
        break;
      }
    }

    if (startIndex < 0) return [];
    return messages.slice(startIndex);
  }

  async getMessagesSinceLastCompletedTask({ userId, sessionId }) {
    const messages = await this.getSessionTurns({ userId, sessionId });
    if (!messages.length) return [];

    let startIndex = -1;
    for (
      let messageIndex = messages.length - 1;
      messageIndex >= 0;
      messageIndex -= 1
    ) {
      const status = String(messages[messageIndex]?.taskStatus || "");
      if (status === "completed") {
        startIndex = messageIndex;
        break;
      }
    }

    if (startIndex < 0) return [];
    return messages.slice(startIndex);
  }

  async startSkillTask({
    userId,
    sessionId,
    skillName,
    taskName = "",
    meta = {},
    parentSessionId = "",
  }) {
    const basePath = this._resolveBasePath(userId);
    return this.taskManager.startSkillTask({
      userId,
      sessionId,
      skillName,
      taskName,
      meta,
      parentSessionId,
      basePath,
    });
  }

  async finishSkillTask({
    userId,
    sessionId,
    taskId,
    result = "",
    parentSessionId = "",
  }) {
    const basePath = this._resolveBasePath(userId);
    return this.taskManager.finishSkillTask({
      userId,
      sessionId,
      taskId,
      result,
      parentSessionId,
      basePath,
    });
  }

  async saveCurrentTurnTasks({
    userId,
    sessionId,
    parentSessionId = "",
    currentTurnTasks = [],
  }) {
    const basePath = this._resolveBasePath(userId);
    return this.taskManager.saveCurrentTurnTasks({
      userId,
      sessionId,
      parentSessionId,
      currentTurnTasks,
      basePath,
    });
  }

  async getContextRecords({ userId, sessionId, userConfig = {} }) {
    const sessionContextConfig = this._sessionContextConfig(userConfig);

    if (sessionContextConfig.useLastCompletedTaskRange) {
      const messagesSinceCompletedTask = await this.getMessagesSinceLastCompletedTask({
        userId,
        sessionId,
      });
      if (messagesSinceCompletedTask.length) return messagesSinceCompletedTask;
    }

    if (sessionContextConfig.useLastRunningTaskRange) {
      const messagesSinceRunningTask = await this.getMessagesSinceLastRunningTask({
        userId,
        sessionId,
      });
      if (messagesSinceRunningTask.length) return messagesSinceRunningTask;
    }

    return this.getRecentSessionMessages({
      userId,
      sessionId,
      limit: sessionContextConfig.recentMessageLimit,
      userConfig,
    });
  }

  async setSessionModelAlias({ userId, sessionId, modelAlias }) {
    const basePath = this._resolveBasePath(userId);
    const { resolvedParentSessionId, sessionFile } = await this._resolveSessionScope(
      basePath,
      sessionId,
      "",
    );
    const sessionBundle = await this.getSessionBundle({
      userId,
      sessionId,
      parentSessionId: resolvedParentSessionId,
    });

    if (!sessionBundle?.exists || !sessionBundle?.session) return null;
    sessionBundle.session.modelAlias = String(modelAlias || "");
    sessionBundle.session.updatedAt = this._now();
    await this._writeJson(sessionFile, sessionBundle.session);
    return sessionBundle.session;
  }

  async getRootSessionSelectedConnectors({ userId, sessionId }) {
    const rootSessionId = await this.getRootSessionId({ userId, sessionId });
    if (!rootSessionId) return this._normalizeSelectedConnectors({});
    const sessionBundle = await this.getSessionBundle({
      userId,
      sessionId: rootSessionId,
    });
    if (!sessionBundle?.exists || !sessionBundle?.session) {
      return this._normalizeSelectedConnectors({});
    }
    return this._normalizeSelectedConnectors(
      sessionBundle.session.selectedConnectors || {},
    );
  }

  async setRootSessionSelectedConnectors({
    userId,
    sessionId,
    selectedConnectors = {},
  }) {
    const rootSessionId = await this.getRootSessionId({ userId, sessionId });
    if (!rootSessionId) return this._normalizeSelectedConnectors({});
    const basePath = this._resolveBasePath(userId);
    const { resolvedParentSessionId, sessionFile } = await this._resolveSessionScope(
      basePath,
      rootSessionId,
      "",
    );
    const sessionBundle = await this.getSessionBundle({
      userId,
      sessionId: rootSessionId,
      parentSessionId: resolvedParentSessionId,
    });
    if (!sessionBundle?.exists || !sessionBundle?.session) {
      return this._normalizeSelectedConnectors({});
    }
    sessionBundle.session.selectedConnectors = this._normalizeSelectedConnectors(
      selectedConnectors,
    );
    sessionBundle.session.updatedAt = this._now();
    await this._writeJson(sessionFile, sessionBundle.session);
    return sessionBundle.session.selectedConnectors;
  }

  async deleteSessionBranch({ userId, sessionId }) {
    const normalizedSessionId = String(sessionId || "").trim();
    if (!normalizedSessionId) {
      throw fatalSystemError("sessionId required", {
        code: "FATAL_SESSION_ID_REQUIRED",
      });
    }
    const basePath = this._resolveBasePath(userId);
    return await this._withSessionTreeLock(basePath, async () => {
      const sessionTree = this._normalizeSessionTreeShape(
        await this._readSessionTree(basePath),
      );
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
        let sessionDir = "";
        try {
          const sessionFile = await this._sessionFile(basePath, id);
          sessionDir = path.dirname(sessionFile);
        } catch {
          sessionDir = path.join(this._sessionRoot(basePath), id);
        }
        await rm(sessionDir, { recursive: true, force: true });
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
            updatedAt: this._now(),
          };
        }
        const nextTree = {
          roots: (sessionTree?.roots || []).filter(
            (rootId) => !deleteSet.has(String(rootId || "").trim()),
          ),
          nodes: nextNodes,
          updatedAt: this._now(),
        };
        await this._writeSessionTree(
          basePath,
          this._normalizeSessionTreeShape(nextTree),
        );
      }

      return {
        ok: true,
        sessionId: normalizedSessionId,
        deletedSessionIds,
      };
    });
  }
}
