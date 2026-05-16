/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import path from "node:path";

export function resolveBasePath({ workspaceRoot = "", userId = "" } = {}) {
  return path.resolve(String(workspaceRoot || "").trim(), String(userId || "").trim());
}

export function shortPath(basePath) {
  return path.join(basePath, "memory/short-memory.json");
}

export function longPath(basePath) {
  return path.join(basePath, "memory/long-memory.json");
}

export function experienceLessonsDir(basePath) {
  return path.join(basePath, "memory/experience-lessons");
}

export function experienceLessonsMetadataPath(basePath) {
  return path.join(experienceLessonsDir(basePath), "metadata.json");
}

export function weeklySummaryDir(basePath) {
  return path.join(basePath, "memory/Weekly_Summary");
}

export function experienceLessonsDailyDir(basePath, dateKey = "") {
  return path.join(experienceLessonsDir(basePath), dateKey);
}

export function sessionFile(basePath, sessionId, parentSessionId = "") {
  return parentSessionId
    ? path.join(
        basePath,
        "runtime/session",
        parentSessionId,
        sessionId,
        "session.json",
      )
    : path.join(basePath, "runtime/session", sessionId, "session.json");
}

export function longMemoryModelPath(basePath) {
  return path.join(basePath, "memory/long-memory-model.md");
}

