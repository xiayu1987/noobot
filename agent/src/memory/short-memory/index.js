/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { readShortMemory, flattenShortItems, getSortedShortItems } from "./reader.js";
import { writeShortMemory, assignShortItems } from "./writer.js";
import { compactShortMemory } from "./compactor.js";
import { resolveContextMessageDialogProcessId } from "@noobot/context-protocol/message/codec";
import { filePath as path } from "@noobot/path-resolver";
import { readSessionArtifact } from "../../session/session-artifact-store.js";

function sanitizeDialogRecordsForMemory(messages = []) {
  const out = [];
  for (const messageItem of messages) {
    if (messageItem?.injectedMessage === true) continue;
    const role = String(messageItem?.role || "").trim();
    const type = String(messageItem?.type || "").trim();
    if (!["user", "assistant"].includes(role)) continue;
    if (role === "assistant" && type === "tool_call") continue;
    const content = String(messageItem?.content || "").trim();
    if (!content) continue;
    out.push({ role, content });
  }
  return out;
}

export class ShortMemoryManager {
  constructor(storage) {
    this.storage = storage;
  }

  async read(basePath) {
    return readShortMemory(this.storage, basePath);
  }

  flatten(short = {}) {
    return flattenShortItems(short);
  }

  sorted(short = {}) {
    return getSortedShortItems(short);
  }

  assign(short = {}, items = []) {
    assignShortItems(short, items);
  }

  compact(short = {}) {
    compactShortMemory(short);
  }

  async write(basePath, short = {}) {
    await writeShortMemory(this.storage, basePath, short);
  }

  async clear(basePath) {
    await this.write(basePath, { items: [] });
  }

  async removeBySessionIds(basePath, sessionIds = []) {
    const deletedSessionIds = new Set(
      (Array.isArray(sessionIds) ? sessionIds : [])
        .map((value) => String(value || "").trim())
        .filter(Boolean),
    );
    if (!deletedSessionIds.size) return { deletedCount: 0 };
    const short = await this.read(basePath);
    const items = this.flatten(short);
    const retainedItems = items.filter((item) => {
      const sessionId = String(item?.sessionId || "").trim();
      const parentSessionId = String(item?.parentSessionId || "").trim();
      return !deletedSessionIds.has(sessionId) && !deletedSessionIds.has(parentSessionId);
    });
    const deletedCount = items.length - retainedItems.length;
    if (deletedCount > 0) {
      this.assign(short, retainedItems);
      await this.write(basePath, short);
    }
    return { deletedCount };
  }

  async captureSessionToShortMemory({ basePath = "", sessionId = "", parentSessionId = "" } = {}) {
    const sessionFile = this.storage.sessionFile(basePath, sessionId, parentSessionId);
    const sessionData = await readSessionArtifact({
      storageService: this.storage,
      sessionDir: path.dirname(sessionFile),
      fallback: null,
    });
    if (!sessionData) return false;

    const messages = Array.isArray(sessionData.messages) ? sessionData.messages : [];
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
    const records = sanitizeDialogRecordsForMemory(dialogRecords);
    if (!records.length) return false;

    const short = await this.read(basePath);
    const items = this.flatten(short);
    items.push({
      sessionId: String(sessionId || "").trim(),
      parentSessionId: String(parentSessionId || "").trim(),
      records,
      createdAt: new Date().toISOString(),
    });
    this.assign(short, items);
    this.compact(short);
    await this.write(basePath, short);
    return true;
  }
}
