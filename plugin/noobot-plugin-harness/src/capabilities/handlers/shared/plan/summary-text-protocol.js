/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { text } from "@noobot/shared/value";

const SUMMARY_LINE_RE = /^\s*(\d+)\.\s+(.+?)\s*$/;
const PATCH_ADD_UPDATE_RE = /^\s*(ADD|UPDATE)\s+(?:S\s*)?\[?(\d+)\]?\s+(.+?)\s*$/i;
const PATCH_DELETE_RE = /^\s*(DELETE)\s+(?:S\s*)?\[?(\d+)\]?\s*$/i;
const SUMMARY_OVERVIEW_BLOCK_RE =
  /\[SUMMARY_OVERVIEW\]([\s\S]*?)(?=\[SUMMARY_DETAIL\]|\[SUMMARY_END\]|$)/i;
const SUMMARY_DETAIL_BLOCK_RE =
  /\[SUMMARY_DETAIL\]([\s\S]*?)(?=\[NEXT_EXECUTION_SUGGESTION\]|\[SUMMARY_END\]|$)/i;
const NEXT_EXECUTION_SUGGESTION_BLOCK_RE =
  /\[NEXT_EXECUTION_SUGGESTION\]([\s\S]*?)(?=\[SUMMARY_END\]|$)/i;
const SUMMARY_END_MARKER_RE = /\[SUMMARY_END\]/i;

function splitLines(sourceText = "") {
  return String(sourceText || "")
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => text(line))
    .filter(Boolean);
}

function normalizeSummaryItems(items = []) {
  const map = new Map();
  for (const item of Array.isArray(items) ? items : []) {
    const id = Number(item?.id);
    const content = text(item?.content);
    if (!Number.isFinite(id) || id <= 0 || !content) continue;
    map.set(id, { id, content });
  }
  return [...map.values()].sort((a, b) => a.id - b.id);
}

function parseSummaryItemsFromText(inputText = "") {
  const items = [];
  for (const line of splitLines(inputText)) {
    const match = line.match(SUMMARY_LINE_RE);
    if (!match) continue;
    items.push({ id: Number(match[1]), content: text(match[2]) });
  }
  return normalizeSummaryItems(items);
}

function renderSummaryItems(items = []) {
  return normalizeSummaryItems(items)
    .map((item = {}) => `${item.id}. ${item.content}`)
    .join("\n")
    .trim();
}

export function parseSummaryPatchCommands(rawText = "") {
  const commands = [];
  for (const line of splitLines(rawText)) {
    const addOrUpdate = line.match(PATCH_ADD_UPDATE_RE);
    if (addOrUpdate) {
      commands.push({
        action: String(addOrUpdate[1] || "").toUpperCase(),
        id: Number(addOrUpdate[2]),
        content: text(addOrUpdate[3]),
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
  const incoming = text(incomingText);
  const current = text(existingText);
  if (!incoming) return current;

  const patchCommands = parseSummaryPatchCommands(incoming);
  if (patchCommands.length) {
    const map = new Map(
      parseSummaryItemsFromText(current).map((item = {}) => [Number(item.id), item]),
    );
    for (const command of patchCommands) {
      const id = Number(command.id);
      if (!Number.isFinite(id) || id <= 0) continue;
      if (command.action === "DELETE") {
        map.delete(id);
        continue;
      }
      const content = text(command.content);
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

export function parseSummaryOverviewAndDetailFromText(summaryText = "") {
  const raw = text(summaryText);
  if (!raw)
    return {
      overviewText: "",
      detailText: "",
      nextSuggestionText: "",
      trailingText: "",
      usedV2: false,
    };
  const overviewMatch = raw.match(SUMMARY_OVERVIEW_BLOCK_RE);
  const detailMatch = raw.match(SUMMARY_DETAIL_BLOCK_RE);
  const nextSuggestionMatch = raw.match(NEXT_EXECUTION_SUGGESTION_BLOCK_RE);
  const endMatch = raw.match(SUMMARY_END_MARKER_RE);
  if (!overviewMatch && !detailMatch && !nextSuggestionMatch) {
    return {
      overviewText: raw,
      detailText: "",
      nextSuggestionText: "",
      trailingText: "",
      usedV2: false,
    };
  }
  const overviewText = text(overviewMatch?.[1]);
  const detailText = text(detailMatch?.[1]);
  const nextSuggestionText = text(nextSuggestionMatch?.[1]);
  const trailingText = endMatch
    ? String(raw.slice(Number(endMatch.index) + String(endMatch[0] || "").length)).trim()
    : "";
  return {
    overviewText: overviewText || raw,
    detailText,
    nextSuggestionText,
    trailingText,
    usedV2: true,
  };
}
