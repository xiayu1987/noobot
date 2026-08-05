/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

function parseJson(value) {
  try { return JSON.parse(String(value)); } catch { return null; }
}

export function decodeWebSocketPayload(payload) {
  const direct = parseJson(payload);
  if (direct) return direct;
  const text = String(payload || "");
  const socketIoArray = text.match(/^\d*\s*(\[.*\])$/s)?.[1];
  return socketIoArray ? parseJson(socketIoArray) : null;
}

export function decodedFrames(records = []) {
  return records.map((record) => ({ ...record, decoded: decodeWebSocketPayload(record.payload) }))
    .filter((record) => record.decoded !== null);
}

export function findProtocolObjects(records = []) {
  const objects = [];
  for (const frame of decodedFrames(records)) {
    const value = frame.decoded;
    if (Array.isArray(value) && value.length >= 2) objects.push({ event: value[0], data: value[1], frame });
    else if (value && typeof value === "object") objects.push({ event: value.event || "", data: value.data || value, frame });
  }
  return objects;
}

function visit(value, output, seen) {
  if (!value || typeof value !== "object" || seen.has(value)) return;
  seen.add(value);
  if (Number(value.protocolVersion) > 0) output.push(value);
  if (Array.isArray(value)) value.forEach((item) => visit(item, output, seen));
  else Object.values(value).forEach((item) => visit(item, output, seen));
}

export function findVersionedEnvelopes(records = []) {
  const output = [];
  for (const frame of decodedFrames(records)) visit(frame.decoded, output, new Set());
  return output;
}

export function findAgentCommands(records = []) {
  return findVersionedEnvelopes(records).filter((item) => typeof item.commandType === "string");
}

export function findLifecycleEnvelopes(records = []) {
  return findVersionedEnvelopes(records).filter((item) =>
    typeof item.eventType === "string" && typeof item.eventId === "string" && Number(item.sequence) > 0,
  );
}

export function findLifecycleReceipts(records = []) {
  return findVersionedEnvelopes(records).filter((item) => item.action === "turn.lifecycle.received");
}

export async function waitForCaptured(predicate, { timeoutMs = 30_000, intervalMs = 100 } = {}) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const result = predicate();
    if (result) return result;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error("Timed out waiting for captured protocol evidence");
}
