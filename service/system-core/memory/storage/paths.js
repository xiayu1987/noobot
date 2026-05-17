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

export function summaryPipelineDir(basePath) {
  return path.join(basePath, "memory/summary_pipeline");
}

export function summaryPipelineMetadataPath(basePath) {
  return path.join(summaryPipelineDir(basePath), "metadata.json");
}

export function summaryPipelineModelPath(basePath) {
  return path.join(basePath, "memory/summary-pipeline-model.json");
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
export function experienceLessonsDir(basePath) {
  return summaryPipelineDir(basePath);
}

export function experienceLessonsMetadataPath(basePath) {
  return summaryPipelineMetadataPath(basePath);
}

export function experienceLessonsModelPath(basePath) {
  return summaryPipelineModelPath(basePath);
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
