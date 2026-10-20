/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { fsReadFile, fsRm, fsRename, fsStat, fsWriteFile } from "../shared/storage/fs-adapter.js";
import {
  ATOMIC_RENAME_RETRY_DELAYS_MS,
  writeFileAtomic,
} from "../shared/storage/atomic-file-write.js";
import {
  isMissingPersistencePathError,
  readPersistedJsonFile,
} from "../shared/storage/json-file-reader.js";

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

  async exists(filePath) {
    try {
      await fsStat(filePath);
      return true;
    } catch (error) {
      if (error?.code === "ENOENT" || error?.code === "ENOTDIR") return false;
      throw error;
    }
  }

  async isDirectory(directoryPath) {
    try {
      return (await fsStat(directoryPath)).isDirectory();
    } catch (error) {
      if (error?.code === "ENOENT" || error?.code === "ENOTDIR") return false;
      throw error;
    }
  }

  async readJson(filePath, fallback) {
    return readPersistedJsonFile({ filePath, fallback, readFile: fsReadFile });
  }

  async readTextOrNull(filePath) {
    try {
      return await fsReadFile(filePath, "utf8");
    } catch (error) {
      if (isMissingPersistencePathError(error)) return null;
      throw error;
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
