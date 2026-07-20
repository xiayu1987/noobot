/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { v4 as uuidv4 } from "uuid";

export class TaskService {
  constructor({
    taskRepo,
    sessionRepo,
    now = () => new Date().toISOString(),
  } = {}) {
    this.taskRepo = taskRepo;
    this.sessionRepo = sessionRepo;
    this.now = now;
  }

  async _resolveParentSessionId(userId, sessionId, parentSessionId = "", persistenceContext = null) {
    if (typeof this.sessionRepo?.resolveSessionScope === "function") {
      const scope = await this.sessionRepo.resolveSessionScope(userId, sessionId, parentSessionId, persistenceContext);
      return scope?.resolvedParentSessionId || "";
    }
    return this.sessionRepo.resolveParentSessionId(userId, sessionId, parentSessionId);
  }

  async _withSessionMutation(userId, sessionId, parentSessionId, operation, persistenceContext = null) {
    if (typeof this.sessionRepo?.withSessionMutation === "function") {
      return this.sessionRepo.withSessionMutation(userId, sessionId, parentSessionId, operation, persistenceContext);
    }
    return operation();
  }

  async startSkillTask({
    userId,
    sessionId,
    skillName,
    taskName = "",
    meta = {},
    parentSessionId = "",
    persistenceContext = null,
  }) {
    return this._withSessionMutation(userId, sessionId, parentSessionId, async () => {
    const resolvedParentSessionId = await this._resolveParentSessionId(
      userId,
      sessionId,
      parentSessionId,
      persistenceContext,
    );
    await this.sessionRepo.ensureSession({
      userId,
      sessionId,
      parentSessionId: resolvedParentSessionId,
      persistenceContext,
    });
    const session = await this.sessionRepo.findById(
      userId,
      sessionId,
      resolvedParentSessionId,
      persistenceContext,
    );
    if (!session) return null;

    const taskBundle = await this.taskRepo.getBundle(
      userId,
      sessionId,
      resolvedParentSessionId,
      persistenceContext,
    );
    const now = this.now();

    const previousTaskId = taskBundle.currentTaskId || session.currentTaskId || "";
    if (previousTaskId) {
      const previousTask = (taskBundle.tasks || []).find(
        (taskItem) => taskItem.taskId === previousTaskId,
      );
      if (previousTask && previousTask.taskStatus !== "completed") {
        previousTask.taskStatus = "completed";
        previousTask.endedAt = now;
      }
    }

    const taskId = uuidv4();
    const task = {
      taskId,
      skillName,
      taskName: taskName || `task-${skillName || "unknown"}`,
      taskStatus: "start",
      startedAt: now,
      endedAt: "",
      result: "",
      meta,
    };

    await this.taskRepo.save(userId, sessionId, task, resolvedParentSessionId, persistenceContext);

    session.currentTaskId = taskId;
    if (session.messages?.length) {
      const lastMessage = session.messages[session.messages.length - 1];
      lastMessage.taskId = taskId;
      lastMessage.taskStatus = "start";
    }
    await this.sessionRepo.save(userId, session, resolvedParentSessionId, { persistenceContext });
    return task;
    }, persistenceContext);
  }

  async finishSkillTask({
    userId,
    sessionId,
    taskId,
    result = "",
    parentSessionId = "",
    persistenceContext = null,
  }) {
    return this._withSessionMutation(userId, sessionId, parentSessionId, async () => {
    const resolvedParentSessionId = await this._resolveParentSessionId(
      userId,
      sessionId,
      parentSessionId,
      persistenceContext,
    );
    await this.sessionRepo.ensureSession({
      userId,
      sessionId,
      parentSessionId: resolvedParentSessionId,
      persistenceContext,
    });

    const session = await this.sessionRepo.findById(
      userId,
      sessionId,
      resolvedParentSessionId,
      persistenceContext,
    );
    if (!session) return null;

    const taskBundle = await this.taskRepo.getBundle(
      userId,
      sessionId,
      resolvedParentSessionId,
      persistenceContext,
    );

    const currentTaskId = taskId || taskBundle.currentTaskId || session.currentTaskId;
    if (!currentTaskId) return null;
    const task = (taskBundle.tasks || []).find(
      (taskItem) => taskItem.taskId === currentTaskId,
    );
    if (!task) return null;

    task.taskStatus = "completed";
    task.endedAt = this.now();
    if (result) task.result = result;

    const nextCurrentTaskId =
      String(taskBundle.currentTaskId || "").trim() === currentTaskId ? "" : taskBundle.currentTaskId;
    await this.taskRepo.saveBatch(
      userId,
      sessionId,
      taskBundle.tasks,
      resolvedParentSessionId,
      nextCurrentTaskId,
      persistenceContext,
    );

    if (String(session.currentTaskId || "").trim() === currentTaskId) {
      session.currentTaskId = "";
    }
    if (session.messages?.length) {
      const lastMessage = session.messages[session.messages.length - 1];
      lastMessage.taskStatus = "completed";
    }
    await this.sessionRepo.save(userId, session, resolvedParentSessionId, { persistenceContext });
    return task;
    }, persistenceContext);
  }

  async saveCurrentTurnTasks({
    userId,
    sessionId,
    parentSessionId = "",
    currentTurnTasks = [],
    persistenceContext = null,
  }) {
    return this._withSessionMutation(userId, sessionId, parentSessionId, async () => {
    const resolvedParentSessionId = await this._resolveParentSessionId(
      userId,
      sessionId,
      parentSessionId,
      persistenceContext,
    );
    await this.sessionRepo.ensureSession({
      userId,
      sessionId,
      parentSessionId: resolvedParentSessionId,
      persistenceContext,
    });

    const session = await this.sessionRepo.findById(
      userId,
      sessionId,
      resolvedParentSessionId,
      persistenceContext,
    );
    if (!session) return null;

    const normalizedTurnTasks = (Array.isArray(currentTurnTasks)
      ? currentTurnTasks
      : []
    ).filter((task) => String(task?.taskId || "").trim());

    const lastTask = normalizedTurnTasks[normalizedTurnTasks.length - 1] || null;
    const currentTaskId = String(lastTask?.taskId || "").trim();

    await this.taskRepo.saveBatch(
      userId,
      sessionId,
      normalizedTurnTasks,
      resolvedParentSessionId,
      currentTaskId,
      persistenceContext,
    );

    session.currentTaskId = currentTaskId;
    await this.sessionRepo.save(userId, session, resolvedParentSessionId, { persistenceContext });

    return this.taskRepo.getBundle(userId, sessionId, resolvedParentSessionId, persistenceContext);
    }, persistenceContext);
  }
}
