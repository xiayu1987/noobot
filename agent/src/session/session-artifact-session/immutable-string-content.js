/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { immutableStorageError } from "@noobot/session-protocol/immutable-storage";

export function appendImmutableStringContent(objects, reference, content) {
  if (typeof content !== "string") throw new TypeError("Content append requires a string");
  return objects.replaceValueSuffix(
    reference,
    Buffer.from('"'),
    Buffer.from(JSON.stringify(content).slice(1)),
  );
}

export async function readImmutableStringPrefix(objects, reference, length) {
  if (!Number.isSafeInteger(length) || length < 1)
    throw new TypeError("String prefix length must be a positive integer");
  const maximumBytes = 6 * length + 2;
  const chunks = [];
  let bytes = 0;
  for await (const chunk of objects.readValueChunks(reference)) {
    const selected = chunk.subarray(0, maximumBytes - bytes);
    chunks.push(selected);
    bytes += selected.length;
    if (bytes === maximumBytes) break;
  }
  const encoded = Buffer.concat(chunks).toString();
  if (encoded[0] !== '"') throw immutableStorageError("Message content is not a JSON string");
  let result = "";
  for (let offset = 1; offset < encoded.length && result.length < length;) {
    const character = encoded[offset];
    if (character === '"') return result;
    if (character !== "\\") {
      result += character;
      offset += 1;
    } else {
      const width = encoded[offset + 1] === "u" ? 6 : 2;
      result += JSON.parse('"' + encoded.slice(offset, offset + width) + '"');
      offset += width;
    }
  }
  if (result.length < length) throw immutableStorageError("Truncated JSON string prefix");
  return result;
}
