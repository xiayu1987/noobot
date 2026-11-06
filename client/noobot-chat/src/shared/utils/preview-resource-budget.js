/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { LENGTH_THRESHOLDS } from "@noobot/shared/length-thresholds";

export function createPreviewResourceBudget(signal) {
  let consumed = 0;
  let reserved = 0;
  const waiters = new Set();
  const wake = () => {
    for (const resolve of waiters) resolve();
    waiters.clear();
  };
  signal.addEventListener("abort", wake, { once: true });
  return async (read) => {
    const total = LENGTH_THRESHOLDS.clientPreview.resourceTotalBytes;
    while (consumed + reserved >= total && reserved > 0) {
      signal.throwIfAborted();
      await new Promise((resolve) => waiters.add(resolve));
    }
    signal.throwIfAborted();
    const maxBytes = Math.min(
      LENGTH_THRESHOLDS.clientPreview.resourceMaxBytes,
      total - consumed - reserved,
    );
    if (maxBytes <= 0) throw new Error("FILE_PREVIEW_RESOURCE_BYTES_EXCEEDED");
    reserved += maxBytes;
    let bytes = 0;
    try {
      const blob = await read(maxBytes, (count) => {
        bytes = Math.max(bytes, count);
      });
      signal.throwIfAborted();
      bytes = Math.max(bytes, blob.size);
      if (bytes > maxBytes) throw new Error("FILE_PREVIEW_RESOURCE_BYTES_EXCEEDED");
      return blob;
    } finally {
      consumed += bytes;
      reserved -= maxBytes;
      wake();
    }
  };
}

export function readInlinePreviewResource(value, maxBytes, onBytes) {
  const comma = value.indexOf(",");
  if (comma < 0) throw new Error("FILE_PREVIEW_RESOURCE_DATA_INVALID");
  const header = value.slice(5, comma);
  const encoded = value.slice(comma + 1);
  if (encoded.length > maxBytes * 3) throw new Error("FILE_PREVIEW_RESOURCE_BYTES_EXCEEDED");
  const base64 = /;base64$/iu.test(header);
  let bytes;
  try {
    bytes = base64
      ? decodeBase64Bytes(encoded, maxBytes, onBytes)
      : decodePercentBytes(encoded, maxBytes, onBytes);
  } catch (error) {
    if (error.message === "FILE_PREVIEW_RESOURCE_BYTES_EXCEEDED") throw error;
    throw new Error("FILE_PREVIEW_RESOURCE_DATA_INVALID");
  }
  if (bytes.byteLength > maxBytes) throw new Error("FILE_PREVIEW_RESOURCE_BYTES_EXCEEDED");
  return new Blob([bytes], { type: header.split(";")[0] });
}

function decodeBase64Bytes(encoded, maxBytes, onBytes) {
  const binary = atob(decodeURIComponent(encoded));
  onBytes(binary.length);
  if (binary.length > maxBytes) throw new Error("FILE_PREVIEW_RESOURCE_BYTES_EXCEEDED");
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

function decodePercentBytes(encoded, maxBytes, onBytes) {
  const bytes = new Uint8Array(Math.min(encoded.length * 3, maxBytes));
  const encoder = new TextEncoder();
  let size = 0;
  const append = (chunk) => {
    const offset = size;
    size += chunk.length;
    if (size > maxBytes) throw new Error("FILE_PREVIEW_RESOURCE_BYTES_EXCEEDED");
    bytes.set(chunk, offset);
  };
  const decode = () => {
    for (let index = 0; index < encoded.length;) {
      if (encoded[index] === "%") {
        const hex = encoded.slice(index + 1, index + 3);
        if (!/^[a-f\d]{2}$/iu.test(hex)) throw new Error("FILE_PREVIEW_RESOURCE_DATA_INVALID");
        append([Number.parseInt(hex, 16)]);
        index += 3;
        continue;
      }
      const end = encoded.indexOf("%", index);
      const next = end < 0 ? encoded.length : end;
      append(encoder.encode(encoded.slice(index, next)));
      index = next;
    }
  };
  try {
    decode();
  } finally {
    onBytes(size);
  }
  return bytes.subarray(0, size);
}
