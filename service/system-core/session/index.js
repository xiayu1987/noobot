/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  access,
  mkdir,
  readdir,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { v4 as uuidv4 } from "uuid";
import { mergeConfig } from "../config/index.js";
import { fatalSystemError } from "../error/index.js";

export class SessionManager {
  constructor(globalConfig) {
    this.globalConfig = globalConfig;
    this._sessionTreeLocks = new Map();
  }

  _now() {
    return new Date().toISOString();
  }

  _resolveBasePath(userId = "") {
    const normalizedUserId = String(userId || "").trim();
    const workspaceRoot = String(this.globalConfig?.workspaceRoot || "").trim();
    if (!normalizedUserId || !workspaceRoot) {
      throw fatalSystemError("workspaceRoot/userId required", {
        code: "FATAL_WORKSPACE_PATH_INVALID",
        details: { userId: normalizedUserId, workspaceRoot },
      });
    }
    return path.resolve(workspaceRoot, normalizedUserId);
  }

  _sessionRoot(basePath) {
    return path.join(basePath, "runtime/session");
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
    const normalizedSessionId = String(sessionId || "").trim();
    if (!normalizedSessionId) return "";
    const nodes =
      tree?.nodes && typeof tree.nodes === "object" ? tree.nodes : {};
    if (!nodes?.[normalizedSessionId]) return normalizedSessionId;
    const chain = this._loopSession(normalizedSessionId, tree, []);
    return String(chain?.[chain.length - 1] || normalizedSessionId).trim();
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
    return path.join(this._sessionRoot(basePath), "session-tree.json");
  }

  async _readJson(filePath, fallback = {}) {
    try {
      const raw = await readFile(filePath, "utf8");
      return JSON.parse(raw);
    } catch {
      return fallback;
    }
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
    const { executionFile } = await this._resolveSessionScope(
      basePath,
      sessionId,
      parentSessionId,
    );
    const executionBundle = await this._readJson(executionFile, {
      sessionId,
      logs: [],
      updatedAt: this._now(),
    });
    executionBundle.sessionId = executionBundle.sessionId || sessionId;
    executionBundle.logs = Array.isArray(executionBundle.logs)
      ? executionBundle.logs
      : [];
    executionBundle.updatedAt = executionBundle.updatedAt || this._now();
    return executionBundle;
  }

  async _writeExecutionBundle(
    basePath,
    sessionId,
    parentSessionId = "",
    execution = {},
  ) {
    const { executionFile } = await this._resolveSessionScope(
      basePath,
      sessionId,
      parentSessionId,
    );
    await this._writeJson(executionFile, execution);
  }

  async _writeJson(filePath, data) {
    await writeFile(filePath, JSON.stringify(data, null, 2));
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
    try {
      await access(basePath);
    } catch {
      return false;
    }
    await mkdir(this._sessionRoot(basePath), { recursive: true });
    return true;
  }

  async _readSessionTree(basePath) {
    const ensured = await this._ensureRuntimeDirsByBasePath(basePath);
    if (!ensured) {
      return { roots: [], nodes: {}, updatedAt: this._now() };
    }
    const sessionTreeFile = this._sessionTreeFile(basePath);
    const sessionTreeData = await this._readJson(sessionTreeFile, {
      roots: [],
      nodes: {},
      updatedAt: this._now(),
    });
    return {
      roots: Array.isArray(sessionTreeData?.roots) ? sessionTreeData.roots : [],
      nodes:
        sessionTreeData?.nodes && typeof sessionTreeData.nodes === "object"
          ? sessionTreeData.nodes
          : {},
      updatedAt: sessionTreeData?.updatedAt || this._now(),
    };
  }

  async _writeSessionTree(basePath, tree) {
    const ensured = await this._ensureRuntimeDirsByBasePath(basePath);
    if (!ensured) {
      throw fatalSystemError(`workspace not initialized: ${basePath}`, {
        code: "FATAL_WORKSPACE_NOT_INITIALIZED",
        details: { basePath },
      });
    }
    const payload = {
      roots: Array.isArray(tree?.roots) ? tree.roots : [],
      nodes: tree?.nodes && typeof tree.nodes === "object" ? tree.nodes : {},
      updatedAt: this._now(),
    };
    const treeFile = this._sessionTreeFile(basePath);
    const tempFile = `${treeFile}.tmp-${process.pid}-${Date.now()}`;
    await writeFile(tempFile, JSON.stringify(payload, null, 2), "utf8");
    await rename(tempFile, treeFile);
  }

