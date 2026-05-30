/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

const SUMMARY_LINE_RE = /^\s*(\d+)\.\s+(.+?)\s*$/;
const PATCH_ADD_UPDATE_RE = /^\s*(ADD|UPDATE)\s+(\d+)\s+(.+?)\s*$/i;
const PATCH_DELETE_RE = /^\s*(DELETE)\s+(\d+)\s*$/i;
const SUMMARY_OVERVIEW_BLOCK_RE = /\[SUMMARY_OVERVIEW\]([\s\S]*?)(?=\[SUMMARY_DETAIL\]|\[SUMMARY_END\]|$)/i;
const SUMMARY_DETAIL_BLOCK_RE = /\[SUMMARY_DETAIL\]([\s\S]*?)(?=\[SUMMARY_END\]|$)/i;

function splitLines(text = "") {
  return String(text || "")
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => String(line || "").trim())
    .filter(Boolean);
}

function normalizeSummaryItems(items = []) {
  const map = new Map();
  for (const item of Array.isArray(items) ? items : []) {
    const id = Number(item?.id);
    const content = String(item?.content || "").trim();
    if (!Number.isFinite(id) || id <= 0 || !content) continue;
    map.set(id, { id, content });
  }
  return [...map.values()].sort((a, b) => a.id - b.id);
}

export function parseSummaryItemsFromText(text = "") {
  const items = [];
  for (const line of splitLines(text)) {
    const match = line.match(SUMMARY_LINE_RE);
    if (!match) continue;
    items.push({ id: Number(match[1]), content: String(match[2] || "").trim() });
  }
  return normalizeSummaryItems(items);
}

export function renderSummaryItems(items = []) {
  return normalizeSummaryItems(items)
    .map((item = {}) => `${item.id}. ${item.content}`)
    .join("\n")
    .trim();
}

export function parseSummaryPatchCommands(text = "") {
  const commands = [];
  for (const line of splitLines(text)) {
    const addOrUpdate = line.match(PATCH_ADD_UPDATE_RE);
    if (addOrUpdate) {
      commands.push({
        action: String(addOrUpdate[1] || "").toUpperCase(),
        id: Number(addOrUpdate[2]),
        content: String(addOrUpdate[3] || "").trim(),
      });
      continue;
    }
    const del = line.match(PATCH_DELETE_RE);
    if (del) {
      commands.push({
        action: "DELETE",
        id: Number(del[2]),
        content: "",
      });
    }
  }
  return commands.filter((item = {}) => Number.isFinite(item.id) && item.id > 0);
}

export function mergeSummaryText(existingText = "", incomingText = "") {
  const incoming = String(incomingText || "").trim();
  const current = String(existingText || "").trim();
  if (!incoming) return current;

  const patchCommands = parseSummaryPatchCommands(incoming);
  if (patchCommands.length) {
    const map = new Map(parseSummaryItemsFromText(current).map((item = {}) => [Number(item.id), item]));
    for (const command of patchCommands) {
      const id = Number(command.id);
      if (!Number.isFinite(id) || id <= 0) continue;
      if (command.action === "DELETE") {
        map.delete(id);
        continue;
      }
      const content = String(command.content || "").trim();
      if (!content) continue;
      map.set(id, { id, content });
    }
    const rendered = renderSummaryItems([...map.values()]);
    if (rendered) return rendered;
  }

  const incomingItems = parseSummaryItemsFromText(incoming);
  if (incomingItems.length) {
    return renderSummaryItems(incomingItems);
  }

  return [current, incoming].filter(Boolean).join("\n");
}

export function parseSummaryOverviewAndDetailFromText(text = "") {
  const raw = String(text || "").trim();
  if (!raw) return { overviewText: "", detailText: "", usedV2: false };
  const overviewMatch = raw.match(SUMMARY_OVERVIEW_BLOCK_RE);
  const detailMatch = raw.match(SUMMARY_DETAIL_BLOCK_RE);
  if (!overviewMatch && !detailMatch) {
    return { overviewText: raw, detailText: "", usedV2: false };
  }
  const overviewText = String(overviewMatch?.[1] || "").trim();
  const detailText = String(detailMatch?.[1] || "").trim();
  return {
    overviewText: overviewText || raw,
    detailText,
    usedV2: true,
  };
}
