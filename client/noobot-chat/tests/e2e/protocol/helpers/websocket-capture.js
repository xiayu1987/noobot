/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { isPlainObject, text, isObjectLike } from "@noobot/shared/value";

function parseJson(value) {
  try {
    return JSON.parse(String(value));
  } catch {
    return null;
  }
}

export function decodeWebSocketPayload(payload) {
  const direct = parseJson(payload);
  if (direct) return direct;
  const raw = String(payload || "");
  const socketIoArray = raw.match(/^\d*\s*(\[.*\])$/s)?.[1];
  return socketIoArray ? parseJson(socketIoArray) : null;
}

export function decodedFrames(records = []) {
  return records
    .map((record) => ({ ...record, decoded: decodeWebSocketPayload(record.payload) }))
    .filter((record) => record.decoded !== null);
}

export function findProtocolObjects(records = []) {
  const objects = [];
  for (const frame of decodedFrames(records)) {
    const value = frame.decoded;
    if (Array.isArray(value) && value.length >= 2)
      objects.push({ event: value[0], data: value[1], frame });
    else if (isObjectLike(value))
      objects.push({ event: value.event || "", data: value.data || value, frame });
  }
  return objects;
}

function visit(value, output, seen) {
  if (!isObjectLike(value) || seen.has(value)) return;
  seen.add(value);
  if (Number(value.protocolVersion) > 0) output.push(value);
  if (Array.isArray(value)) value.forEach((item) => visit(item, output, seen));
  else Object.values(value).forEach((item) => visit(item, output, seen));
}

const capturedEnvelopes = new WeakMap();

function envelopesForFrame(record) {
  const cached = capturedEnvelopes.get(record);
  if (cached !== undefined) return cached;
  const envelopes = [];
  visit(decodeWebSocketPayload(record.payload), envelopes, new Set());

  if (Object.isFrozen(record)) capturedEnvelopes.set(record, envelopes);
  return envelopes;
}

export function findVersionedEnvelopes(records = []) {
  const output = [];
  for (const frame of records) {
    for (const envelope of envelopesForFrame(frame)) output.push(envelope);
  }
  return output;
}

export function findAgentCommands(records = []) {
  const commands = findVersionedEnvelopes(records).filter(
    (item) => typeof item.commandType === "string" && isPlainObject(item.identity),
  );
  const seen = new Set();
  return commands.filter((command) => {
    const commandId = text(command?.commandId);
    if (!commandId) return true;
    if (seen.has(commandId)) return false;
    seen.add(commandId);
    return true;
  });
}

export function findLifecycleEnvelopes(records = []) {
  return findVersionedEnvelopes(records).filter(
    (item) =>
      typeof item.eventType === "string" &&
      typeof item.eventId === "string" &&
      Number(item.sequence) > 0,
  );
}

export function findLifecycleReceipts(records = []) {
  return findVersionedEnvelopes(records).filter(
    (item) => item.action === "turn.lifecycle.received",
  );
}

export function createCapturedFrameLog() {
  const records = [];
  const listeners = new Set();
  return {
    records,
    append(frame) {
      records.push(frame);
      for (const listener of listeners) listener(frame);
    },
    async waitForMatch(select, timeoutMs) {
      for (const frame of records) {
        const match = select(frame);
        if (match) return match;
      }
      return new Promise((resolve, reject) => {
        const settle = (complete, value) => {
          clearTimeout(timer);
          listeners.delete(listener);
          complete(value);
        };
        const listener = (frame) => {
          try {
            const match = select(frame);
            if (match) settle(resolve, match);
          } catch (error) {
            settle(reject, error);
          }
        };
        const timer = setTimeout(
          () => settle(reject, new Error("Timed out waiting for captured protocol evidence")),
          timeoutMs,
        );
        listeners.add(listener);
      });
    },
  };
}

export async function waitForCaptured(predicate, { timeoutMs = 30000, intervalMs = 100 } = {}) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const result = predicate();
    if (result) return result;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error("Timed out waiting for captured protocol evidence");
}
