/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { text } from "@noobot/shared/value";

function normalizeTaskStatus(value = "") {
  const status = text(value);
  return status === "start" || status === "completed" ? status : "";
}

function normalizeTaskMeta(value = null) {
  return value && typeof value === "object" ? value : {};
}

export function normalizeTaskEntity(task = {}) {
  return {
    taskId: text(task?.taskId),
    skillName: text(task?.skillName),
    taskName: text(task?.taskName),
    taskStatus: normalizeTaskStatus(task?.taskStatus),
    startedAt: text(task?.startedAt),
    endedAt: text(task?.endedAt),
    result: text(task?.result),
    meta: normalizeTaskMeta(task?.meta),
  };
}
