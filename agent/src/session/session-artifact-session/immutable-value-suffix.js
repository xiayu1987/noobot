/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  IMMUTABLE_VALUE_BLOCK_BYTES,
  IMMUTABLE_VALUE_MAX_DEPTH,
  decodeImmutableInlineValue,
  immutableValueSplitOffset,
  requireImmutableValueBytePage,
  requireImmutableValueBranchChildren,
} from "@noobot/session-protocol/immutable-storage-graph";
import { immutableStorageError } from "@noobot/session-protocol/immutable-storage";

export async function replaceImmutableValueSuffix(objects, reference, expectedSuffix, suffix) {
  if (!Buffer.isBuffer(expectedSuffix) || !Buffer.isBuffer(suffix))
    throw new TypeError("Immutable suffix replacement requires Buffers");
  const pages = new Map();
  const payloads = new Map();
  async function pageOf(ref, depth) {
    if (depth > IMMUTABLE_VALUE_MAX_DEPTH)
      throw immutableStorageError("Immutable value tree exceeds protocol depth");
    if (!pages.has(ref)) {
      objects.requireReference(ref);
      pages.set(ref, requireImmutableValueBytePage(await objects.readPage(ref)));
    }
    return pages.get(ref);
  }
  async function children(page, depth) {
    const left = await pageOf(page.left, depth + 1);
    const right = await pageOf(page.right, depth + 1);
    requireImmutableValueBranchChildren(page, left, right);
    return [left, right];
  }
  async function payloadOf(ref, page) {
    if (!payloads.has(ref)) {
      const payload =
        page.kind === "value-inline"
          ? decodeImmutableInlineValue(page)
          : await objects.read(page.data);
      if (payload.length !== page.bytes)
        throw immutableStorageError("Immutable value size mismatch");
      payloads.set(ref, payload);
    }
    return payloads.get(ref);
  }
  async function readRange(ref, page, { offset, bytes, depth }) {
    if (bytes === 0) return Buffer.alloc(0);
    if (page.kind !== "value-branch")
      return (await payloadOf(ref, page)).subarray(offset, offset + bytes);
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
    return Buffer.concat(chunks);
  }
  const root = await pageOf(reference, 0);
  if (expectedSuffix.length > root.bytes)
    throw immutableStorageError("Immutable suffix exceeds its value");
  const retainedBytes = root.bytes - expectedSuffix.length;
  if (
    !(
      await readRange(reference, root, {
        offset: retainedBytes,
        bytes: expectedSuffix.length,
        depth: 0,
      })
    ).equals(expectedSuffix)
  )
    throw immutableStorageError("Immutable value suffix mismatch");
  const totalBytes = retainedBytes + suffix.length;
  if (!Number.isSafeInteger(totalBytes))
    throw immutableStorageError("Invalid immutable value size");
  async function find(ref, page, { offset, bytes, depth }) {
    if (offset === 0 && bytes === page.bytes) return ref;
    if (page.kind !== "value-branch") return null;
    const [left, right] = await children(page, depth);
    if (offset + bytes <= left.bytes)
      return find(page.left, left, { offset, bytes, depth: depth + 1 });
    if (offset >= left.bytes)
      return find(page.right, right, { offset: offset - left.bytes, bytes, depth: depth + 1 });
    return null;
  }
  async function build(offset, bytes, depth) {
    if (depth > IMMUTABLE_VALUE_MAX_DEPTH)
      throw immutableStorageError("Immutable value tree exceeds protocol depth");
    if (bytes && offset + bytes <= retainedBytes) {
      const retained = await find(reference, root, { offset, bytes, depth: 0 });
      if (retained !== null) return retained;
    }
    if (bytes <= IMMUTABLE_VALUE_BLOCK_BYTES) {
      const oldBytes = Math.max(0, Math.min(bytes, retainedBytes - offset));
      const old = await readRange(reference, root, { offset, bytes: oldBytes, depth: 0 });
      const added = suffix.subarray(
        Math.max(0, offset - retainedBytes),
        Math.max(0, offset + bytes - retainedBytes),
      );
      return objects.putPage(await objects.valueLeaf(Buffer.concat([old, added]), depth === 0));
    }
    const split = immutableValueSplitOffset(bytes);
    return objects.putPage({
      kind: "value-branch",
      left: await build(offset, split, depth + 1),
      right: await build(offset + split, bytes - split, depth + 1),
      bytes,
    });
  }
  return build(0, totalBytes, 0);
}
