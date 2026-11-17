/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import fs from "node:fs/promises";

export async function readFilePrefix(file, maxBytes, openFile = fs.open) {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1)
    throw new TypeError("File prefix size must be a positive safe integer");
  const handle = await openFile(file, "r");
  return readHandlePrefix(handle, maxBytes);
}

export async function readHandlePrefix(handle, maxBytes) {
  let failed = false;
  let failure;
  let result;
  try {
    if (!Number.isSafeInteger(maxBytes) || maxBytes < 1)
      throw new TypeError("File prefix size must be a positive safe integer");
    const buffer = Buffer.allocUnsafe(maxBytes);
    let offset = 0;
    while (offset < buffer.length) {
      const { bytesRead } = await handle.read(buffer, offset, buffer.length - offset, offset);
      if (bytesRead === 0) break;
      offset += bytesRead;
    }
    result = Buffer.from(buffer.subarray(0, offset));
  } catch (error) {
    failed = true;
    failure = error;
  }
  try {
    await handle.close();
  } catch (error) {
    if (failed)
      throw new AggregateError([failure, error], "File prefix read and close failed", {
        cause: failure,
      });
    throw error;
  }
  if (failed) throw failure;
  return result;
}
