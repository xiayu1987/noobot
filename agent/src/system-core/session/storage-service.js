/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { randomUUID } from "node:crypto";
import {
  fsAccess,
  fsMkdir,
  fsReadFile,
  fsRm,
  fsRename,
  fsWriteFile,
} from "../store/fs-adapter.js";

const ATOMIC_RENAME_RETRY_CODES = new Set(["EPERM", "EACCES", "EBUSY"]);
const ATOMIC_RENAME_RETRY_DELAYS_MS = [25, 75, 150, 300, 600];

function sleep(ms = 0) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableAtomicRenameError(error) {
  return ATOMIC_RENAME_RETRY_CODES.has(String(error?.code || ""));
}

export class StorageService {
  constructor({ pathResolver, atomicRenameRetryDelaysMs = ATOMIC_RENAME_RETRY_DELAYS_MS } = {}) {
    this.pathResolver = pathResolver;
    this.atomicRenameRetryDelaysMs = Array.isArray(atomicRenameRetryDelaysMs)
      ? atomicRenameRetryDelaysMs
      : ATOMIC_RENAME_RETRY_DELAYS_MS;
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
    const tempFile = `${filePath}.tmp-${process.pid}-${Date.now()}-${randomUUID()}`;
    try {
      await fsWriteFile(tempFile, JSON.stringify(data, null, 2), "utf8");
      for (let attempt = 0; attempt <= this.atomicRenameRetryDelaysMs.length; attempt += 1) {
        try {
          await fsRename(tempFile, filePath);
          return;
        } catch (error) {
          if (
            attempt >= this.atomicRenameRetryDelaysMs.length ||
            !isRetryableAtomicRenameError(error)
          ) {
            throw error;
          }
          await sleep(this.atomicRenameRetryDelaysMs[attempt]);
        }
      }
    } catch (error) {
      try {
        await fsRm(tempFile, { force: true });
      } catch {
        // Best-effort cleanup; preserve the original write/rename error.
      }
      throw error;
    }
  }
}
