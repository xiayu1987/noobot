/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { v4 as uuidv4 } from "uuid";

export class TaskManager {
  constructor({
    now = () => new Date().toISOString(),
    resolveSessionScope,
    ensureSession,
    getSessionBundle,
    writeJson,
    normalizeTaskItem,
  } = {}) {
    this.now = now;
    this.resolveSessionScope = resolveSessionScope;
    this.ensureSession = ensureSession;
    this.getSessionBundle = getSessionBundle;
    this.writeJson = writeJson;
    this.normalizeTaskItem = normalizeTaskItem;
  }

  async startSkillTask({
    userId,
    sessionId,
    skillName,
    taskName = "",
    meta = {},
    parentSessionId = "",
    basePath,
  }) {
    const { resolvedParentSessionId, sessionFile, taskFile } =
      await this.resolveSessionScope(basePath, sessionId, parentSessionId);

    await this.ensureSession(userId, sessionId, resolvedParentSessionId);
    const sessionBundle = await this.getSessionBundle({
      userId,
      sessionId,
      parentSessionId: resolvedParentSessionId,
    });

    const now = this.now();
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

    await this.writeJson(taskFile, sessionBundle.task);
    await this.writeJson(sessionFile, sessionBundle.session);
    return task;
  }

  async finishSkillTask({
    userId,
    sessionId,
    taskId,
    result = "",
    parentSessionId = "",
    basePath,
  }) {
    const { resolvedParentSessionId, sessionFile, taskFile } =
      await this.resolveSessionScope(basePath, sessionId, parentSessionId);

    await this.ensureSession(userId, sessionId, resolvedParentSessionId);
    const sessionBundle = await this.getSessionBundle({
      userId,
      sessionId,
      parentSessionId: resolvedParentSessionId,
    });

    const now = this.now();
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

    await this.writeJson(taskFile, sessionBundle.task);
    await this.writeJson(sessionFile, sessionBundle.session);
    return task;
  }

  async saveCurrentTurnTasks({
    userId,
    sessionId,
    parentSessionId = "",
    currentTurnTasks = [],
    basePath,
  }) {
    const { resolvedParentSessionId, sessionFile, taskFile } =
      await this.resolveSessionScope(basePath, sessionId, parentSessionId);
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
      .map((task) => this.normalizeTaskItem(task))
      .filter((task) => task.taskId);
    if (!normalizedTurnTasks.length) return sessionBundle.task;

    const existingTasks = Array.isArray(sessionBundle.task?.tasks)
      ? sessionBundle.task.tasks.map((task) => this.normalizeTaskItem(task))
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
    const now = this.now();

    sessionBundle.task.tasks = existingTasks;
    sessionBundle.task.currentTaskId = currentTaskId;
    sessionBundle.task.updatedAt = now;

    sessionBundle.session.currentTaskId = currentTaskId;
    sessionBundle.session.updatedAt = now;

    await this.writeJson(taskFile, sessionBundle.task);
    await this.writeJson(sessionFile, sessionBundle.session);
    return sessionBundle.task;
  }
}
