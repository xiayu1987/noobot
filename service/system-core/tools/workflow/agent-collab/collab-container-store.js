/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { randomUUID } from "node:crypto";
import { isPlainObject } from "../../../utils/shared-utils.js";
import { cloneData } from "./collab-task-utils.js";

export function createCollabContainerStore({ runtime }) {
  runtime.childAsyncResultContainers = Array.isArray(
    runtime.childAsyncResultContainers,
  )
    ? runtime.childAsyncResultContainers
    : [];
  runtime.sharedTools =
    runtime.sharedTools && typeof runtime.sharedTools === "object"
      ? runtime.sharedTools
      : {};

  const nowIso = () => new Date().toISOString();

  const getAsyncResultContainerStore = () => {
    if (!(runtime.sharedTools.asyncResultContainers instanceof Map)) {
      runtime.sharedTools.asyncResultContainers = new Map();
    }
    return runtime.sharedTools.asyncResultContainers;
  };

  const upsertAsyncResultContainer = (container = {}) => {
    if (!isPlainObject(container)) return null;
    const containerId = String(container?.id || "").trim();
    if (!containerId) return null;
    const normalized = {
      id: containerId,
      parentSessionId: String(container?.parentSessionId || "").trim(),
      parentDialogProcessId: String(
        container?.parentDialogProcessId || "",
      ).trim(),
      status: String(container?.status || "running").trim() || "running",
      updatedAt: String(container?.updatedAt || nowIso()),
      tasks: Array.isArray(container?.tasks)
        ? container.tasks.map((item = {}, index) => ({
            index,
            sessionId: String(item?.sessionId || "").trim(),
            taskName: String(item?.taskName || "").trim(),
            taskContent: String(item?.taskContent || "").trim(),
            deliverable: String(item?.deliverable || "").trim(),
            status: String(item?.status || "running").trim() || "running",
            startedAt: String(item?.startedAt || "").trim(),
            endedAt: String(item?.endedAt || "").trim(),
            error: String(item?.error || "").trim(),
            result: item?.result ?? null,
            attachmentId: String(item?.attachmentId || "").trim(),
            attachmentName: String(item?.attachmentName || "").trim(),
          }))
        : [],
    };
    const store = getAsyncResultContainerStore();
    store.set(containerId, normalized);
    return normalized;
  };

  const patchAsyncResultTask = ({
    containerId = "",
    sessionId = "",
    patch = {},
  } = {}) => {
    const normalizedContainerId = String(containerId || "").trim();
    const normalizedSessionId = String(sessionId || "").trim();
    if (!normalizedContainerId || !normalizedSessionId || !isPlainObject(patch)) {
      return null;
    }
    const store = getAsyncResultContainerStore();
    const existing = store.get(normalizedContainerId);
    if (!isPlainObject(existing) || !Array.isArray(existing.tasks)) return null;
    const targetIndex = existing.tasks.findIndex(
      (item) => String(item?.sessionId || "").trim() === normalizedSessionId,
    );
    if (targetIndex < 0) return null;
    existing.tasks[targetIndex] = {
      ...(existing.tasks[targetIndex] || {}),
      ...patch,
    };
    existing.updatedAt = nowIso();
    store.set(normalizedContainerId, existing);
    return cloneData(existing.tasks[targetIndex]);
  };

  const updateContainerStatusByTasks = (container = {}) => {
    if (!isPlainObject(container)) return "unknown";
    const taskList = Array.isArray(container.tasks) ? container.tasks : [];
    if (!taskList.length) return "running";
    if (taskList.some((task) => String(task?.status || "") === "failed")) {
      return "failed";
    }
    if (taskList.every((task) => String(task?.status || "") === "completed")) {
      return "completed";
    }
    if (taskList.some((task) => String(task?.status || "") === "stopped")) {
      return "stopped";
    }
    return "running";
  };

  const addChildAsyncResultContainer = (container = {}) => {
    if (!isPlainObject(container)) return null;
    const normalized = upsertAsyncResultContainer(container) || container;
    const containerId = String(normalized?.id || "").trim();
    if (!containerId) return null;
    const list = runtime.childAsyncResultContainers;
    const hitIndex = list.findIndex(
      (item) => String(item?.id || "").trim() === containerId,
    );
    if (hitIndex >= 0) {
      list[hitIndex] = normalized;
    } else {
      list.push(normalized);
    }
    return normalized;
  };

  const createChildAsyncResultContainer = ({
    parentSessionId = "",
    parentDialogProcessId = "",
    request = {},
  } = {}) => {
    const container = upsertAsyncResultContainer({
      id: randomUUID(),
      parentSessionId,
      parentDialogProcessId,
      status: "running",
      updatedAt: nowIso(),
      tasks: [
        {
          index: 0,
          sessionId: String(request?.sessionId || "").trim(),
          taskName: String(request?.taskName || "").trim(),
          taskContent: String(request?.taskContent || "").trim(),
          status: "running",
          startedAt: "",
          endedAt: "",
          error: "",
          result: null,
          attachmentId: "",
          attachmentName: "",
        },
      ],
    });
    return addChildAsyncResultContainer(container);
  };

  const patchContainerTaskAndStatus = ({
    container = null,
    sessionId = "",
    patch = {},
  } = {}) => {
    if (!isPlainObject(container)) return;
    patchAsyncResultTask({
      containerId: String(container?.id || ""),
      sessionId,
      patch,
    });
    container.status = updateContainerStatusByTasks(container);
    container.updatedAt = nowIso();
  };

  return {
    nowIso,
    getAsyncResultContainerStore,
    upsertAsyncResultContainer,
    patchAsyncResultTask,
    updateContainerStatusByTasks,
    addChildAsyncResultContainer,
    createChildAsyncResultContainer,
    patchContainerTaskAndStatus,
  };
}
