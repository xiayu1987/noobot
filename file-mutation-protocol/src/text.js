/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
export const FILE_TEXT_ENCODINGS = Object.freeze(["utf-8", "utf-16le", "utf-16be", "gb18030"]);
export const FILE_TEXT_ENCODING_INPUTS = Object.freeze(["auto", ...FILE_TEXT_ENCODINGS]);

export function assertFileText(content) {
  if (typeof content !== "string" || !content.isWellFormed()) {
    throw new TypeError("file text must be a well-formed Unicode string");
  }
  return content;
}

export function assertFileTextEncoding(encoding) {
  if (!FILE_TEXT_ENCODING_INPUTS.includes(encoding)) {
    throw new TypeError(`unsupported file text encoding: ${encoding}`);
  }
  return encoding;
}

export function resolveFileWriteEncoding(encoding, sourceEncoding = null) {
  assertFileTextEncoding(encoding);
  if (sourceEncoding !== null && !FILE_TEXT_ENCODINGS.includes(sourceEncoding)) {
    throw new TypeError("source encoding must be resolved");
  }
  return encoding === "auto" ? (sourceEncoding ?? "utf-8") : encoding;
}
