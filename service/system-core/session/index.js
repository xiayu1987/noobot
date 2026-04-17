/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { mkdirSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { v4 as uuidv4 } from "uuid";
import { readJsonFile } from "../utils/json.js";
import { mergeConfig } from "../config/index.js";

export class SessionManager {
  constructor(globalConfig) {
    this.globalConfig = globalConfig;
  }

  _now() {
    return new Date().toISOString();
  }

  _resolveBasePath(userId = "") {
    const normalizedUserId = String(userId || "").trim();
    const workspaceRoot = String(this.globalConfig?.workspaceRoot || "").trim();
    if (!normalizedUserId || !workspaceRoot) {
      throw new Error("workspaceRoot/userId required");
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

  _sessionDir(basePath, sessionId) {
    return path.join(
      this._sessionRoot(basePath),
      ...this._loopSession(sessionId, this._readSessionTree(basePath), []).reverse(),
    );
  }

  _sessionFile(basePath, sessionId) {
    return path.join(this._sessionDir(basePath, sessionId), "session.json");
  }

  _taskFile(basePath, sessionId) {
    return path.join(this._sessionDir(basePath, sessionId), "task.json");
  }

  _executionFile(basePath, sessionId) {
    return path.join(this._sessionDir(basePath, sessionId), "execution.json");
  }

  _sessionTreeFile(basePath) {
    return path.join(this._sessionRoot(basePath), "session-tree.json");
  }

  _readJson(filePath, fallback = {}) {
    return readJsonFile(filePath, fallback);
  }

  _resolveParentSessionId(basePath, sessionId, parentSessionId = "") {
    const hintedParentSessionId = String(parentSessionId || "").trim();
    if (hintedParentSessionId) return hintedParentSessionId;

    const normalizedSessionId = String(sessionId || "").trim();
    if (!normalizedSessionId) return "";

    const tree = this._readSessionTree(basePath);
    return String(tree?.nodes?.[normalizedSessionId]?.parentSessionId || "").trim();
  }

  _resolveSessionScope(basePath, sessionId, parentSessionId = "") {
    const resolvedParentSessionId = this._resolveParentSessionId(
      basePath,
      sessionId,
      parentSessionId,
    );
    return {
      resolvedParentSessionId,
      sessionFile: this._sessionFile(basePath, sessionId, resolvedParentSessionId),
      taskFile: this._taskFile(basePath, sessionId, resolvedParentSessionId),
      executionFile: this._executionFile(
        basePath,
        sessionId,
        resolvedParentSessionId,
      ),
    };
  }

  _readExecutionBundle(basePath, sessionId, parentSessionId = "") {
    const { executionFile } = this._resolveSessionScope(
      basePath,
      sessionId,
      parentSessionId,
    );
    const executionBundle = this._readJson(executionFile, {
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

  _writeExecutionBundle(basePath, sessionId, parentSessionId = "", execution = {}) {
    const { executionFile } = this._resolveSessionScope(
      basePath,
      sessionId,
      parentSessionId,
    );
    this._writeJson(executionFile, execution);
  }

  _writeJson(filePath, data) {
    writeFileSync(filePath, JSON.stringify(data, null, 2));
  }

  _normalizeMessage(message = {}) {
    const normalizedMessage = {
      ...message,
      role: message?.role || "",
      content: message?.content || "",
      type: message?.type || "",
      dialogProcessId: message?.dialogProcessId || "",
      taskId: message?.taskId || "",
      taskStatus: message?.taskStatus || "",
      attachmentIds: Array.isArray(message?.attachmentIds)
        ? message.attachmentIds.filter(Boolean)
        : [],
      attachments: Array.isArray(message?.attachments)
        ? message.attachments
        : [],
      ts: message?.ts || this._now(),
    };
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

  _ensureRuntimeDirsByBasePath(basePath) {
    if (!existsSync(basePath)) return false;
    mkdirSync(this._sessionRoot(basePath), { recursive: true });
    return true;
  }

  _readSessionTree(basePath) {
    const ensured = this._ensureRuntimeDirsByBasePath(basePath);
    if (!ensured) {
      return { roots: [], nodes: {}, updatedAt: this._now() };
    }
    const sessionTreeFile = this._sessionTreeFile(basePath);
    if (!existsSync(sessionTreeFile)) {
      return { roots: [], nodes: {}, updatedAt: this._now() };
    }
    const sessionTreeData = this._readJson(sessionTreeFile, {
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

  _writeSessionTree(basePath, tree) {
    const ensured = this._ensureRuntimeDirsByBasePath(basePath);
    if (!ensured) {
      throw new Error(`workspace not initialized: ${basePath}`);
    }
    const payload = {
      roots: Array.isArray(tree?.roots) ? tree.roots : [],
      nodes: tree?.nodes && typeof tree.nodes === "object" ? tree.nodes : {},
      updatedAt: this._now(),
    };
    this._writeJson(this._sessionTreeFile(basePath), payload);
  }

  ensureRuntimeDirs(userId) {
    const basePath = this._resolveBasePath(userId);
    this._ensureRuntimeDirsByBasePath(basePath);
  }

  upsertSessionTree({ userId, sessionId, parentSessionId = "" }) {
    if (!sessionId) return;
    const basePath = this._resolveBasePath(userId);
    const sessionTree = this._readSessionTree(basePath);
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

    if (!normalizedParentSessionId) {
      if (!sessionTree.roots.includes(normalizedSessionId)) {
        sessionTree.roots.push(normalizedSessionId);
      }
    } else {
      if (!sessionTree.nodes[normalizedParentSessionId]) {
        sessionTree.nodes[normalizedParentSessionId] = {
          sessionId: normalizedParentSessionId,
          parentSessionId: "",
          children: [],
          createdAt: now,
          updatedAt: now,
        };
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

    this._writeSessionTree(basePath, sessionTree);
  }

  getSessionTree({ userId }) {
    const basePath = this._resolveBasePath(userId);
    return this._readSessionTree(basePath);
  }

  getSessionDepth({ userId, sessionId }) {
    const normalizedSessionId = String(sessionId || "").trim();
    if (!normalizedSessionId) return 0;
    const basePath = this._resolveBasePath(userId);
    const sessionTree = this._readSessionTree(basePath);
    if (sessionTree?.nodes?.[normalizedSessionId]) {
      return this._loopSession(normalizedSessionId, sessionTree, []).length;
    }
    const sessionBundle = this.getSessionBundle({
      userId,
      sessionId: normalizedSessionId,
    });
    return sessionBundle?.exists ? 1 : 0;
  }

  getSessionData({ userId, sessionId }) {
    const normalizedSessionId = String(sessionId || "").trim();
    const sessionBundle = this.getSessionBundle({
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
    const sessionTree = this._readSessionTree(basePath);
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
      const currentBundle = this.getSessionBundle({
        userId,
        sessionId: currentSessionId,
        parentSessionId: currentParentSessionId,
      });
      if (!currentBundle?.exists || !currentBundle?.session) continue;
      const depth = this.getSessionDepth({
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

  getAllSessionsData({ userId }) {
    const sessionTree = this.getSessionTree({ userId });
    const treeSessionIds = Object.keys(sessionTree?.nodes || {});
    const sessionIds = treeSessionIds.length
      ? treeSessionIds
      : this.listSessionIds({ userId });

    const sessionList = sessionIds.map((sessionId) => {
      const parentSessionId = String(
        sessionTree?.nodes?.[sessionId]?.parentSessionId || "",
      );
      const sessionBundle = this.getSessionBundle({
        userId,
        sessionId,
        parentSessionId,
      });
      if (!sessionBundle?.exists || !sessionBundle?.session) return null;
      return {
        ...sessionBundle.session,
        sessionId,
        parentSessionId,
        depth: this.getSessionDepth({ userId, sessionId }),
      };
    }).filter(Boolean);

    sessionList.sort(
      (leftSession, rightSession) =>
        new Date(rightSession.updatedAt || 0).getTime() -
        new Date(leftSession.updatedAt || 0).getTime(),
    );
    return sessionList;
  }

  listSessionIds({ userId }) {
    const basePath = this._resolveBasePath(userId);
    this._ensureRuntimeDirsByBasePath(basePath);
    return readdirSync(this._sessionRoot(basePath), { withFileTypes: true })
      .filter((dirEntry) => dirEntry.isDirectory())
      .map((dirEntry) => dirEntry.name);
  }

  ensureSession(userId, sessionId, parentSessionId = "", meta = {}) {
    const basePath = this._resolveBasePath(userId);
    this._ensureRuntimeDirsByBasePath(basePath);
    const resolvedParentSessionId = this._resolveParentSessionId(
      basePath,
      sessionId,
      parentSessionId,
    );
    const sessionDir = this._sessionDir(basePath, sessionId, resolvedParentSessionId);
    mkdirSync(sessionDir, { recursive: true });

    const sessionFile = this._sessionFile(basePath, sessionId, resolvedParentSessionId);
    if (!existsSync(sessionFile)) {
      this._writeJson(sessionFile, {
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

    const taskFile = this._taskFile(basePath, sessionId, resolvedParentSessionId);
    if (!existsSync(taskFile)) {
      this._writeJson(taskFile, {
        sessionId,
        currentTaskId: "",
        tasks: [],
        updatedAt: this._now(),
      });
    }

    const executionFile = this._executionFile(
      basePath,
      sessionId,
      resolvedParentSessionId,
    );
    if (!existsSync(executionFile)) {
      this._writeJson(executionFile, {
        sessionId,
        logs: [],
        updatedAt: this._now(),
      });
    }
  }

  createSession({
    userId,
    sessionId,
    parentSessionId = "",
    caller = "user",
    modelAlias = "",
  }) {
    this.ensureSession(userId, sessionId, parentSessionId, {
      caller,
      modelAlias,
    });
    return this.getSessionBundle({ userId, sessionId, parentSessionId });
  }

  getSessionBundle({ userId, sessionId, parentSessionId = "" }) {
    const basePath = this._resolveBasePath(userId);
    const resolvedParentSessionId = this._resolveParentSessionId(
      basePath,
      sessionId,
      parentSessionId,
    );
    const sessionFile = this._sessionFile(basePath, sessionId, resolvedParentSessionId);
    const taskFile = this._taskFile(basePath, sessionId, resolvedParentSessionId);

    if (!existsSync(sessionFile)) {
      return { exists: false, session: null, task: null };
    }

    const session = this._readJson(sessionFile, {});
    session.parentSessionId = session.parentSessionId || resolvedParentSessionId || "";
    session.caller = session.caller || "user";
    session.modelAlias = session.modelAlias || "";

    const normalizedMessages = this._normalizeMessages(session.messages || []);
    const beforeJson = JSON.stringify(session.messages || []);
    const afterJson = JSON.stringify(normalizedMessages);
    session.messages = normalizedMessages;
    if (beforeJson !== afterJson) {
      session.updatedAt = session.updatedAt || this._now();
      this._writeJson(sessionFile, session);
    }

    return {
      exists: true,
      session,
      task: this._readJson(taskFile, {
        sessionId,
        currentTaskId: "",
        tasks: [],
      }),
    };
  }

  appendTurn({
    userId,
    sessionId,
    role,
    content,
    type = "",
    taskId = null,
    taskStatus = null,
    dialogProcessId = "",
    tool_calls = null,
    tool_call_id = "",
    attachmentIds = [],
    attachments = [],
    parentSessionId = "",
  }) {
    const basePath = this._resolveBasePath(userId);
    const resolvedParentSessionId = this._resolveParentSessionId(
      basePath,
      sessionId,
      parentSessionId,
    );
    this.ensureSession(userId, sessionId, resolvedParentSessionId);
    const sessionBundle = this.getSessionBundle({
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
      taskId: resolvedTaskId,
      taskStatus: resolvedTaskStatus,
      ts: this._now(),
    });

    if (tool_call_id) turn.tool_call_id = tool_call_id;
    if (Array.isArray(tool_calls) && tool_calls.length) {
      turn.tool_calls = tool_calls;
    }
    if (Array.isArray(attachmentIds) && attachmentIds.length) {
      turn.attachmentIds = attachmentIds.filter(Boolean);
    }
    if (Array.isArray(attachments) && attachments.length) {
      turn.attachments = attachments;
    }

    sessionBundle.session.messages.push(turn);
    sessionBundle.session.updatedAt = this._now();
    if (sessionBundle.session.shortMemoryCheckpoint === undefined) {
      sessionBundle.session.shortMemoryCheckpoint = 0;
    }

    this._writeJson(
      this._sessionFile(basePath, sessionId, resolvedParentSessionId),
      sessionBundle.session,
    );
  }

  getSessionTurns({ userId, sessionId }) {
    const sessionBundle = this.getSessionBundle({ userId, sessionId });
    return sessionBundle.session?.messages || [];
  }

  getExecutionBundle({ userId, sessionId }) {
    const basePath = this._resolveBasePath(userId);
    const resolvedParentSessionId = this._resolveParentSessionId(basePath, sessionId);
    this.ensureSession(userId, sessionId, resolvedParentSessionId);
    return this._readExecutionBundle(basePath, sessionId, resolvedParentSessionId);
  }

  appendExecutionLog({
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
    const { resolvedParentSessionId } = this._resolveSessionScope(
      basePath,
      sessionId,
      parentSessionId,
    );
    const executionBundle = this._readExecutionBundle(
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
    this._writeExecutionBundle(
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

  getRecentSessionMessages({ userId, sessionId, limit, userConfig = {} }) {
    const messages = this.getSessionTurns({ userId, sessionId });
    const resolvedLimit = Number(
      limit || this._sessionContextConfig(userConfig).recentMessageLimit || 20,
    );
    if (resolvedLimit <= 0) return [];
    return messages.slice(-resolvedLimit);
  }

  getMessagesSinceLastRunningTask({ userId, sessionId }) {
    const messages = this.getSessionTurns({ userId, sessionId });
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

  getMessagesSinceLastCompletedTask({ userId, sessionId }) {
    const messages = this.getSessionTurns({ userId, sessionId });
    if (!messages.length) return [];

    let startIndex = -1;
    for (
      let messageIndex = messages.length - 1;
      messageIndex >= 0;
      messageIndex -= 1
    ) {
      if ((messages[messageIndex]?.taskStatus || "") === "completed") {
        startIndex = messageIndex;
        break;
      }
    }

    if (startIndex < 0) return [];
    return messages.slice(startIndex);
  }

  startSkillTask({
    userId,
    sessionId,
    skillName,
    taskName = "",
    meta = {},
    parentSessionId = "",
  }) {
    const basePath = this._resolveBasePath(userId);
    const { resolvedParentSessionId, sessionFile, taskFile } =
      this._resolveSessionScope(basePath, sessionId, parentSessionId);

    this.ensureSession(userId, sessionId, resolvedParentSessionId);
    const sessionBundle = this.getSessionBundle({
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

    this._writeJson(taskFile, sessionBundle.task);
    this._writeJson(sessionFile, sessionBundle.session);
    return task;
  }

  finishSkillTask({
    userId,
    sessionId,
    taskId,
    result = "",
    parentSessionId = "",
  }) {
    const basePath = this._resolveBasePath(userId);
    const { resolvedParentSessionId, sessionFile, taskFile } =
      this._resolveSessionScope(basePath, sessionId, parentSessionId);

    this.ensureSession(userId, sessionId, resolvedParentSessionId);
    const sessionBundle = this.getSessionBundle({
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

    this._writeJson(taskFile, sessionBundle.task);
    this._writeJson(sessionFile, sessionBundle.session);
    return task;
  }

  getContextRecords({ userId, sessionId, userConfig = {} }) {
    const sessionContextConfig = this._sessionContextConfig(userConfig);

    if (sessionContextConfig.useLastCompletedTaskRange) {
      const messagesSinceCompletedTask = this.getMessagesSinceLastCompletedTask({
        userId,
        sessionId,
      });
      if (messagesSinceCompletedTask.length) return messagesSinceCompletedTask;
    }

    if (sessionContextConfig.useLastRunningTaskRange) {
      const messagesSinceRunningTask = this.getMessagesSinceLastRunningTask({
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

  setSessionModelAlias({ userId, sessionId, modelAlias }) {
    const basePath = this._resolveBasePath(userId);
    const { resolvedParentSessionId, sessionFile } = this._resolveSessionScope(
      basePath,
      sessionId,
      "",
    );
    const sessionBundle = this.getSessionBundle({
      userId,
      sessionId,
      parentSessionId: resolvedParentSessionId,
    });

    if (!sessionBundle?.exists || !sessionBundle?.session) return null;
    sessionBundle.session.modelAlias = String(modelAlias || "");
    sessionBundle.session.updatedAt = this._now();
    this._writeJson(sessionFile, sessionBundle.session);
    return sessionBundle.session;
  }
}
