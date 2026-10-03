/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { fsMkdir } from "../../shared/storage/fs-adapter.js";
import { buildSessionArtifactFileMap, writeTaskArtifact } from "../session-artifact-store.js";

export class FileSystemTaskRepository {
  constructor({
    pathResolver,
    sessionPathResolver,
    storageService,
    normalizeTask,
    sessionRepository,
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

  async _resolveTaskScope(userId, sessionId, parentSessionId = "", persistenceContext = null) {
    const basePath = this._basePath(userId);
    await this.storageService.ensureRuntimeDirsByBasePath(basePath);
    const resolver = persistenceContext?.locationResolver || this.sessionPathResolver;
    const { sessionDir, taskFile } = await resolver.resolveSessionScope(
      userId,
      sessionId,
      parentSessionId,
    );
    return { sessionDir, taskFile: taskFile || buildSessionArtifactFileMap(sessionDir).task };
  }

  async findBySessionId(userId, sessionId, parentSessionId = "", persistenceContext = null) {
    const bundle = await this.getBundle(userId, sessionId, parentSessionId, persistenceContext);
    return bundle.tasks;
  }

  async getBundle(userId, sessionId, parentSessionId = "", persistenceContext = null) {
    const { taskFile } = await this._resolveTaskScope(
      userId,
      sessionId,
      parentSessionId,
      persistenceContext,
    );
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

  async save(userId, sessionId, task, parentSessionId = "", persistenceContext = null) {
    const normalizedTask = this.normalizeTask(task);
    return this._mutateBundle(userId, sessionId, parentSessionId, persistenceContext, (bundle) => {
      upsertTasks(bundle.tasks, [normalizedTask]);
      return normalizedTask.taskId;
    });
  }

  async saveBatch(
    userId,
    sessionId,
    tasks = [],
    parentSessionId = "",
    currentTaskId = "",
    persistenceContext = null,
  ) {
    const normalizedTasks = tasks
      .map((task) => this.normalizeTask(task))
      .filter((task) => task.taskId);
    return this._mutateBundle(userId, sessionId, parentSessionId, persistenceContext, (bundle) => {
      upsertTasks(bundle.tasks, normalizedTasks);
      return currentTaskId;
    });
  }

  async _mutateBundle(userId, sessionId, parentSessionId, persistenceContext, mutate) {
    if (await this.sessionRepository.isSessionDeleted(userId, sessionId)) return false;
    await this.sessionRepository.withSessionMutation(
      userId,
      sessionId,
      parentSessionId,
      async () => {
        const { sessionDir } = await this._resolveTaskScope(
          userId,
          sessionId,
          parentSessionId,
          persistenceContext,
        );
        await fsMkdir(sessionDir, { recursive: true });
        const bundle = await this.getBundle(userId, sessionId, parentSessionId, persistenceContext);
        bundle.currentTaskId = String(mutate(bundle) || "").trim();
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
      },
      persistenceContext,
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
