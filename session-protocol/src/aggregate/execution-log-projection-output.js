/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { isPlainObject } from "@noobot/shared/value";
import { LENGTH_THRESHOLDS } from "@noobot/shared/length-thresholds";
import { storageDigest } from "#storage-digest";
import { requireDialogProcessKey } from "../identity.js";
import {
  MESSAGE_DIAGNOSTIC_SOURCE,
  requireMessageDiagnosticSource,
} from "../message-diagnostic-source.js";

export const EXECUTION_PROJECTION_OUTPUT_VERSION = 1;
export const EXECUTION_PROJECTION_PENDING_SUFFIX = ".projection-pending.json";
export const EXECUTION_PROJECTION_OUTPUT_MAX_RECEIPTS = 100;

export function executionProjectionOutputRecordBytes() {
  return LENGTH_THRESHOLDS.sessionStorage.executionProjectionOutputRecordBytes;
}

const SIZING_CHECKSUM = storageDigest("");
const utf8 = new TextEncoder();

export function executionProjectionOutputEntryBytes(line, receipt) {
  const intent = requireExecutionProjectionIntent({
    version: EXECUTION_PROJECTION_OUTPUT_VERSION,
    offset: Number.MAX_SAFE_INTEGER,
    payload: line,
    receipts: [receipt],
  });
  const payload = JSON.stringify(intent);
  const raw = `${JSON.stringify({ payload, checksum: SIZING_CHECKSUM })}\n`;
  const bytes = utf8.encode(raw).byteLength;
  if (bytes > executionProjectionOutputRecordBytes())
    throw new RangeError("Projection output entry exceeds its byte budget");
  return bytes;
}

export function encodeExecutionProjectionOutputRecord(value) {
  const payload = JSON.stringify(value);
  const raw = `${JSON.stringify({ payload, checksum: storageDigest(payload) })}\n`;
  if (new TextEncoder().encode(raw).byteLength > executionProjectionOutputRecordBytes())
    throw new RangeError("Projection output record exceeds its byte budget");
  return raw;
}

export function decodeExecutionProjectionOutputRecord(bytes) {
  if (bytes.byteLength > executionProjectionOutputRecordBytes())
    throw new RangeError("Projection output record exceeds its byte budget");
  const value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  if (
    !isPlainObject(value) ||
    Object.keys(value).length !== 2 ||
    typeof value.payload !== "string" ||
    storageDigest(value.payload) !== value.checksum
  )
    throw new TypeError("Invalid projection output record checksum");
  const record = JSON.parse(value.payload);
  if (!isPlainObject(record)) throw new TypeError("Projection output record must be an object");
  return record;
}

export function requireExecutionProjectionSourceId(value) {
  if (typeof value !== "string") throw new TypeError("Projection source identity is required");
  const identity = JSON.parse(value);
  if (!Array.isArray(identity) || identity.length !== 3 || JSON.stringify(identity) !== value)
    throw new TypeError("Invalid projection source identity");
  if (identity[0] === MESSAGE_DIAGNOSTIC_SOURCE) return requireMessageDiagnosticSource(identity);
  requireDialogProcessKey(identity[0]);
  if (
    !Number.isSafeInteger(identity[1]) ||
    identity[1] < 1 ||
    !Number.isSafeInteger(identity[2]) ||
    identity[2] < 0
  )
    throw new TypeError("Invalid projection source position");
  return identity;
}

export function requireExecutionProjectionSourceOwner(
  sourceId,
  { sessionId, dialogProcessId, event },
) {
  const identity = requireExecutionProjectionSourceId(sourceId);
  requireDialogProcessKey(dialogProcessId);
  if (identity[0] === MESSAGE_DIAGNOSTIC_SOURCE) {
    if (identity[1] !== sessionId || event !== "session_turn_full")
      throw new TypeError("Diagnostic projection identity must belong to its session source");
  } else if (identity[0] !== dialogProcessId) {
    throw new TypeError("Projection identity must belong to its session turn");
  }
  return identity;
}

export function compareExecutionProjectionSources(left, right) {
  const a = requireExecutionProjectionSourceId(left);
  const b = requireExecutionProjectionSourceId(right);
  if (a[0] === MESSAGE_DIAGNOSTIC_SOURCE || b[0] === MESSAGE_DIAGNOSTIC_SOURCE) {
    if (a[0] !== b[0] || a[1] !== b[1])
      throw new TypeError("Projection receipt belongs to another source stream");
    return Math.sign(a[2] - b[2]);
  }
  if (a[0] !== b[0]) throw new TypeError("Projection receipt belongs to another turn");
  return Math.sign(a[1] - b[1]) || Math.sign(a[2] - b[2]);
}

export function requireExecutionProjectionDeliveryContext(value) {
  if (
    !isPlainObject(value) ||
    Object.keys(value).length !== 1 ||
    typeof value.receiptDirectory !== "string" ||
    !value.receiptDirectory
  )
    throw new TypeError("Projection requires an explicit receipt directory");
  return value;
}

export function executionProjectionReceiptName(destination) {
  if (typeof destination !== "string" || !/^[a-z][a-z0-9-]*\.jsonl$/.test(destination))
    throw new TypeError("Invalid projection destination name");
  return `projection-receipt.${destination}.json`;
}

export function requireExecutionProjectionReceipt(value) {
  if (
    !isPlainObject(value) ||
    Object.keys(value).length !== 2 ||
    value.version !== EXECUTION_PROJECTION_OUTPUT_VERSION
  )
    throw new TypeError("Invalid projection output receipt");
  requireExecutionProjectionSourceId(value.sourceId);
  return value;
}

export function requireExecutionProjectionIntent(value) {
  if (
    !isPlainObject(value) ||
    Object.keys(value).length !== 4 ||
    value.version !== EXECUTION_PROJECTION_OUTPUT_VERSION ||
    !Number.isSafeInteger(value.offset) ||
    value.offset < 0 ||
    typeof value.payload !== "string" ||
    !value.payload.endsWith("\n") ||
    !Array.isArray(value.receipts) ||
    !value.receipts.length ||
    value.receipts.length > EXECUTION_PROJECTION_OUTPUT_MAX_RECEIPTS
  )
    throw new TypeError("Invalid projection output intent");
  const files = new Set();
  for (const item of value.receipts) {
    if (
      !isPlainObject(item) ||
      Object.keys(item).length !== 2 ||
      typeof item.file !== "string" ||
      !item.file
    )
      throw new TypeError("Invalid projection intent receipt");
    requireExecutionProjectionSourceId(item.sourceId);
    if (files.has(item.file)) throw new TypeError("Duplicate projection intent receipt");
    files.add(item.file);
  }
  return value;
}

export function executionProjectionPendingReceipts(intent, currentReceipts) {
  requireExecutionProjectionIntent(intent);
  if (!Array.isArray(currentReceipts) || currentReceipts.length !== intent.receipts.length)
    throw new TypeError("Projection recovery requires every intent receipt");
  const pending = [];
  let advanced = false;
  for (const [position, expected] of intent.receipts.entries()) {
    const current = currentReceipts[position];
    if (current === null) {
      pending.push(expected);
      continue;
    }
    requireExecutionProjectionReceipt(current);
    const comparison = compareExecutionProjectionSources(current.sourceId, expected.sourceId);
    if (comparison < 0) pending.push(expected);
    if (comparison > 0) advanced = true;
  }
  if (advanced && pending.length)
    throw new TypeError("Projection recovery has advanced and unconfirmed receipts");
  return pending;
}
