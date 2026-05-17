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

export function experienceDir(basePath) {
  return path.join(basePath, "memory/experience");
}

export function experienceMetadataPath(basePath) {
  return path.join(experienceDir(basePath), "metadata.json");
}

export function experienceModelPath(basePath) {
  return path.join(basePath, "memory/experience-model.json");
}

export function dailySummaryDir(basePath) {
  return path.join(basePath, "memory/daily_summary");
}

export function weeklySummaryDir(basePath) {
  return path.join(basePath, "memory/weekly_summary");
}

export function monthlySummaryDir(basePath) {
  return path.join(basePath, "memory/monthly_summary");
}

export function yearlySummaryDir(basePath) {
  return path.join(basePath, "memory/yearly_summary");
}

export function dailySummaryDateDir(basePath, dateKey = "") {
  return path.join(dailySummaryDir(basePath), dateKey);
}

// Backward-compatible aliases (deprecated)
export function summaryPipelineDir(basePath) {
  return experienceDir(basePath);
}

export function summaryPipelineMetadataPath(basePath) {
  return experienceMetadataPath(basePath);
}

export function summaryPipelineModelPath(basePath) {
  return experienceModelPath(basePath);
}

export function experienceLessonsDir(basePath) {
  return experienceDir(basePath);
}

export function experienceLessonsMetadataPath(basePath) {
  return experienceMetadataPath(basePath);
}

export function experienceLessonsModelPath(basePath) {
  return experienceModelPath(basePath);
}

export function experienceLessonsDailyDir(basePath, dateKey = "") {
  return dailySummaryDateDir(basePath, dateKey);
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
  return path.join(basePath, "memory/long-memory-model.json");
}
