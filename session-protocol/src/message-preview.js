/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { LENGTH_THRESHOLDS } from "@noobot/shared/length-thresholds";

export function sessionMessagePreviewLimits() {
  const chars = LENGTH_THRESHOLDS.sessionStorage.listMessagePreviewChars;

  return { chars, jsonBytes: 6 * (chars + 2) + 2 };
}

function tokenEnd(source, offset) {
  if (source.charCodeAt(offset) < 0x20)
    throw new TypeError("Invalid JSON string control character");
  if (source[offset] !== "\\") return offset + (source.codePointAt(offset) > 0xffff ? 2 : 1);
  const escape = source[offset + 1];
  if (escape === "u") {
    if (!/^[0-9a-fA-F]{4}$/.test(source.slice(offset + 2, offset + 6)))
      throw new TypeError("Invalid JSON string Unicode escape");
    return offset + 6;
  }
  if (escape === undefined || !'"\\/bfnrt'.includes(escape))
    throw new TypeError("Invalid JSON string escape");
  return offset + 2;
}

function previewResult(content, chars) {
  let end = Math.min(chars, content.length);
  if (
    end > 0 &&
    end < content.length &&
    content.charCodeAt(end - 1) >= 0xd800 &&
    content.charCodeAt(end - 1) <= 0xdbff &&
    content.charCodeAt(end) >= 0xdc00 &&
    content.charCodeAt(end) <= 0xdfff
  )
    end -= 1;
  return { content: content.slice(0, end), contentTruncated: end < content.length };
}

export function decodeSessionMessagePreview(bytes, totalBytes) {
  const { chars, jsonBytes } = sessionMessagePreviewLimits();
  if (
    !ArrayBuffer.isView(bytes) ||
    Object.prototype.toString.call(bytes) !== "[object Uint8Array]" ||
    !Number.isSafeInteger(totalBytes) ||
    totalBytes < bytes.length ||
    bytes.length > jsonBytes
  )
    throw new TypeError("Invalid message preview range");
  const complete = bytes.length === totalBytes;
  const source = new TextDecoder("utf-8", { fatal: true }).decode(bytes, { stream: !complete });
  if (source[0] !== '"') throw new TypeError("Message preview requires a JSON string");
  if (complete) {
    const content = JSON.parse(source);
    if (typeof content !== "string") throw new TypeError("Message preview requires a JSON string");
    return previewResult(content, chars);
  }
  let offset = 1;
  let units = 0;
  while (offset < source.length && units < chars + 2) {
    if (source[offset] === '"') throw new TypeError("Message preview has an invalid JSON boundary");
    const end = tokenEnd(source, offset);
    units += source[offset] === "\\" ? 1 : end - offset;
    offset = end;
  }
  if (units <= chars) throw new TypeError("Message preview ended before its bounded lookahead");
  const content = JSON.parse(`${source.slice(0, offset)}"`);
  return previewResult(content, chars);
}
