/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { randomUUID } from "node:crypto";
import { isPlainObject } from "@noobot/shared/value";
import { sessionMutationCoordinator } from "../../session/session-mutation-coordinator.js";
import { assertSessionsWritable } from "../../session/session-deletion-state.js";
import { recoverDurableJsonPublication } from "../../shared/storage/durable-file.js";
import {
  acknowledgeShortMemoryBatch,
  excludeShortMemoryItemsBySessionIds,
  sortShortMemoryItems,
  collectShortMemoryRecords,
} from "@noobot/memory-protocol/short-memory";

export class ShortMemoryManager {
  constructor(storage) {
    this.storage = storage;
  }

  async readItems(basePath) {
    const filePath = this.storage.shortPath(basePath);
    const short = await this.storage.readOptionalJson(filePath);

    if (short === null) return [];
    if (!isPlainObject(short) || !Array.isArray(short.items)) {
      const error = new Error(`short memory document is invalid: ${filePath}`);
      error.code = "SHORT_MEMORY_DOCUMENT_INVALID";
      throw error;
    }
    return sortShortMemoryItems(short.items);
  }

  async #writeItems(filePath, items) {
    await this.storage.writeJson(filePath, {
      items: sortShortMemoryItems(items),
      updatedAt: new Date().toISOString(),
    });
  }

  async #mutateItems(basePath, update) {
    const filePath = this.storage.shortPath(basePath);
    return sessionMutationCoordinator.run(`${filePath}.lock`, async () => {
      const items = await this.readItems(basePath);
      const retainedItems = await update(items);
      await recoverDurableJsonPublication(filePath);
      if (retainedItems !== items) await this.#writeItems(filePath, retainedItems);
      return { deletedCount: items.length - retainedItems.length };
    });
  }

  async acknowledgeBatch(basePath, entries) {
    return this.#mutateItems(basePath, (items) => acknowledgeShortMemoryBatch(items, entries));
  }

  async removeBySessionIds(basePath, sessionIds = []) {
    return this.#mutateItems(basePath, (items) => {
      const retainedItems = excludeShortMemoryItemsBySessionIds(items, sessionIds);
      return retainedItems.length === items.length ? items : retainedItems;
    });
  }

  async captureDialogToShortMemory({
    basePath,
    userId,
    sessionId,
    parentSessionId,
    dialogProcessId,
    messageRecords,
  }) {
    const records = await collectShortMemoryRecords({ sessionId, dialogProcessId, messageRecords });
    if (!records.length) return false;

    const item = {
      captureId: randomUUID(),
      sessionId,
      parentSessionId,
      records,
      createdAt: new Date().toISOString(),
    };
    await this.#mutateItems(basePath, async (items) => {
      await assertSessionsWritable(basePath, userId, [sessionId, parentSessionId]);
      return [...items, item];
    });
    return true;
  }
}