  _normalizeSessionTreeShape(tree = {}) {
    const nodes =
      tree?.nodes && typeof tree.nodes === "object" ? { ...tree.nodes } : {};
    for (const [nodeId, node] of Object.entries(nodes)) {
      const normalizedNodeId = String(nodeId || "").trim();
      if (!normalizedNodeId) {
        delete nodes[nodeId];
        continue;
      }
      const normalizedChildren = Array.isArray(node?.children)
        ? Array.from(
            new Set(
              node.children
                .map((childId) => String(childId || "").trim())
                .filter(Boolean),
            ),
          )
        : [];
      nodes[normalizedNodeId] = {
        ...node,
        sessionId: normalizedNodeId,
        parentSessionId: String(node?.parentSessionId || "").trim(),
        children: normalizedChildren,
      };
      if (normalizedNodeId !== nodeId) delete nodes[nodeId];
    }

    const roots = Object.values(nodes)
      .filter((node) => !String(node?.parentSessionId || "").trim())
      .map((node) => String(node?.sessionId || "").trim())
      .filter(Boolean);

    return {
      roots: Array.from(new Set(roots)),
      nodes,
      updatedAt: tree?.updatedAt || this._now(),
    };
  }

  async _withSessionTreeLock(basePath, run) {
    const lockKey = String(basePath || "");
    const previousLock = this._sessionTreeLocks.get(lockKey) || Promise.resolve();
    let releaseCurrentLock = () => {};
    const currentLock = new Promise((resolve) => {
      releaseCurrentLock = resolve;
    });
    const lockMarker = previousLock.then(() => currentLock);
    this._sessionTreeLocks.set(lockKey, lockMarker);

    await previousLock;
    try {
      return await run();
    } finally {
      releaseCurrentLock();
      if (this._sessionTreeLocks.get(lockKey) === lockMarker) {
        this._sessionTreeLocks.delete(lockKey);
      }
    }
  }

  async ensureRuntimeDirs(userId) {
    const basePath = this._resolveBasePath(userId);
    await this._ensureRuntimeDirsByBasePath(basePath);
  }

