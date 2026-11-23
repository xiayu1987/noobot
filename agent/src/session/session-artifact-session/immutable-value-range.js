/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  IMMUTABLE_VALUE_MAX_DEPTH,
  decodeImmutableInlineValue,
  requireImmutableValueBytePage,
  requireImmutableValueBranchChildren,
} from "@noobot/session-protocol/immutable-storage-graph";
import { immutableStorageError } from "@noobot/session-protocol/immutable-storage";

export function createImmutableValueRangeReader(objects, { signal } = {}) {
  const pages = new Map();
  const payloads = new Map();
  async function pageOf(ref, depth) {
    signal?.throwIfAborted();
    if (depth > IMMUTABLE_VALUE_MAX_DEPTH)
      throw immutableStorageError("Immutable value tree exceeds protocol depth");
    const cached = pages.get(ref);
    if (cached !== undefined) return cached;
    objects.requireReference(ref);
    const page = requireImmutableValueBytePage(await objects.readPage(ref));
    pages.set(ref, page);
    return page;
  }
  async function children(page, depth) {
    const left = await pageOf(page.left, depth + 1);
    const right = await pageOf(page.right, depth + 1);
    requireImmutableValueBranchChildren(page, left, right);
    return [left, right];
  }
  async function readRange(ref, page, { offset, bytes, depth }) {
    signal?.throwIfAborted();
    if (bytes === 0) return Buffer.alloc(0);
    if (page.kind === "value-branch") {
      const [left, right] = await children(page, depth);
      const cut = Math.max(0, Math.min(bytes, left.bytes - offset));
      const chunks = [];
      if (cut)
        chunks.push(await readRange(page.left, left, { offset, bytes: cut, depth: depth + 1 }));
      if (bytes > cut)
        chunks.push(
          await readRange(page.right, right, {
            offset: Math.max(0, offset - left.bytes),
            bytes: bytes - cut,
            depth: depth + 1,
          }),
        );
      return Buffer.concat(chunks, bytes);
    }
    if (!payloads.has(ref)) {
      const payload =
        page.kind === "value-inline"
          ? decodeImmutableInlineValue(page)
          : await objects.read(page.data);
      signal?.throwIfAborted();
      if (payload.length !== page.bytes)
        throw immutableStorageError("Immutable value size mismatch");
      payloads.set(ref, payload);
    }
    return payloads.get(ref).subarray(offset, offset + bytes);
  }
  return { pageOf, children, readRange };
}

export async function readImmutableValueRange(objects, reference, { offset, length, signal }) {
  if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(length) || length < 0)
    throw new TypeError("Value range requires non-negative safe integer bounds");
  const reader = createImmutableValueRangeReader(objects, { signal });
  const root = await reader.pageOf(reference, 0);
  if (offset > root.bytes) throw new RangeError("Value range starts beyond its content");
  const bytes = await reader.readRange(reference, root, {
    offset,
    bytes: Math.min(length, root.bytes - offset),
    depth: 0,
  });
  return { bytes, totalBytes: root.bytes };
}
