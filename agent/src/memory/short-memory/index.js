/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { resolveSessionMessageRecordDialogProcessId } from "@noobot/session-protocol";
import { isPlainObject } from "@noobot/shared/value";
import {
  excludeShortMemoryItemsBySessionIds,
  sortShortMemoryItems,
  toShortMemoryRecords,
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

  async writeItems(basePath, items = []) {
    await this.storage.writeJson(this.storage.shortPath(basePath), {
      items: sortShortMemoryItems(items),
      updatedAt: new Date().toISOString(),
    });
  }

  async clear(basePath) {
    await this.writeItems(basePath, []);
  }

  async removeBySessionIds(basePath, sessionIds = []) {
    const items = await this.readItems(basePath);
    const retainedItems = excludeShortMemoryItemsBySessionIds(items, sessionIds);
    const deletedCount = items.length - retainedItems.length;
    if (deletedCount > 0) await this.writeItems(basePath, retainedItems);
    return { deletedCount };
  }

  async captureDialogToShortMemory({
    basePath,
    sessionId,
    parentSessionId,
    dialogProcessId,
    messages,
  }) {
    const dialogRecords = messages.filter(
      (messageItem) => resolveSessionMessageRecordDialogProcessId(messageItem) === dialogProcessId,
    );
    const records = toShortMemoryRecords(dialogRecords);
    if (!records.length) return false;

    const items = await this.readItems(basePath);
    items.push({
      sessionId,
      parentSessionId,
      records,
      createdAt: new Date().toISOString(),
    });
    await this.writeItems(basePath, items);
    return true;
  }
}