  async upsertSessionTree({ userId, sessionId, parentSessionId = "" }) {
    if (!sessionId) return;
    const basePath = this._resolveBasePath(userId);
    await this._withSessionTreeLock(basePath, async () => {
      const sessionTree = this._normalizeSessionTreeShape(
        await this._readSessionTree(basePath),
      );
      const now = this._now();
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
            `parent session not found (possibly deleted): ${normalizedParentSessionId}`,
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
        sessionTree.roots = sessionTree.roots.filter(
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

      await this._writeSessionTree(
        basePath,
        this._normalizeSessionTreeShape(sessionTree),
      );
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
    await this._ensureRuntimeDirsByBasePath(basePath);
    const resolvedParentSessionId = await this._resolveParentSessionId(
      basePath,
      sessionId,
      parentSessionId,
    );
    const sessionDir = await this._sessionDir(
      basePath,
      sessionId,
      resolvedParentSessionId,
    );
    await mkdir(sessionDir, { recursive: true });

    const sessionFile = await this._sessionFile(
      basePath,
      sessionId,
      resolvedParentSessionId,
    );
    let sessionExists = true;
    try {
      await access(sessionFile);
    } catch {
      sessionExists = false;
    }
    if (!sessionExists) {
      await this._writeJson(sessionFile, {
        sessionId,
        parentSessionId: resolvedParentSessionId || "",
        caller: meta?.caller || "user",
        modelAlias: meta?.modelAlias || "",
        currentTaskId: "",
        shortMemoryCheckpoint: 0,
        messages: [],
        createdAt: this._now(),
        updatedAt: this._now(),
      });
    }

    const taskFile = await this._taskFile(
      basePath,
      sessionId,
      resolvedParentSessionId,
    );
    let taskExists = true;
    try {
      await access(taskFile);
    } catch {
      taskExists = false;
    }
    if (!taskExists) {
      await this._writeJson(taskFile, {
        sessionId,
        currentTaskId: "",
        tasks: [],
        updatedAt: this._now(),
      });
    }

    const executionFile = await this._executionFile(
      basePath,
      sessionId,
      resolvedParentSessionId,
    );
    let executionExists = true;
    try {
      await access(executionFile);
    } catch {
      executionExists = false;
    }
    if (!executionExists) {
      await this._writeJson(executionFile, {
        sessionId,
        logs: [],
        updatedAt: this._now(),
      });
    }
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
    const resolvedParentSessionId = await this._resolveParentSessionId(
      basePath,
      sessionId,
      parentSessionId,
    );
    const sessionFile = await this._sessionFile(
      basePath,
      sessionId,
      resolvedParentSessionId,
    );
    const taskFile = await this._taskFile(
      basePath,
      sessionId,
      resolvedParentSessionId,
    );

    try {
      await access(sessionFile);
    } catch {
      return { exists: false, session: null, task: null };
    }

    const session = await this._readJson(sessionFile, {});
    session.parentSessionId = session.parentSessionId || resolvedParentSessionId || "";
    session.caller = session.caller || "user";
    session.modelAlias = session.modelAlias || "";

    const normalizedMessages = this._normalizeMessages(session.messages || []);
    const beforeJson = JSON.stringify(session.messages || []);
    const afterJson = JSON.stringify(normalizedMessages);
    session.messages = normalizedMessages;
    if (beforeJson !== afterJson) {
      session.updatedAt = session.updatedAt || this._now();
      await this._writeJson(sessionFile, session);
    }

    return {
      exists: true,
      session,
      task: await this._readJson(taskFile, {
        sessionId,
        currentTaskId: "",
        tasks: [],
      }),
    };
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
    const resolvedParentSessionId = await this._resolveParentSessionId(
      basePath,
      sessionId,
      parentSessionId,
    );
    await this.ensureSession(userId, sessionId, resolvedParentSessionId);
    const sessionBundle = await this.getSessionBundle({
      userId,
      sessionId,
      parentSessionId: resolvedParentSessionId,
    });

    const resolvedTaskId = taskId ?? sessionBundle.session?.currentTaskId ?? "";
    const resolvedTaskStatus = taskStatus ?? (resolvedTaskId ? "start" : "");

    sessionBundle.session.messages = this._normalizeMessages(
      sessionBundle.session.messages || [],
    );

    const turn = this._normalizeMessage({
      role,
      content,
      type: type || "",
      dialogProcessId: dialogProcessId || "",
      parentDialogProcessId: parentDialogProcessId || "",
      taskId: resolvedTaskId,
      taskStatus: resolvedTaskStatus,
      modelAlias: String(modelAlias || "").trim(),
      modelName: String(modelName || "").trim(),
      ts: this._now(),
    });

    if (tool_call_id) turn.tool_call_id = tool_call_id;
    if (Array.isArray(tool_calls) && tool_calls.length) {
      turn.tool_calls = tool_calls;
    }
    if (Array.isArray(attachmentMetas) && attachmentMetas.length) {
      turn.attachmentMetas = attachmentMetas;
    }

    sessionBundle.session.messages.push(turn);
    sessionBundle.session.updatedAt = this._now();
    if (sessionBundle.session.shortMemoryCheckpoint === undefined) {
      sessionBundle.session.shortMemoryCheckpoint = 0;
    }

    await this._writeJson(
      await this._sessionFile(basePath, sessionId, resolvedParentSessionId),
      sessionBundle.session,
    );
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
    const { resolvedParentSessionId } = await this._resolveSessionScope(
      basePath,
      sessionId,
      parentSessionId,
    );
    const executionBundle = await this._readExecutionBundle(
      basePath,
      sessionId,
      resolvedParentSessionId,
    );
    executionBundle.logs.push({
      dialogProcessId,
      event,
      category,
      type,
      data: data || {},
      ts: ts || this._now(),
    });
    executionBundle.updatedAt = this._now();
    await this._writeExecutionBundle(
      basePath,
      sessionId,
      resolvedParentSessionId,
      executionBundle,
    );
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
    const { resolvedParentSessionId, sessionFile, taskFile } =
      await this._resolveSessionScope(basePath, sessionId, parentSessionId);

    await this.ensureSession(userId, sessionId, resolvedParentSessionId);
    const sessionBundle = await this.getSessionBundle({
      userId,
      sessionId,
      parentSessionId: resolvedParentSessionId,
    });

    const now = this._now();
    const previousTaskId =
      sessionBundle.task.currentTaskId || sessionBundle.session.currentTaskId || "";
    if (previousTaskId) {
      const previousTask = (sessionBundle.task.tasks || []).find(
        (taskItem) => taskItem.taskId === previousTaskId,
      );
      if (previousTask && previousTask.status !== "completed") {
        previousTask.status = "completed";
        previousTask.endedAt = now;
      }
    }

    const taskId = uuidv4();
    const task = {
      taskId,
      skillName,
      taskName: taskName || `task-${skillName || "unknown"}`,
      status: "start",
      startedAt: now,
      endedAt: "",
      meta,
    };

    sessionBundle.task.tasks = sessionBundle.task.tasks || [];
    sessionBundle.task.tasks.push(task);
    sessionBundle.task.currentTaskId = taskId;
    sessionBundle.task.updatedAt = now;

    sessionBundle.session.currentTaskId = taskId;
    if (sessionBundle.session.messages?.length) {
      const lastMessage =
        sessionBundle.session.messages[sessionBundle.session.messages.length - 1];
      lastMessage.taskId = taskId;
      lastMessage.taskStatus = "start";
    }
    sessionBundle.session.updatedAt = now;

    await this._writeJson(taskFile, sessionBundle.task);
    await this._writeJson(sessionFile, sessionBundle.session);
    return task;
  }

  async finishSkillTask({
    userId,
    sessionId,
    taskId,
    result = "",
    parentSessionId = "",
  }) {
    const basePath = this._resolveBasePath(userId);
    const { resolvedParentSessionId, sessionFile, taskFile } =
      await this._resolveSessionScope(basePath, sessionId, parentSessionId);

    await this.ensureSession(userId, sessionId, resolvedParentSessionId);
    const sessionBundle = await this.getSessionBundle({
      userId,
      sessionId,
      parentSessionId: resolvedParentSessionId,
    });

    const now = this._now();
    const currentTaskId =
      taskId ||
      sessionBundle.task.currentTaskId ||
      sessionBundle.session.currentTaskId;
    if (!currentTaskId) return null;

    const task = (sessionBundle.task.tasks || []).find(
      (taskItem) => taskItem.taskId === currentTaskId,
    );
    if (!task) return null;

    task.status = "completed";
    task.endedAt = now;
    if (result) task.result = result;

    if (sessionBundle.task.currentTaskId === currentTaskId) {
      sessionBundle.task.currentTaskId = "";
    }
    sessionBundle.task.updatedAt = now;

    if (sessionBundle.session.currentTaskId === currentTaskId) {
      sessionBundle.session.currentTaskId = "";
    }
    if (sessionBundle.session.messages?.length) {
      const lastMessage =
        sessionBundle.session.messages[sessionBundle.session.messages.length - 1];
      lastMessage.taskStatus = "completed";
    }
    sessionBundle.session.updatedAt = now;

    await this._writeJson(taskFile, sessionBundle.task);
    await this._writeJson(sessionFile, sessionBundle.session);
    return task;
  }

  async saveCurrentTurnTasks({
    userId,
    sessionId,
    parentSessionId = "",
    currentTurnTasks = [],
  }) {
    const basePath = this._resolveBasePath(userId);
    const { resolvedParentSessionId, sessionFile, taskFile } =
      await this._resolveSessionScope(basePath, sessionId, parentSessionId);
    await this.ensureSession(userId, sessionId, resolvedParentSessionId);
    const sessionBundle = await this.getSessionBundle({
      userId,
      sessionId,
      parentSessionId: resolvedParentSessionId,
    });

    const normalizedTurnTasks = (Array.isArray(currentTurnTasks)
      ? currentTurnTasks
      : []
    )
      .map((task) => this._normalizeTaskItem(task))
      .filter((task) => task.taskId);
    if (!normalizedTurnTasks.length) return sessionBundle.task;

    const existingTasks = Array.isArray(sessionBundle.task?.tasks)
      ? sessionBundle.task.tasks.map((task) => this._normalizeTaskItem(task))
      : [];
    const taskIndexMap = new Map(
      existingTasks.map((task, index) => [task.taskId, index]),
    );
    for (const task of normalizedTurnTasks) {
      const existingIndex = taskIndexMap.get(task.taskId);
      if (existingIndex === undefined) {
        existingTasks.push(task);
        taskIndexMap.set(task.taskId, existingTasks.length - 1);
      } else {
        existingTasks[existingIndex] = {
          ...existingTasks[existingIndex],
          ...task,
        };
      }
    }

    const lastTask = normalizedTurnTasks[normalizedTurnTasks.length - 1] || null;
    const currentTaskId = String(lastTask?.taskId || "").trim();
    const now = this._now();

    sessionBundle.task.tasks = existingTasks;
    sessionBundle.task.currentTaskId = currentTaskId;
    sessionBundle.task.updatedAt = now;

    sessionBundle.session.currentTaskId = currentTaskId;
    sessionBundle.session.updatedAt = now;

    await this._writeJson(taskFile, sessionBundle.task);
    await this._writeJson(sessionFile, sessionBundle.session);
    return sessionBundle.task;
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
