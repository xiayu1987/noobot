/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { v4 as uuidv4 } from "uuid";
import { isPlainObject } from "../../utils/shared-utils.js";

/**
 * Parent async result container and task state manager.
 */
export class ParentAsyncTaskManager {
  constructor({ now = () => new Date().toISOString() } = {}) {
    this.now = now;
  }

  upsertParentAsyncTask({
    parentAsyncResultContainer = null,
    sessionId = "",
    parentSessionId = "",
    task = "",
    sharedTaskSpec = "",
    patch = {},
  }) {
    if (!isPlainObject(parentAsyncResultContainer)) return null;
    const normalizedSessionId = (sessionId ?? "").trim();
    if (!normalizedSessionId) return null;
    if (!Array.isArray(parentAsyncResultContainer.tasks)) {
      parentAsyncResultContainer.tasks = [];
    }
    const taskList = parentAsyncResultContainer.tasks;
    const targetIndex = taskList.findIndex(
      (item) => (item?.sessionId ?? "").trim() === normalizedSessionId,
    );
    const baseTask =
      targetIndex >= 0
        ? taskList[targetIndex] || {}
        : {
            sessionId: normalizedSessionId,
            parentSessionId: (parentSessionId ?? "").trim(),
            task: (task ?? "").trim(),
            sharedTaskSpec: (sharedTaskSpec ?? "").trim(),
            status: "running",
            startedAt: "",
            endedAt: "",
            error: "",
            result: null,
          };
    const mergedTask = {
      ...baseTask,
      ...(isPlainObject(patch) ? patch : {}),
      sessionId: normalizedSessionId,
    };
    if (targetIndex >= 0) {
      taskList[targetIndex] = mergedTask;
    } else {
      taskList.push(mergedTask);
    }
    parentAsyncResultContainer.updatedAt = this.now();
    let hasFailed = false;
    let hasRunning = false;
    let hasStopped = false;
    let allCompleted = taskList.length > 0;
    for (const taskItem of taskList) {
      const status = (taskItem?.status || "running" || "").trim().toLowerCase();
      if (status === "failed") hasFailed = true;
      if (status === "running") hasRunning = true;
      if (status === "stopped") hasStopped = true;
      if (status !== "completed") allCompleted = false;
    }
    if (hasFailed) {
      parentAsyncResultContainer.status = "failed";
    } else if (hasRunning) {
      parentAsyncResultContainer.status = "running";
    } else if (allCompleted) {
      parentAsyncResultContainer.status = "completed";
    } else if (hasStopped) {
      parentAsyncResultContainer.status = "stopped";
    } else {
      parentAsyncResultContainer.status = "running";
    }
    return mergedTask;
  }

  ensureParentAsyncResultContainer({
    parentAsyncResultContainer = null,
    caller = "user",
    parentSessionId = "",
    parentDialogProcessId = "",
  }) {
    let container = parentAsyncResultContainer;
    if (!isPlainObject(container)) {
      if (String(caller || "user") !== "bot") return null;
      container = {};
    }
    container.id = (container?.id ?? "").trim() || uuidv4();
    container.parentSessionId =
      (container?.parentSessionId ?? "").trim() ||
      (parentSessionId ?? "").trim();
    container.parentDialogProcessId =
      (container?.parentDialogProcessId ?? "").trim() ||
      (parentDialogProcessId ?? "").trim();
    container.status = (container?.status || "running" || "").trim() || "running";
    container.updatedAt =
      (container?.updatedAt ?? "").trim() || this.now();
    container.tasks = Array.isArray(container?.tasks) ? container.tasks : [];
    return container;
  }
}
