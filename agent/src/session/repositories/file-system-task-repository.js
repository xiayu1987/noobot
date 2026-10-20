/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { fsMkdir } from "../../shared/storage/fs-adapter.js";
import { writeTaskArtifact } from "../session-artifact-store.js";
import { text } from "@noobot/shared/value";

export class FileSystemTaskRepository {
  constructor({
    storageService,
    normalizeTask,
    sessionRepository,
    now = () => new Date().toISOString(),
  } = {}) {
    this.storageService = storageService;
    this.normalizeTask = normalizeTask;
    this.sessionRepository = sessionRepository;
    this.now = now;
  }

  async findBySessionId(userId, sessionId, { persistenceContext } = {}) {
    const bundle = await this.getBundle(userId, sessionId, { persistenceContext });
    return bundle.tasks;
  }

  async getBundle(userId, sessionId, { persistenceContext } = {}) {
    const scope = await this.sessionRepository.requireSessionScope(
      userId,
      sessionId,
      persistenceContext,
    );
    return this._readBundle(scope, sessionId);
  }

  async _readBundle(scope, sessionId) {
    const bundle = await this.storageService.readJson(scope.taskFile, {
      sessionId,
      currentTaskId: "",
      tasks: [],
      updatedAt: this.now(),
    });
    return {
      sessionId: text(bundle?.sessionId || sessionId),
      currentTaskId: text(bundle?.currentTaskId),
      tasks: Array.isArray(bundle?.tasks)
        ? bundle.tasks.map((task) => this.normalizeTask(task))
        : [],
      updatedAt: bundle?.updatedAt || this.now(),
    };
  }

  async save(userId, sessionId, task, { persistenceContext } = {}) {
    const normalizedTask = this.normalizeTask(task);
    return this._mutateBundle(userId, sessionId, persistenceContext, (bundle) => {
      upsertTasks(bundle.tasks, [normalizedTask]);
      return normalizedTask.taskId;
    });
  }

  async saveBatch(userId, sessionId, tasks, { currentTaskId = "", persistenceContext } = {}) {
    const normalizedTasks = tasks
      .map((task) => this.normalizeTask(task))
      .filter((task) => task.taskId);
    return this._mutateBundle(userId, sessionId, persistenceContext, (bundle) => {
      upsertTasks(bundle.tasks, normalizedTasks);
      return currentTaskId;
    });
  }

  async _mutateBundle(userId, sessionId, persistenceContext, mutate) {
    await this.sessionRepository.withSessionMutation(
      userId,
      sessionId,
      async (scope) => {
        await fsMkdir(scope.sessionDir, { recursive: true });
        const bundle = await this._readBundle(scope, sessionId);
        bundle.currentTaskId = text(mutate(bundle));
        bundle.updatedAt = this.now();
        await writeTaskArtifact({
          storageService: this.storageService,
          sessionDir: scope.sessionDir,
          taskPayload: {
            sessionId,
            currentTaskId: bundle.currentTaskId,
            tasks: bundle.tasks,
            updatedAt: bundle.updatedAt,
          },
        });
      },
      { persistenceContext },
    );
    return true;
  }
}

function upsertTasks(existingTasks, normalizedTasks) {
  const taskIndexMap = new Map(existingTasks.map((task, index) => [task.taskId, index]));
  for (const normalizedTask of normalizedTasks) {
    const existingIndex = taskIndexMap.get(normalizedTask.taskId);
    if (existingIndex === undefined) {
      taskIndexMap.set(normalizedTask.taskId, existingTasks.push(normalizedTask) - 1);
    } else {
      existingTasks[existingIndex] = { ...existingTasks[existingIndex], ...normalizedTask };
    }
  }
}
