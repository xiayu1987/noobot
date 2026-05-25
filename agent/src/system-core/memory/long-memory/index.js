/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { readLongMemory, readLongMemoryMetadata, readLongMemoryModel } from "./reader.js";
import { updateLongMemory } from "./updater.js";

export class LongMemoryManager {
  constructor(storage) {
    this.storage = storage;
  }

  async read(basePath) {
    return readLongMemory(this.storage, basePath);
  }

  async readModel(basePath) {
    return readLongMemoryModel(this.storage, basePath);
  }

  async readMetadata(basePath) {
    return readLongMemoryMetadata(this.storage, basePath);
  }

  async update(basePath, content) {
    return updateLongMemory(this.storage, basePath, content);
  }
}
