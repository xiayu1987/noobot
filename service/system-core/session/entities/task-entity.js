/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

export function normalizeTaskEntity(task = {}) {
  const taskId = String(task?.taskId || "").trim();
  const taskStatus = String(task?.taskStatus || "").trim();
  return {
    taskId,
    skillName: String(task?.skillName || "").trim(),
    taskName: String(task?.taskName || "").trim(),
    taskStatus:
      taskStatus === "start" || taskStatus === "completed" ? taskStatus : "",
    startedAt: String(task?.startedAt || "").trim(),
    endedAt: String(task?.endedAt || "").trim(),
    result: String(task?.result || "").trim(),
    meta: task?.meta && typeof task.meta === "object" ? task.meta : {},
  };
}
