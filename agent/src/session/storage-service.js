/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { fsReadFile, fsRm, fsRename, fsStat, fsWriteFile } from "../shared/storage/fs-adapter.js";
import { writeFileAtomic } from "../shared/storage/atomic-file-write.js";
import {
  isMissingPersistencePathError,
  readOptionalPersistedJsonFile,
  readPersistedJsonFile,
} from "../shared/storage/json-file-reader.js";
import { isFunction } from "@noobot/shared/value";

const STORAGE_SERVICE_METHODS = Object.freeze([
  "exists",
  "isDirectory",
  "readJson",
  "readOptionalJson",
  "readTextOrNull",
  "writeJson",
  "writeJsonAtomic",
]);

export function requireStorageService(storageService, owner) {
  if (
    storageService === null ||
    typeof storageService !== "object" ||
    !STORAGE_SERVICE_METHODS.every((method) => isFunction(storageService[method]))
  ) {
    throw new TypeError(`${owner} requires storageService`);
  }
  return storageService;
}

export class StorageService {
  constructor({ atomicRenameRetryDelaysMs, platform }) {
    this.atomicRenameRetryDelaysMs = atomicRenameRetryDelaysMs;
    this.platform = platform;
  }

  async exists(filePath) {
    try {
      await fsStat(filePath);
      return true;
    } catch (error) {
      if (isMissingPersistencePathError(error)) return false;
      throw error;
    }
  }

  async isDirectory(directoryPath) {
    try {
      return (await fsStat(directoryPath)).isDirectory();
    } catch (error) {
      if (isMissingPersistencePathError(error)) return false;
      throw error;
    }
  }

  async readJson(filePath) {
    return readPersistedJsonFile({ filePath, readFile: fsReadFile });
  }

  async readOptionalJson(filePath) {
    return readOptionalPersistedJsonFile({ filePath, readFile: fsReadFile });
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
