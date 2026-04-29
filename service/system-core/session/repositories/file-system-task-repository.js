/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

export class FileSystemTaskRepository {
  constructor({ sessionRepository, normalizeTask, now = () => new Date().toISOString() } = {}) {
    this.sessionRepository = sessionRepository;
    this.normalizeTask = normalizeTask;
    this.now = now;
  }

  async findBySessionId(userId, sessionId, parentSessionId = "") {
    const bundle = await this.getBundle(userId, sessionId, parentSessionId);
    return bundle.tasks;
  }

  async getBundle(userId, sessionId, parentSessionId = "") {
    const bundle = await this.sessionRepository.getTaskBundle(
      userId,
      sessionId,
      parentSessionId,
    );
    return {
      sessionId: String(bundle?.sessionId || sessionId || "").trim(),
      currentTaskId: String(bundle?.currentTaskId || "").trim(),
      tasks: Array.isArray(bundle?.tasks)
        ? bundle.tasks.map((task) => this.normalizeTask(task))
        : [],
      updatedAt: bundle?.updatedAt || this.now(),
    };
  }

  async save(userId, sessionId, task, parentSessionId = "") {
    const bundle = await this.getBundle(userId, sessionId, parentSessionId);
    const normalizedTask = this.normalizeTask(task);
    const existingIndex = bundle.tasks.findIndex(
      (taskItem) => taskItem.taskId === normalizedTask.taskId,
    );
    if (existingIndex >= 0) {
      bundle.tasks[existingIndex] = {
        ...bundle.tasks[existingIndex],
        ...normalizedTask,
      };
    } else {
      bundle.tasks.push(normalizedTask);
    }
    bundle.currentTaskId = String(normalizedTask.taskId || "").trim();
    bundle.updatedAt = this.now();
    await this.sessionRepository.saveTaskBundle(
      userId,
      sessionId,
      bundle,
      parentSessionId,
    );
  }

  async saveBatch(
    userId,
    sessionId,
    tasks = [],
    parentSessionId = "",
    currentTaskId = "",
  ) {
    const bundle = await this.getBundle(userId, sessionId, parentSessionId);
    const existingTasks = Array.isArray(bundle.tasks) ? bundle.tasks : [];
    const taskIndexMap = new Map(
      existingTasks.map((task, index) => [task.taskId, index]),
    );

    for (const task of tasks) {
      const normalizedTask = this.normalizeTask(task);
      if (!normalizedTask.taskId) continue;
      const existingIndex = taskIndexMap.get(normalizedTask.taskId);
      if (existingIndex === undefined) {
        existingTasks.push(normalizedTask);
        taskIndexMap.set(normalizedTask.taskId, existingTasks.length - 1);
      } else {
        existingTasks[existingIndex] = {
          ...existingTasks[existingIndex],
          ...normalizedTask,
        };
      }
    }

    bundle.tasks = existingTasks;
    bundle.currentTaskId = String(currentTaskId || "").trim();
    bundle.updatedAt = this.now();
    await this.sessionRepository.saveTaskBundle(
      userId,
      sessionId,
      bundle,
      parentSessionId,
    );
  }
}
