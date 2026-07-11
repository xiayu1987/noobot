/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { filePath as path } from "../../utils/path-resolver.js";

export function resolveBasePath({ workspaceRoot = "", userId = "" } = {}) {
  return path.resolve(String(workspaceRoot || "").trim(), String(userId || "").trim());
}

export function shortPath(basePath) {
  return path.join(basePath, "memory/short-memory.json");
}

export function longPath(basePath) {
  return path.join(basePath, "memory/long-memory.md");
}

export function experienceDir(basePath) {
  return path.join(basePath, "memory/experience");
}

export function experienceMetadataPath(basePath) {
  return path.join(experienceDir(basePath), "metadata.md");
}

export function experienceModelPath(basePath) {
  return path.join(basePath, "memory/experience-model.md");
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

export function longMemoryMetadataPath(basePath) {
  return path.join(basePath, "memory/long-memory/metadata.md");
}
