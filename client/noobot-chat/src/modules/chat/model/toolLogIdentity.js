/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

function text(value) {
  return String(value ?? "").trim();
}

function detail(value) {
  if (value === undefined || value === null || value === "") return "";
  if (typeof value === "string") return value.trim();
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

export function toolLogDetailKey(item = {}) {
  const toolCallId = text(item.toolCallId);
  const event = text(item.event).toLowerCase();
  if (!["tool_call", "tool_result"].includes(event)) return "";
  if (toolCallId) return `tool:${toolCallId}:${event === "tool_result" ? "result" : "call"}`;
  const eventId = text(item.eventId);
  return eventId ? `event:${eventId}` : "";
}

export function normalizeToolLog(item = {}) {
  const event = text(item.event).toLowerCase();
  const eventId = text(item.eventId);
  const toolCallId = text(item.toolCallId);
  const summaryText = text(item.text);
  const detailText = detail(item.detailText) || detail(item.args) || detail(item.result) || summaryText;
  return { ...item, eventId, event, type: event, toolCallId, detailText, text: summaryText };
}

function score(item) {
  const log = normalizeToolLog(item);
  return (log.toolCallId ? 8 : 0) + (log.text ? 4 : 0) + (log.detailText ? 2 : 0) + Object.keys(item || {}).length / 1000;
}

export function mergeToolLog(existing, incoming) {
  return score(incoming) > score(existing) ? incoming : existing;
}

export function deduplicateToolLogs(logs = []) {
  const output = [];
  const indexByIdentity = new Map();
  for (const raw of Array.isArray(logs) ? logs : []) {
    const item = normalizeToolLog(raw);
    const identity = toolLogDetailKey(item) || (item.eventId ? `event:${item.eventId}` : "");
    const index = identity ? indexByIdentity.get(identity) : undefined;
    if (index === undefined) {
      if (identity) indexByIdentity.set(identity, output.length);
      output.push(item);
    } else {
      output[index] = mergeToolLog(output[index], item);
    }
  }
  return output;
}
