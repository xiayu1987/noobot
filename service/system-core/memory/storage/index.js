/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  resolveBasePath,
  shortPath,
  longPath,
  experienceDir,
  experienceMetadataPath,
  experienceModelPath,
  dailySummaryDir,
  weeklySummaryDir,
  monthlySummaryDir,
  yearlySummaryDir,
  dailySummaryDateDir,
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
import { ERROR_CODE } from "../../error/constants.js";

export class StorageManager {
  constructor(globalConfig = {}) {
    this.globalConfig = globalConfig;
  }

  resolveBasePath(userId = "") {
    const normalizedUserId = String(userId || "").trim();
    const workspaceRoot = String(this.globalConfig?.workspaceRoot || "").trim();
    if (!normalizedUserId || !workspaceRoot) {
      throw fatalSystemError(tSystem("common.workspaceRootUserIdRequired"), {
        code: ERROR_CODE.FATAL_WORKSPACE_PATH_INVALID,
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

  experienceDir(basePath) {
    return experienceDir(basePath);
  }

  experienceMetadataPath(basePath) {
    return experienceMetadataPath(basePath);
  }

  experienceModelPath(basePath) {
    return experienceModelPath(basePath);
  }

  dailySummaryDir(basePath) {
    return dailySummaryDir(basePath);
  }

  weeklySummaryDir(basePath) {
    return weeklySummaryDir(basePath);
  }

  monthlySummaryDir(basePath) {
    return monthlySummaryDir(basePath);
  }

  yearlySummaryDir(basePath) {
    return yearlySummaryDir(basePath);
  }

  dailySummaryDateDir(basePath, dateKey = "") {
    return dailySummaryDateDir(basePath, dateKey);
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
