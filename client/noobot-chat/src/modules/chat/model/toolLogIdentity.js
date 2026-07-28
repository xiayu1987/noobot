/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

function text(value) {
  return String(value ?? "").trim();
}

export function normalizeToolLog(item = {}) {
  const event = text(item.event || item.type).toLowerCase();
  const toolCallId = text(item.toolCallId || item.tool_call_id);
  const detailText = text(item.detailText || item.content);
  const summaryText = text(item.text);
  return { ...item, event, type: item.type || event, toolCallId, detailText, text: summaryText };
}

export function toolLogContentKey(item = {}) {
  const log = normalizeToolLog(item);
  return log.event === "tool_result" ? (log.detailText || log.text) : "";
}

function score(item) {
  const log = normalizeToolLog(item);
  return (log.toolCallId ? 8 : 0) + (log.text ? 4 : 0) + (log.detailText ? 2 : 0) + Object.keys(item || {}).length / 1000;
}

export function mergeToolLog(existing, incoming) {
  return score(incoming) > score(existing) ? incoming : existing;
}

function findMatchIndex(item, output) {
  const content = toolLogContentKey(item);
  for (let index = output.length - 1; index >= 0; index -= 1) {
    const existing = output[index];
    if (existing.event !== item.event) continue;
    if (item.toolCallId && existing.toolCallId) {
      if (item.toolCallId === existing.toolCallId) return index;
      continue;
    }
    if (item.event === "tool_result" && content && toolLogContentKey(existing) === content) {
      return index;
    }
  }
  return -1;
}

export function deduplicateToolLogs(logs = []) {
  const output = [];
  for (const raw of Array.isArray(logs) ? logs : []) {
    const item = normalizeToolLog(raw);
    const hasIdentity = Boolean(item.toolCallId) ||
      (item.event === "tool_result" && Boolean(toolLogContentKey(item)));
    const index = hasIdentity ? findMatchIndex(item, output) : -1;
    if (index === -1) output.push(item);
    else output[index] = mergeToolLog(output[index], item);
  }
  return output;
}
