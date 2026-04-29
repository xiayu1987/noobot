/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { access, mkdir, readFile, rename, writeFile } from "node:fs/promises";

export class StorageService {
  constructor({ pathResolver } = {}) {
    this.pathResolver = pathResolver;
  }

  async exists(filePath = "") {
    try {
      await access(filePath);
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
      await mkdir(sessionRootPath, { recursive: true });
    }
    return true;
  }

  async readJson(filePath, fallback = {}) {
    try {
      const raw = await readFile(filePath, "utf8");
      return JSON.parse(raw);
    } catch {
      return fallback;
    }
  }

  async writeJson(filePath, data) {
    await writeFile(filePath, JSON.stringify(data, null, 2));
  }

  async writeJsonAtomic(filePath, data) {
    const tempFile = `${filePath}.tmp-${process.pid}-${Date.now()}`;
    await writeFile(tempFile, JSON.stringify(data, null, 2), "utf8");
    await rename(tempFile, filePath);
  }
}
