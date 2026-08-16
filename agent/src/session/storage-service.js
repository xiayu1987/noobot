/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  fsAccess,
  fsMkdir,
  fsReadFile,
  fsRm,
  fsRename,
  fsWriteFile,
} from "../shared/storage/fs-adapter.js";
import {
  ATOMIC_RENAME_RETRY_DELAYS_MS,
  writeFileAtomic,
} from "../shared/storage/atomic-file-write.js";

export class StorageService {
  constructor({
    pathResolver,
    atomicRenameRetryDelaysMs = ATOMIC_RENAME_RETRY_DELAYS_MS,
    platform = process.platform,
  } = {}) {
    this.pathResolver = pathResolver;
    this.atomicRenameRetryDelaysMs = Array.isArray(atomicRenameRetryDelaysMs)
      ? atomicRenameRetryDelaysMs
      : ATOMIC_RENAME_RETRY_DELAYS_MS;
    this.platform = platform;
  }

  async exists(filePath = "") {
    try {
      await fsAccess(filePath);
      return true;
    } catch {
      return false;
    }
  }

  async ensureRuntimeDirsByBasePath(basePath = "") {
    if (!(await this.exists(basePath))) {
      return false;
    }
    const sessionRootPath = this.pathResolver?.sessionRoot
      ? this.pathResolver.sessionRoot(basePath)
      : "";
    if (sessionRootPath) {
      await fsMkdir(sessionRootPath, { recursive: true });
    }
    return true;
  }

  async readJson(filePath, fallback = {}) {
    try {
      const raw = await fsReadFile(filePath, "utf8");
      return JSON.parse(raw);
    } catch {
      return fallback;
    }
  }

  async writeJson(filePath, data) {
    await fsWriteFile(filePath, JSON.stringify(data, null, 2));
  }

  async writeJsonAtomic(filePath, data) {
    await writeFileAtomic({
      filePath,
      content: JSON.stringify(data, null, 2),
      writeFile: fsWriteFile,
      rename: fsRename,
      remove: fsRm,
      retryDelaysMs: this.atomicRenameRetryDelaysMs,
      platform: this.platform,
    });
  }
}
