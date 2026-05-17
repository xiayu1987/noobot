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

  async startSkillTask({
    userId,
    sessionId,
    skillName,
    taskName = "",
    meta = {},
    parentSessionId = "",
  }) {
    const resolvedParentSessionId = await this.sessionRepo.resolveParentSessionId(
      userId,
      sessionId,
      parentSessionId,
    );
    await this.sessionRepo.ensureSession({
      userId,
      sessionId,
      parentSessionId: resolvedParentSessionId,
    });
    const session = await this.sessionRepo.findById(
      userId,
      sessionId,
      resolvedParentSessionId,
    );
    if (!session) return null;

    const taskBundle = await this.taskRepo.getBundle(
      userId,
      sessionId,
      resolvedParentSessionId,
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

    await this.taskRepo.save(userId, sessionId, task, resolvedParentSessionId);

    session.currentTaskId = taskId;
    if (session.messages?.length) {
      const lastMessage = session.messages[session.messages.length - 1];
      lastMessage.taskId = taskId;
      lastMessage.taskStatus = "start";
    }
    await this.sessionRepo.save(userId, session, resolvedParentSessionId);
    return task;
  }

  async finishSkillTask({
    userId,
    sessionId,
    taskId,
    result = "",
    parentSessionId = "",
  }) {
    const resolvedParentSessionId = await this.sessionRepo.resolveParentSessionId(
      userId,
      sessionId,
      parentSessionId,
    );
    await this.sessionRepo.ensureSession({
      userId,
      sessionId,
      parentSessionId: resolvedParentSessionId,
    });

    const session = await this.sessionRepo.findById(
      userId,
      sessionId,
      resolvedParentSessionId,
    );
    if (!session) return null;

    const taskBundle = await this.taskRepo.getBundle(
      userId,
      sessionId,
      resolvedParentSessionId,
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
    );

    if (String(session.currentTaskId || "").trim() === currentTaskId) {
      session.currentTaskId = "";
    }
    if (session.messages?.length) {
      const lastMessage = session.messages[session.messages.length - 1];
      lastMessage.taskStatus = "completed";
    }
    await this.sessionRepo.save(userId, session, resolvedParentSessionId);
    return task;
  }

  async saveCurrentTurnTasks({
    userId,
    sessionId,
    parentSessionId = "",
    currentTurnTasks = [],
  }) {
    const resolvedParentSessionId = await this.sessionRepo.resolveParentSessionId(
      userId,
      sessionId,
      parentSessionId,
    );
    await this.sessionRepo.ensureSession({
      userId,
      sessionId,
      parentSessionId: resolvedParentSessionId,
    });

    const session = await this.sessionRepo.findById(
      userId,
      sessionId,
      resolvedParentSessionId,
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
    );

    session.currentTaskId = currentTaskId;
    await this.sessionRepo.save(userId, session, resolvedParentSessionId);

    return this.taskRepo.getBundle(userId, sessionId, resolvedParentSessionId);
  }
}
