/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { filePath as path } from "@noobot/path-resolver";

const MEMORY_DIR_RELATIVE_PATH = "memory";
const SESSION_DIR_RELATIVE_PATH = "runtime/session";

export const MEMORY_RELATIVE_PATHS = Object.freeze({
  MEMORY_DIR: MEMORY_DIR_RELATIVE_PATH,
  SHORT_MEMORY: "memory/short-memory.json",
  LONG_MEMORY: "memory/long-memory.md",
  LONG_MEMORY_MODEL: "memory/long-memory-model.md",
  LONG_MEMORY_METADATA: "memory/long-memory/metadata.md",
  EXPERIENCE_DIR: "memory/experience",
  EXPERIENCE_METADATA: "memory/experience/metadata.md",
  EXPERIENCE_MODEL: "memory/experience-model.md",
  DAILY_SUMMARY_DIR: "memory/daily_summary",
  WEEKLY_SUMMARY_DIR: "memory/weekly_summary",
  MONTHLY_SUMMARY_DIR: "memory/monthly_summary",
  YEARLY_SUMMARY_DIR: "memory/yearly_summary",
});

export function resolveBasePath({ workspaceRoot = "", userId = "" } = {}) {
  return path.resolve(String(workspaceRoot || "").trim(), String(userId || "").trim());
}

function joinBasePath(basePath, relativePath) {
  return path.join(basePath, relativePath);
}

export function memoryDir(basePath) {
  return joinBasePath(basePath, MEMORY_RELATIVE_PATHS.MEMORY_DIR);
}

export function shortPath(basePath) {
  return joinBasePath(basePath, MEMORY_RELATIVE_PATHS.SHORT_MEMORY);
}

export function longPath(basePath) {
  return joinBasePath(basePath, MEMORY_RELATIVE_PATHS.LONG_MEMORY);
}

export function experienceDir(basePath) {
  return joinBasePath(basePath, MEMORY_RELATIVE_PATHS.EXPERIENCE_DIR);
}

export function experienceMetadataPath(basePath) {
  return joinBasePath(basePath, MEMORY_RELATIVE_PATHS.EXPERIENCE_METADATA);
}

export function experienceModelPath(basePath) {
  return joinBasePath(basePath, MEMORY_RELATIVE_PATHS.EXPERIENCE_MODEL);
}

export function dailySummaryDir(basePath) {
  return joinBasePath(basePath, MEMORY_RELATIVE_PATHS.DAILY_SUMMARY_DIR);
}

export function weeklySummaryDir(basePath) {
  return joinBasePath(basePath, MEMORY_RELATIVE_PATHS.WEEKLY_SUMMARY_DIR);
}

export function monthlySummaryDir(basePath) {
  return joinBasePath(basePath, MEMORY_RELATIVE_PATHS.MONTHLY_SUMMARY_DIR);
}

export function yearlySummaryDir(basePath) {
  return joinBasePath(basePath, MEMORY_RELATIVE_PATHS.YEARLY_SUMMARY_DIR);
}

export function dailySummaryDateDir(basePath, dateKey = "") {
  return path.join(dailySummaryDir(basePath), dateKey);
}

export function sessionFile(basePath, sessionId, parentSessionId = "") {
  return parentSessionId
    ? path.join(basePath, SESSION_DIR_RELATIVE_PATH, parentSessionId, sessionId, "session.json")
    : path.join(basePath, SESSION_DIR_RELATIVE_PATH, sessionId, "session.json");
}

export function longMemoryModelPath(basePath) {
  return joinBasePath(basePath, MEMORY_RELATIVE_PATHS.LONG_MEMORY_MODEL);
}

export function longMemoryMetadataPath(basePath) {
  return joinBasePath(basePath, MEMORY_RELATIVE_PATHS.LONG_MEMORY_METADATA);
}
