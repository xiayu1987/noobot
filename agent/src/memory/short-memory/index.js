/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { resolveContextMessageDialogProcessId } from "@noobot/context-protocol/message/codec";
import {
  excludeShortMemoryItemsBySessionIds,
  sortShortMemoryItems,
  toShortMemoryRecords,
} from "@noobot/memory-protocol/short-memory";
import { normalizeParentSessionId } from "@noobot/session-protocol";
import { filePath as path } from "@noobot/path-resolver";
import { readSessionArtifact } from "../../session/session-artifact-store.js";

export class ShortMemoryManager {
  constructor(storage) {
    this.storage = storage;
  }

  async readItems(basePath) {
    const short = await this.storage.readJson(this.storage.shortPath(basePath), { items: [] });
    return sortShortMemoryItems(short?.items);
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

  async captureSessionToShortMemory({ basePath = "", sessionId = "", parentSessionId = "" } = {}) {
    const normalizedParentSessionId = normalizeParentSessionId(parentSessionId);
    const sessionFile = this.storage.sessionFile(basePath, sessionId, normalizedParentSessionId);
    const sessionData = await readSessionArtifact({
      storageService: this.storage,
      sessionDir: path.dirname(sessionFile),
      fallback: null,
    });
    if (!sessionData) return false;

    const { messages } = sessionData;
    if (!messages.length) return false;
    const latestDialogProcessId =
      [...messages]
        .reverse()
        .map((messageItem) => resolveContextMessageDialogProcessId(messageItem))
        .find(Boolean) || "";
    if (!latestDialogProcessId) return false;

    const dialogRecords = messages.filter(
      (messageItem) => resolveContextMessageDialogProcessId(messageItem) === latestDialogProcessId,
    );
    const records = toShortMemoryRecords(dialogRecords);
    if (!records.length) return false;

    const items = await this.readItems(basePath);
    items.push({
      sessionId: String(sessionId || "").trim(),
      parentSessionId: normalizedParentSessionId,
      records,
      createdAt: new Date().toISOString(),
    });
    await this.writeItems(basePath, items);
    return true;
  }
}
