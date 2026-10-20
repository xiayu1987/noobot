/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { v4 as uuidv4 } from "uuid";
import { text } from "@noobot/shared/value";

export class TaskService {
  constructor({ taskRepo, sessionRepo, now = () => new Date().toISOString() } = {}) {
    this.taskRepo = taskRepo;
    this.sessionRepo = sessionRepo;
    this.now = now;
  }

  async _withResolvedSession({ userId, sessionId, persistenceContext }, handler) {
    return this.sessionRepo.withSessionMutation(
      userId,
      sessionId,
      async () => {
        const session = await this.sessionRepo.findById(userId, sessionId, { persistenceContext });
        if (!session) return null;
        return handler({ session });
      },
      { persistenceContext },
    );
  }

  async startSkillTask({
    userId,
    sessionId,
    skillName,
    taskName = "",
    meta = {},
    persistenceContext,
  }) {
    return this._withResolvedSession(
      { userId, sessionId, persistenceContext },
      async ({ session }) => {
        const taskBundle = await this.taskRepo.getBundle(userId, sessionId, { persistenceContext });
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

        await this.taskRepo.save(userId, sessionId, task, { persistenceContext });

        session.currentTaskId = taskId;
        if (session.messages?.length) {
          const lastMessage = session.messages[session.messages.length - 1];
          lastMessage.taskId = taskId;
          lastMessage.taskStatus = "start";
        }
        await this.sessionRepo.save(userId, session, { persistenceContext });
        return task;
      },
    );
  }

  async finishSkillTask({ userId, sessionId, taskId, result = "", persistenceContext }) {
    return this._withResolvedSession(
      { userId, sessionId, persistenceContext },
      async ({ session }) => {
        const taskBundle = await this.taskRepo.getBundle(userId, sessionId, { persistenceContext });

        const currentTaskId = taskId || taskBundle.currentTaskId || session.currentTaskId;
        if (!currentTaskId) return null;
        const task = (taskBundle.tasks || []).find((taskItem) => taskItem.taskId === currentTaskId);
        if (!task) return null;

        task.taskStatus = "completed";
        task.endedAt = this.now();
        if (result) task.result = result;

        const nextCurrentTaskId =
          text(taskBundle.currentTaskId) === currentTaskId ? "" : taskBundle.currentTaskId;
        await this.taskRepo.saveBatch(userId, sessionId, taskBundle.tasks, {
          currentTaskId: nextCurrentTaskId,
          persistenceContext,
        });

        if (text(session.currentTaskId) === currentTaskId) {
          session.currentTaskId = "";
        }
        if (session.messages?.length) {
          const lastMessage = session.messages[session.messages.length - 1];
          lastMessage.taskStatus = "completed";
        }
        await this.sessionRepo.save(userId, session, { persistenceContext });
        return task;
      },
    );
  }

  async saveCurrentTurnTasks({ userId, sessionId, currentTurnTasks = [], persistenceContext }) {
    return this._withResolvedSession(
      { userId, sessionId, persistenceContext },
      async ({ session }) => {
        const normalizedTurnTasks = (
          Array.isArray(currentTurnTasks) ? currentTurnTasks : []
        ).filter((task) => text(task?.taskId));

        const lastTask = normalizedTurnTasks[normalizedTurnTasks.length - 1] || null;
        const currentTaskId = text(lastTask?.taskId);

        await this.taskRepo.saveBatch(userId, sessionId, normalizedTurnTasks, {
          currentTaskId,
          persistenceContext,
        });

        session.currentTaskId = currentTaskId;
        await this.sessionRepo.save(userId, session, { persistenceContext });

        return this.taskRepo.getBundle(userId, sessionId, { persistenceContext });
      },
    );
  }
}
