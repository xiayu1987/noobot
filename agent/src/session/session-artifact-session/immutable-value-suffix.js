/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  IMMUTABLE_VALUE_BLOCK_BYTES,
  IMMUTABLE_VALUE_MAX_DEPTH,
  immutableValueSplitOffset,
} from "@noobot/session-protocol/immutable-storage-graph";
import { immutableStorageError } from "@noobot/session-protocol/immutable-storage";
import { createImmutableValueRangeReader } from "./immutable-value-range.js";

export async function replaceImmutableValueSuffix(objects, reference, expectedSuffix, suffix) {
  if (!Buffer.isBuffer(expectedSuffix) || !Buffer.isBuffer(suffix))
    throw new TypeError("Immutable suffix replacement requires Buffers");
  const { pageOf, children, readRange } = createImmutableValueRangeReader(objects);
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

  async function locate(source, offset, bytes) {
    while (source.page.kind === "value-branch") {
      const { page, start, depth } = source;
      if (offset === start && bytes === page.bytes) break;
      const [left, right] = await children(page, depth);
      const split = start + left.bytes;
      if (offset + bytes <= split) source = { ref: page.left, page: left, start, depth: depth + 1 };
      else if (offset >= split)
        source = { ref: page.right, page: right, start: split, depth: depth + 1 };
      else break;
    }
    return source;
  }
  async function build(offset, bytes, depth, source) {
    if (depth > IMMUTABLE_VALUE_MAX_DEPTH)
      throw immutableStorageError("Immutable value tree exceeds protocol depth");
    const oldBytes = Math.max(0, Math.min(bytes, retainedBytes - offset));
    if (oldBytes) {
      source = await locate(source, offset, oldBytes);
      if (oldBytes === bytes && offset === source.start && bytes === source.page.bytes)
        return source.ref;
    }
    if (bytes <= IMMUTABLE_VALUE_BLOCK_BYTES) {
      const added = suffix.subarray(
        Math.max(0, offset - retainedBytes),
        Math.max(0, offset + bytes - retainedBytes),
      );
      const data = oldBytes
        ? Buffer.concat(
            [
              await readRange(source.ref, source.page, {
                offset: offset - source.start,
                bytes: oldBytes,
                depth: source.depth,
              }),
              added,
            ],
            bytes,
          )
        : added;
      return objects.putPage(await objects.valueLeaf(data, depth === 0));
    }
    const split = immutableValueSplitOffset(bytes);
    return objects.putPage({
      kind: "value-branch",
      left: await build(offset, split, depth + 1, source),
      right: await build(offset + split, bytes - split, depth + 1, source),
      bytes,
    });
  }
  return build(0, totalBytes, 0, { ref: reference, page: root, start: 0, depth: 0 });
}
