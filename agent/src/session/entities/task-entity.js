/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

function normalizeTaskStatus(value = "") {
  const status = String(value || "").trim();
  return status === "start" || status === "completed" ? status : "";
}

function normalizeTaskMeta(value = null) {
  return value && typeof value === "object" ? value : {};
}

export function normalizeTaskEntity(task = {}) {
  return {
    taskId: String(task?.taskId || "").trim(),
    skillName: String(task?.skillName || "").trim(),
    taskName: String(task?.taskName || "").trim(),
    taskStatus: normalizeTaskStatus(task?.taskStatus),
    startedAt: String(task?.startedAt || "").trim(),
    endedAt: String(task?.endedAt || "").trim(),
    result: String(task?.result || "").trim(),
    meta: normalizeTaskMeta(task?.meta),
  };
}
