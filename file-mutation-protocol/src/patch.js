/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

export const PATCH_FORMATS = Object.freeze(["apply_patch", "unified_diff"]);
export const PATCH_CONTENT_ENCODINGS = Object.freeze(["raw", "read_file_numbered"]);
export const PATCH_SHA256_PATTERN = /^[0-9a-f]{64}$/;
export const PATCH_LINE_ANCHOR_PATTERN = /^@@ L([1-9]\d*)$/;
const NUMBERED_LINE_PATTERN = /^ *(\d+)\t/;

import { assertFileText } from "./text.js";

function classifyLineEndings(kinds) {
  if (kinds.size > 1) return "mixed";
  if (kinds.has("\r\n")) return "crlf";
  if (kinds.has("\n")) return "lf";
  return "none";
}

export function decodePatchText(original, encoding = "utf-8") {
  assertFileText(original);
  const bom = original.startsWith("\uFEFF") ? "\uFEFF" : "";
  const content = original.slice(bom.length);
  const finalNewline = content.endsWith("\n");
  const lines = content.length ? content.split(/\r?\n/) : [];
  if (finalNewline) lines.pop();
  const endings = [...content.matchAll(/\r?\n/g)].map((match) => match[0]);
  if (lines.length > endings.length) endings.push("");
  const kinds = new Set(endings.filter(Boolean));
  const ending = kinds.size === 0 ? "\n" : endings[0];
  const lineEnding = classifyLineEndings(kinds);
  const textFormat = {
    encoding,
    bom: Boolean(bom),
    finalNewline,
    lineEnding,
    insertionEnding: ending,
  };
  return { bom, lines, endings, finalNewline, ending, textFormat };
}

export function encodePatchText({ bom, lines, endings, finalNewline, ending }) {
  if (lines.length !== endings.length)
    throw new TypeError("line terminators must cover every line");
  return (
    bom +
    lines
      .map((line, index) => {
        const terminal = index === lines.length - 1;
        const terminator = terminal && !finalNewline ? "" : endings[index] || ending;
        return line + terminator;
      })
      .join("")
  );
}

export function indexPatchOperations(operations) {
  const sources = new Map();
  const writes = new Map();
  const removals = new Map();
  operations.forEach(({ mode, source, destination }, index) => {
    if (!["add", "delete", "update", "move"].includes(mode)) {
      throw new TypeError(`unknown patch operation: ${mode}`);
    }
    if (mode !== "add") {
      if (!source || sources.has(source)) throw new TypeError("duplicate or missing patch source");
      sources.set(source, index);
    }
    if (mode !== "delete") {
      if (!destination || writes.has(destination)) {
        throw new TypeError("duplicate or missing patch destination");
      }
      writes.set(destination, index);
    }
    if (mode === "delete" || (mode === "move" && source !== destination)) {
      removals.set(source, index);
    }
  });
  return { writes, deletes: new Map([...removals].filter(([path]) => !writes.has(path))) };
}

export function validateUnifiedNewlineMarkers(hunks) {
  for (const excluded of ["+", "-"]) {
    const lines = hunks.flatMap((hunk) => hunk.lines.filter((line) => line.type !== excluded));
    if (lines.some((line, index) => line.noFinalNewline && index !== lines.length - 1)) {
      throw new TypeError("no-newline marker must terminate its side of the file patch");
    }
  }
}

export function formatLinesWithNumbers(lines, startLine) {
  return lines.map((line, index) => `${String(startLine + index).padStart(6)}\t${line}`).join("\n");
}

export function indexPatchBaseVersions(baseVersions, targets) {
  const paths = new Map(targets.map(({ filePath, identity }) => [filePath, identity]));
  const versions = new Map();
  for (const { filePath, sha256 } of baseVersions) {
    const identity = paths.get(filePath);
    if (
      !identity ||
      versions.has(identity) ||
      (sha256 !== null && (typeof sha256 !== "string" || !PATCH_SHA256_PATTERN.test(sha256)))
    ) {
      throw new TypeError(
        "baseVersions contains an unknown path, duplicate identity or invalid sha256",
      );
    }
    versions.set(identity, sha256);
  }
  for (const [filePath, identity] of paths) {
    if (!versions.has(identity)) {
      throw new TypeError(
        `baseVersions must cover every patch source and destination: ${filePath}; use the read result baseSha256 for existing files or sha256: null for absent targets`,
      );
    }
  }
  return versions;
}

export function adaptPatchHunks(hunks, contentEncoding) {
  if (!PATCH_CONTENT_ENCODINGS.includes(contentEncoding)) {
    throw new TypeError(`unsupported patch content encoding: ${contentEncoding}`);
  }
  const adaptations = [];
  const adapted = hunks.map((hunk) => {
    if (contentEncoding === "raw") return hunk;
    const oldLines = hunk.lines.filter((line) => line.type !== "+");
    if (!oldLines.length) {
      throw new TypeError("read_file_numbered requires numbered context or removal lines");
    }
    const prefixes = oldLines.map((line) => NUMBERED_LINE_PATTERN.exec(line.text));
    const firstLine = Number(prefixes[0]?.[1]);
    if (
      !Number.isSafeInteger(firstLine) ||
      firstLine < 1 ||
      prefixes.some((match, index) => !match || Number(match[1]) !== firstLine + index)
    ) {
      throw new TypeError(
        "numbered context/removal lines must have consecutive source line numbers",
      );
    }
    if (hunk.anchorLine !== undefined && hunk.anchorLine !== firstLine) {
      throw new TypeError("numbered source location conflicts with patch anchor");
    }
    adaptations.push({ kind: "read_file_numbered", line: firstLine, lineCount: oldLines.length });
    return {
      ...hunk,
      anchorLine: firstLine,
      lines: hunk.lines.map((line) =>
        line.type === "+"
          ? line
          : {
              ...line,
              text: line.text.replace(NUMBERED_LINE_PATTERN, ""),
            },
      ),
    };
  });
  return { hunks: adapted, adaptations };
}
