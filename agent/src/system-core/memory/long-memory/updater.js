/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { isBlankLongMemoryContent } from "../utils/format.js";
import { parseIdPatchCommands, parseKvPayload } from "../parsers/id-patch-parser.js";
import path from "node:path";

const MEMORY_LINE_RE = /^\s*(\d+)\.\s+(.+?)\s*$/;

function parseLongMemoryItemsFromText(text = "") {
  const lines = String(text || "")
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => String(line || "").trim())
    .filter(Boolean);
  const map = new Map();
  for (const line of lines) {
    const matched = line.match(MEMORY_LINE_RE);
    if (matched) {
      const id = Number(matched[1]);
      const content = String(matched[2] || "").trim();
      if (Number.isFinite(id) && id > 0 && content) map.set(id, { id, content });
      continue;
    }
    const nextId = map.size + 1;
    map.set(nextId, { id: nextId, content: line });
  }
  return [...map.values()].sort((a, b) => a.id - b.id);
}

function renderLongMemoryItems(items = []) {
  return [...items]
    .filter((item) => Number.isFinite(Number(item?.id)) && String(item?.content || "").trim())
    .sort((a, b) => Number(a.id) - Number(b.id))
    .map((item) => `${Number(item.id)}. ${String(item.content || "").trim()}`)
    .join("\n")
    .trim();
}

function normalizeMetadataItems(items = []) {
  const map = new Map();
  for (const item of Array.isArray(items) ? items : []) {
    const id = Number(item?.id);
    const key = String(item?.key || "").trim();
    const value = String(item?.value || "").trim();
    if (!Number.isFinite(id) || id <= 0 || !key || !value) continue;
    map.set(id, { id, key, value });
  }
  return [...map.values()].sort((a, b) => a.id - b.id);
}

function parseMetadataItemsFromText(text = "") {
  const map = new Map();
  const lines = String(text || "")
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => String(line || "").trim())
    .filter(Boolean);
  for (const line of lines) {
    const matched = /^M(\d+)\s+(.+?)$/i.exec(line);
    if (!matched) continue;
    const id = Number(matched[1]);
    if (!Number.isFinite(id) || id <= 0) continue;
    const kv = parseKvPayload(matched[2]);
    const key = String(kv.key || "").trim();
    const value = String(kv.value || "").trim();
    if (!key || !value) continue;
    map.set(id, { id, key, value });
  }
  return normalizeMetadataItems([...map.values()]);
}

function renderMetadataItems(items = []) {
  return normalizeMetadataItems(items)
    .map((item) => `M${item.id} key="${item.key}" value="${item.value}"`)
    .join("\n")
    .trim();
}

function renderLongMemoryFromMetadataItems(items = []) {
  return normalizeMetadataItems(items)
    .map((item) => {
      const key = String(item?.key || "").trim();
      const value = String(item?.value || "").trim();
      const content = key ? `${key}: ${value}` : value;
      return { id: Number(item.id), content };
    })
    .filter((item) => Number.isFinite(item.id) && item.id > 0 && item.content)
    .map((item) => `${item.id}. ${item.content}`)
    .join("\n")
    .trim();
}

function applyLongMemoryPatch(existingText = "", patchText = "") {
  const map = new Map(
    parseLongMemoryItemsFromText(existingText).map((item) => [Number(item.id), item]),
  );
  const commands = parseIdPatchCommands(patchText, { idPrefix: "L" });
  if (!commands.length) return { changed: false, text: String(existingText || "").trim() };

  let changed = false;
  for (const command of commands) {
    const id = Number(command.id);
    if (!Number.isFinite(id) || id <= 0) continue;
    if (command.action === "DELETE") {
      changed = map.delete(id) || changed;
      continue;
    }
    const content = String(command.payload || "").trim();
    if (!content) continue;
    const current = map.get(id);
    if (!current || String(current.content || "").trim() !== content) {
      map.set(id, { id, content });
      changed = true;
    }
  }
  return { changed, text: renderLongMemoryItems([...map.values()]) };
}

function applyLongMemoryMetadataPatch(existingItems = [], patchText = "") {
  const map = new Map(
    normalizeMetadataItems(existingItems).map((item) => [Number(item.id), item]),
  );
  const commands = parseIdPatchCommands(patchText, { idPrefix: "M" });
  if (!commands.length) return { changed: false, items: normalizeMetadataItems(existingItems) };

  let changed = false;
  for (const command of commands) {
    const id = Number(command.id);
    if (!Number.isFinite(id) || id <= 0) continue;
    if (command.action === "DELETE") {
      changed = map.delete(id) || changed;
      continue;
    }
    const kv = parseKvPayload(command.payload);
    const key = String(kv.key || "").trim();
    const value = String(kv.value || "").trim();
    if (!key || !value) continue;
    const current = map.get(id);
    if (!current || current.key !== key || current.value !== value) {
      map.set(id, { id, key, value });
      changed = true;
    }
  }
  return { changed, items: normalizeMetadataItems([...map.values()]) };
}

export async function updateLongMemory(storage, basePath, patchText) {
  if (isBlankLongMemoryContent(patchText)) return false;
  const longPath = storage.longPath(basePath);
  const metadataPath = storage.longMemoryMetadataPath(basePath);
  const existingLongMemoryText = String(await storage.readText(longPath, "") || "").trim();
  const existingMetadataText = String(await storage.readText(metadataPath, "") || "").trim();

  const legacyLongJsonPath = longPath.replace(/\.md$/i, ".json");
  const legacyMetadataJsonPath = metadataPath.replace(/\.md$/i, ".json");
  const legacyLong = existingLongMemoryText
    ? {}
    : await storage.readJson(legacyLongJsonPath, {});
  const legacyMetadata = existingMetadataText
    ? {}
    : await storage.readJson(legacyMetadataJsonPath, {});

  const existingLongMemory =
    existingLongMemoryText ||
    (typeof legacyLong?.staticMemory === "string"
      ? legacyLong.staticMemory
      : typeof legacyLong?.memory === "string"
        ? legacyLong.memory
        : "");
  const existingMetadataItems = existingMetadataText
    ? parseMetadataItemsFromText(existingMetadataText)
    : normalizeMetadataItems(legacyMetadata?.items);
  const hasLongMemoryPatchCommands =
    parseIdPatchCommands(patchText, { idPrefix: "L" }).length > 0;
  const memoryPatchResult = applyLongMemoryPatch(existingLongMemory, patchText);
  const metadataPatchResult = applyLongMemoryMetadataPatch(existingMetadataItems, patchText);
  if (!memoryPatchResult.changed && !metadataPatchResult.changed) return false;

  const nextMemory =
    String(memoryPatchResult.text || "").trim() ||
    (hasLongMemoryPatchCommands
      ? ""
      : renderLongMemoryFromMetadataItems(metadataPatchResult.items));
  await storage.ensureDir(path.dirname(longPath));
  await storage.writeText(longPath, `${nextMemory}${nextMemory ? "\n" : ""}`);

  await storage.ensureDir(path.dirname(metadataPath));
  const nextMetadataText = renderMetadataItems(metadataPatchResult.items);
  await storage.writeText(
    metadataPath,
    `${nextMetadataText}${nextMetadataText ? "\n" : ""}`,
  );
  return true;
}
