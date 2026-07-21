/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

function text(value) {
  return String(value ?? "").trim();
}

function stringify(value) {
  if (value === undefined || value === null) return "";
  if (typeof value === "string") return value.trim();
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return text(value);
  }
}

export function normalizeToolLog(item = {}) {
  const event = text(item.event || item.type).toLowerCase();
  const toolCallId = text(item.toolCallId || item.tool_call_id);
  const detailText = text(item.detailText || item.content);
  const summaryText = text(item.text);
  const isResult = event === "tool_result";
  const inputText = text(item.inputText) || stringify(
    item.args ?? item.arguments ?? item.input ?? (event === "tool_call" ? detailText : ""),
  );
  const outputText = text(item.outputText) || (isResult
    ? (detailText || stringify(item.result ?? item.output ?? item.content))
    : "");
  const normalized = {
    ...item,
    event,
    type: item.type || event,
    toolCallId,
    detailText,
    text: summaryText,
    status: text(item.status) || (isResult
      ? (item.success === false ? "failed" : "succeeded")
      : "running"),
    inputText,
    outputText,
    startedAt: text(item.startedAt || (event === "tool_call" ? (item.timestamp || item.ts) : "")),
    endedAt: text(item.endedAt || (isResult ? (item.timestamp || item.ts) : "")),
  };
  normalized.executionDetail = item.executionDetail || {
    ...(inputText ? { input: inputText } : {}),
    ...(outputText ? { output: outputText } : {}),
  };
  return normalized;
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
  const left = normalizeToolLog(existing);
  const right = normalizeToolLog(incoming);
  if (left.toolCallId && left.toolCallId === right.toolCallId) {
    const resultCandidates = [left, right].filter((item) => item.event === "tool_result");
    const callCandidates = [left, right].filter((item) => item.event === "tool_call");
    const result = resultCandidates.reduce(
      (best, item) => (!best || score(item) > score(best) ? item : best),
      null,
    );
    const call = callCandidates.reduce(
      (best, item) => (!best || score(item) > score(best) ? item : best),
      null,
    );
    const preferred = result || (score(right) > score(left) ? right : left);
    return normalizeToolLog({
      ...left,
      ...right,
      ...preferred,
      event: result ? "tool_result" : "tool_call",
      type: result ? "tool_result" : "tool_call",
      text: result?.text || call?.text || preferred.text,
      detailText: result?.detailText || call?.detailText || preferred.detailText,
      inputText: call?.inputText || left.inputText || right.inputText,
      outputText: result?.outputText || left.outputText || right.outputText,
      startedAt: call?.startedAt || left.startedAt || right.startedAt,
      endedAt: result?.endedAt || left.endedAt || right.endedAt,
      status: result?.status || call?.status || preferred.status,
      executionDetail: null,
    });
  }
  return score(right) > score(left) ? right : left;
}

function findMatchIndex(item, output) {
  const content = toolLogContentKey(item);
  for (let index = output.length - 1; index >= 0; index -= 1) {
    const existing = output[index];
    if (item.toolCallId && existing.toolCallId) {
      if (item.toolCallId === existing.toolCallId) return index;
      continue;
    }
    if (existing.event !== item.event) continue;
    if (item.event === "tool_result" && content && toolLogContentKey(existing) === content) {
      return index;
    }
  }
  return -1;
}

export function aggregateToolExecutions(logs = []) {
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

export const deduplicateToolLogs = aggregateToolExecutions;
