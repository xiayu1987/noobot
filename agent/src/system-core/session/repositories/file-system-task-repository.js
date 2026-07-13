/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { fsMkdir } from "../../store/fs-adapter.js";
import { buildSessionArtifactFileMap, writeTaskArtifact } from "../session-artifact-store.js";

export class FileSystemTaskRepository {
  constructor({
    pathResolver,
    sessionPathResolver,
    storageService,
    normalizeTask,
    sessionRepository = null,
    now = () => new Date().toISOString(),
  } = {}) {
    this.pathResolver = pathResolver;
    this.sessionPathResolver = sessionPathResolver;
    this.storageService = storageService;
    this.normalizeTask = normalizeTask;
    this.sessionRepository = sessionRepository;
    this.now = now;
  }

  _basePath(userId = "") {
    return this.pathResolver.resolveBasePath(userId);
  }

  async _resolveTaskScope(userId, sessionId, parentSessionId = "") {
    const basePath = this._basePath(userId);
    await this.storageService.ensureRuntimeDirsByBasePath(basePath);
    const { sessionDir } = await this.sessionPathResolver.resolveSessionScope(
      userId,
      sessionId,
      parentSessionId,
    );
    const files = buildSessionArtifactFileMap(sessionDir);
    return { sessionDir, taskFile: files.task };
  }

  async findBySessionId(userId, sessionId, parentSessionId = "") {
    const bundle = await this.getBundle(userId, sessionId, parentSessionId);
    return bundle.tasks;
  }

  async getBundle(userId, sessionId, parentSessionId = "") {
    const { taskFile } = await this._resolveTaskScope(userId, sessionId, parentSessionId);
    const bundle = await this.storageService.readJson(taskFile, {
      sessionId,
      currentTaskId: "",
      tasks: [],
      updatedAt: this.now(),
    });
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
    if (await this.sessionRepository?.isSessionDeleted(userId, sessionId)) return false;
    const { sessionDir } = await this._resolveTaskScope(
      userId,
      sessionId,
      parentSessionId,
    );
    await fsMkdir(sessionDir, { recursive: true });

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

    await writeTaskArtifact({
      storageService: this.storageService,
      sessionDir,
      taskPayload: {
        sessionId,
        currentTaskId: bundle.currentTaskId,
        tasks: bundle.tasks,
        updatedAt: bundle.updatedAt,
      },
    });
    return true;
  }

  async saveBatch(
    userId,
    sessionId,
    tasks = [],
    parentSessionId = "",
    currentTaskId = "",
  ) {
    if (await this.sessionRepository?.isSessionDeleted(userId, sessionId)) return false;
    const { sessionDir } = await this._resolveTaskScope(
      userId,
      sessionId,
      parentSessionId,
    );
    await fsMkdir(sessionDir, { recursive: true });

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
    await writeTaskArtifact({
      storageService: this.storageService,
      sessionDir,
      taskPayload: {
        sessionId,
        currentTaskId: bundle.currentTaskId,
        tasks: bundle.tasks,
        updatedAt: bundle.updatedAt,
      },
    });
    return true;
  }
}
