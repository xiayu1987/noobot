/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { Buffer } from "node:buffer";
import iconv from "iconv-lite";
import { assertFileText, assertFileTextEncoding } from "./text.js";

function bomEncoding(bytes) {
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return "utf-8";
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return "utf-16le";
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return "utf-16be";
  return null;
}

export function decodeFileDocument(bytes, encoding = "auto") {
  assertFileTextEncoding(encoding);
  const markedEncoding = bomEncoding(bytes);
  if (markedEncoding && encoding !== "auto" && encoding !== markedEncoding) {
    throw new TypeError(`file BOM conflicts with requested encoding ${encoding}`);
  }
  const resolved = encoding === "auto" ? markedEncoding || "utf-8" : encoding;
  let content;
  try {
    content =
      resolved === "gb18030"
        ? iconv.decode(bytes, resolved, { stripBOM: false })
        : new TextDecoder(resolved, { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch (cause) {
    if (!(cause instanceof TypeError)) throw cause;
    throw new TypeError(`file text must be valid ${resolved === "utf-8" ? "UTF-8" : resolved}`, {
      cause,
    });
  }
  assertFileText(content);
  if (!iconv.encode(content, resolved).equals(Buffer.from(bytes))) {
    throw new TypeError(`file text is not losslessly representable as ${resolved}`);
  }
  return { content, encoding: resolved };
}

export function decodeFileText(bytes, encoding = "auto") {
  return decodeFileDocument(bytes, encoding).content;
}

export function encodeFileText(content, encoding = "utf-8") {
  assertFileText(content);
  assertFileTextEncoding(encoding);
  if (encoding === "auto") throw new TypeError("encoding must be resolved before writing");
  const bytes = iconv.encode(content, encoding);
  if (decodeFileText(bytes, encoding) !== content) {
    throw new TypeError(`file text is not losslessly representable as ${encoding}`);
  }
  return bytes;
}
