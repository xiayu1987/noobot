/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { readLongMemoryState } from "./reader.js";
import { updateLongMemory } from "./updater.js";
import { renderLongMemoryBody } from "@noobot/memory-protocol/long-memory";

export class LongMemoryManager {
  constructor(storage) {
    this.storage = storage;
  }

  async read(basePath) {
    const { model, values } = await readLongMemoryState(this.storage, basePath);
    return renderLongMemoryBody(model, values);
  }

  async readState(basePath) {
    return readLongMemoryState(this.storage, basePath);
  }

  async update(basePath, state, patchText, options) {
    return updateLongMemory(this.storage, basePath, state, patchText, options);
  }
}
