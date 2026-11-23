/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { isPlainObject, stableValue } from "@noobot/shared/value";

function requireRecord(record) {
  if (
    !isPlainObject(record) ||
    !["user", "assistant"].includes(record.role) ||
    typeof record.content !== "string" ||
    !record.content.length ||
    Object.keys(record).length !== 2
  )
    throw new TypeError("Invalid short memory text record");
}

function safePrefixLength(content, length) {
  const previous = content.charCodeAt(length - 1);
  const next = content.charCodeAt(length);
  return previous >= 0xd800 && previous <= 0xdbff && next >= 0xdc00 && next <= 0xdfff
    ? length - 1
    : length;
}

function fitRecord(record, available) {
  let low = 0;
  let high = Math.min(record.content.length, available);
  while (low < high) {
    const middle = low + Math.ceil((high - low) / 2);
    const size = JSON.stringify({
      role: record.role,
      content: record.content.slice(0, middle),
    }).length;
    if (size <= available) low = middle;
    else high = middle - 1;
  }
  return safePrefixLength(record.content, low);
}

function selectItem(source, available) {
  if (!isPlainObject(source) || !Array.isArray(source.records))
    throw new TypeError("Invalid short memory batch item");
  const records = [];
  let size = JSON.stringify({ records }).length;
  if (size > available) return null;
  let end = { record: 0, offset: 0 };
  for (const record of source.records) {
    requireRecord(record);
    const separator = records.length ? 1 : 0;
    const length = fitRecord(record, available - size - separator);
    if (!length) break;
    const fragment = { role: record.role, content: record.content.slice(0, length) };
    size += separator + JSON.stringify(fragment).length;
    records.push(fragment);
    if (length < record.content.length) {
      end = { record: end.record, offset: length };
      break;
    }
    end = { record: end.record + 1, offset: 0 };
  }
  if (source.records.length && !records.length) return null;
  return { entry: { source, end }, payload: { records }, size };
}

export function selectShortMemoryBatch(items, { maxItems, maxChars }) {
  if (
    !Array.isArray(items) ||
    !Number.isSafeInteger(maxItems) ||
    maxItems < 1 ||
    !Number.isSafeInteger(maxChars) ||
    maxChars < 2
  )
    throw new TypeError("Short memory batch requires positive item and character budgets");
  const entries = [];
  const promptPayload = [];
  let size = 2;
  for (let index = 0; index < Math.min(items.length, maxItems); index += 1) {
    const separator = entries.length ? 1 : 0;
    const selected = selectItem(items[index], maxChars - size - separator);
    if (!selected) break;
    entries.push(selected.entry);
    promptPayload.push(selected.payload);
    size += separator + selected.size;
    if (selected.entry.end.record < items[index].records.length) break;
  }
  if (items.length && !entries.length)
    throw new RangeError("Short memory batch budget cannot fit one text code point");
  return { entries, promptPayload };
}

function remainderOf({ source, end }) {
  if (
    !isPlainObject(source) ||
    !Array.isArray(source.records) ||
    !isPlainObject(end) ||
    !Number.isSafeInteger(end.record) ||
    !Number.isSafeInteger(end.offset) ||
    end.record < 0 ||
    end.offset < 0 ||
    end.record > source.records.length
  )
    throw new TypeError("Invalid short memory batch confirmation range");
  if (end.record === source.records.length) {
    if (end.offset !== 0) throw new TypeError("Confirmation offset exceeds item");
    return null;
  }
  const record = source.records[end.record];
  requireRecord(record);
  if (
    (end.record === 0 && end.offset === 0) ||
    end.offset >= record.content.length ||
    safePrefixLength(record.content, end.offset) !== end.offset
  )
    throw new TypeError("Confirmation must advance at a text boundary");
  const records = source.records.slice(end.record);
  if (end.offset) records[0] = { ...record, content: record.content.slice(end.offset) };
  return { ...source, records };
}

export function acknowledgeShortMemoryBatch(items, entries) {
  if (!Array.isArray(items) || !Array.isArray(entries))
    throw new TypeError("Short memory batch confirmation requires snapshots");
  const replacements = new Map();
  const keyOf = (item) => JSON.stringify(stableValue(item));
  for (const entry of entries) {
    const remainder = remainderOf(entry);
    const key = keyOf(entry.source);
    if (!replacements.has(key)) replacements.set(key, []);
    replacements.get(key).push(remainder);
  }
  let changed = false;
  const retained = [];
  for (const item of items) {
    const pending = replacements.get(keyOf(item));
    if (!pending?.length) {
      retained.push(item);
      continue;
    }
    changed = true;
    const remainder = pending.shift();
    if (remainder !== null) retained.push(remainder);
  }
  return changed ? retained : items;
}
