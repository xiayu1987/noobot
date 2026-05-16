/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  resolveBasePath,
  shortPath,
  longPath,
  experienceLessonsDir,
  experienceLessonsMetadataPath,
  weeklySummaryDir,
  experienceLessonsDailyDir,
  sessionFile,
  longMemoryModelPath,
} from "./paths.js";
import {
  fileExists,
  readJson,
  writeJson,
  readText,
  appendText,
  ensureDir,
  safeReadDirEntries,
  removeDir,
} from "./file-ops.js";
import { fatalSystemError } from "../../error/index.js";
import { tSystem } from "../../i18n/system-text.js";

export class StorageManager {
  constructor(globalConfig = {}) {
    this.globalConfig = globalConfig;
  }

  resolveBasePath(userId = "") {
    const normalizedUserId = String(userId || "").trim();
    const workspaceRoot = String(this.globalConfig?.workspaceRoot || "").trim();
    if (!normalizedUserId || !workspaceRoot) {
      throw fatalSystemError(tSystem("common.workspaceRootUserIdRequired"), {
        code: "FATAL_WORKSPACE_PATH_INVALID",
      });
    }
    return resolveBasePath({ workspaceRoot, userId: normalizedUserId });
  }

  shortPath(basePath) {
    return shortPath(basePath);
  }

  longPath(basePath) {
    return longPath(basePath);
  }

  experienceLessonsDir(basePath) {
    return experienceLessonsDir(basePath);
  }

  experienceLessonsMetadataPath(basePath) {
    return experienceLessonsMetadataPath(basePath);
  }

  weeklySummaryDir(basePath) {
    return weeklySummaryDir(basePath);
  }

  experienceLessonsDailyDir(basePath, dateKey = "") {
    return experienceLessonsDailyDir(basePath, dateKey);
  }

  sessionFile(basePath, sessionId, parentSessionId = "") {
    return sessionFile(basePath, sessionId, parentSessionId);
  }

  longMemoryModelPath(basePath) {
    return longMemoryModelPath(basePath);
  }

  async fileExists(filePath = "") {
    return fileExists(filePath);
  }

  async readJson(filePath, fallback = {}) {
    return readJson(filePath, fallback);
  }

  async writeJson(filePath, payload = {}) {
    await writeJson(filePath, payload);
  }

  async readText(filePath, fallback = "") {
    return readText(filePath, fallback);
  }

  async appendText(filePath, content = "") {
    await appendText(filePath, content);
  }

  async ensureDir(dirPath = "") {
    await ensureDir(dirPath);
  }

  async safeReadDirEntries(dirPath = "") {
    return safeReadDirEntries(dirPath);
  }

  async removeDir(dirPath = "") {
    await removeDir(dirPath);
  }
}

