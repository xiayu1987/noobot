/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  decodeRipgrepEvent,
  searchFilesWithRipgrep,
  searchInText,
  toSearchRootRelativePath,
} from "../../src/tools/execution/file-search.js";
import { ERROR_CODE, ERROR_LEVEL } from "../../src/shared/errors/index.js";
import { isOutsideWorkspaceRelativePath } from "../../src/tools/execution/file-utils.js";

const SEARCH_INPUT = Object.freeze({
  target: ".",
  isRegex: false,
  caseSensitive: false,
  glob: "",
  contextLines: 0,
  maxResults: 50,
});

test("isOutsideWorkspaceRelativePath flags parent and absolute paths only", () => {
  for (const value of ["..", "../outside.txt", "..\\outside.txt", "/abs/file", "C:/x"]) {
    assert.equal(isOutsideWorkspaceRelativePath(value), true, value);
  }
  for (const value of ["", "a.txt", "..foo", "a/../b", "c:foo", "dir/.."]) {
    assert.equal(isOutsideWorkspaceRelativePath(value), false, value);
  }
});

test("toSearchRootRelativePath rejects escaping and forbidden rg paths", () => {
  const rootPath = path.join(tmpdir(), "noobot-search-root");
  assert.equal(toSearchRootRelativePath(rootPath, "./sub/a.txt"), "sub/a.txt");
  for (const rgFilePath of ["../outside.txt", "/etc/passwd", "./.git/config"]) {
    assert.throws(
      () => toSearchRootRelativePath(rootPath, rgFilePath),
      (error) =>
        error.code === ERROR_CODE.FATAL_RIPGREP_OUTPUT_INVALID && error.level === ERROR_LEVEL.FATAL,
      rgFilePath,
    );
  }
});

test("searchInText marks truncated only when a match exists beyond maxResults", () => {
  const input = { query: "hit", isRegex: false, caseSensitive: false, contextLines: 0 };
  const exact = searchInText({ ...input, text: "hit\nhit\nmiss\n", maxResults: 2 });
  assert.equal(exact.matches.length, 2);
  assert.equal(exact.truncated, false);
  const over = searchInText({ ...input, text: "hit\nhit\nhit\n", maxResults: 2 });
  assert.equal(over.matches.length, 2);
  assert.equal(over.truncated, true);
});

test("ripgrep file search does not mark truncated when matches equal maxResults", async () => {
  const rootPath = await mkdtemp(path.join(tmpdir(), "noobot-exact-file-search-"));
  try {
    await Promise.all(
      Array.from({ length: 3 }, (_, index) =>
        writeFile(path.join(rootPath, `exact-${index}.txt`), "EXACT_MARKER\n", "utf8"),
      ),
    );
    const result = await searchFilesWithRipgrep({
      ...SEARCH_INPUT,
      abortSignal: new AbortController().signal,
      rootPath,
      query: "EXACT_MARKER",
      maxResults: 3,
    });
    assert.equal(result.matches.length, 3);
    assert.equal(result.truncated, false);
  } finally {
    await rm(rootPath, { recursive: true, force: true });
  }
});

test("ripgrep file search treats a leading-dash query as a literal pattern", async () => {
  const rootPath = await mkdtemp(path.join(tmpdir(), "noobot-file-search-"));
  try {
    await writeFile(
      path.join(rootPath, "theme.css"),
      ":root { --surface-color: white; }\n",
      "utf8",
    );

    const result = await searchFilesWithRipgrep({
      ...SEARCH_INPUT,
      abortSignal: new AbortController().signal,
      rootPath,
      query: "--",
      glob: "*.css",
    });

    assert.equal(result.matches.length, 1);
    assert.equal(result.matches[0].filePath, "theme.css");
    assert.match(result.matches[0].text, /--surface-color/);
  } finally {
    await rm(rootPath, { recursive: true, force: true });
  }
});

test("ripgrep file search scans files larger than the former per-file threshold", async () => {
  const rootPath = await mkdtemp(path.join(tmpdir(), "noobot-large-file-search-"));
  try {
    const marker = "NOOBOT_SEARCH_MARKER_LARGE_FILE";
    const prefixLine = "x".repeat(255);
    const lineCount = 10000;
    const content = `${Array.from({ length: lineCount }, () => prefixLine).join("\n")}\n${marker}\n`;
    assert.ok(Buffer.byteLength(content, "utf8") > 2 * 1024 * 1024);
    await writeFile(path.join(rootPath, "large.txt"), content, "utf8");

    const result = await searchFilesWithRipgrep({
      ...SEARCH_INPUT,
      abortSignal: new AbortController().signal,
      rootPath,
      query: marker,
      contextLines: 0,
    });

    assert.equal(result.matches.length, 1);
    assert.equal(result.matches[0].filePath, "large.txt");
    assert.equal(result.matches[0].line, lineCount + 1);
    assert.equal(result.matches[0].text, marker);
  } finally {
    await rm(rootPath, { recursive: true, force: true });
  }
});

test("ripgrep file search enforces maxResults across files", async () => {
  const rootPath = await mkdtemp(path.join(tmpdir(), "noobot-bounded-file-search-"));
  try {
    await Promise.all(
      Array.from({ length: 100 }, (_, index) =>
        writeFile(path.join(rootPath, `match-${index}.txt`), "GLOBAL_SEARCH_MARKER\n", "utf8"),
      ),
    );

    const result = await searchFilesWithRipgrep({
      ...SEARCH_INPUT,
      abortSignal: new AbortController().signal,
      rootPath,
      query: "GLOBAL_SEARCH_MARKER",
      contextLines: 0,
      maxResults: 7,
    });

    assert.equal(result.matches.length, 7);
    assert.equal(result.truncated, true);
  } finally {
    await rm(rootPath, { recursive: true, force: true });
  }
});

test("ripgrep file search scopes to a single file target", async () => {
  const rootPath = await mkdtemp(path.join(tmpdir(), "noobot-single-file-search-"));
  try {
    await writeFile(path.join(rootPath, "a.txt"), "SINGLE_MARKER\n", "utf8");
    await writeFile(path.join(rootPath, "b.txt"), "SINGLE_MARKER\n", "utf8");
    const result = await searchFilesWithRipgrep({
      ...SEARCH_INPUT,
      abortSignal: new AbortController().signal,
      rootPath,
      target: "a.txt",
      query: "SINGLE_MARKER",
    });
    assert.deepEqual(
      result.matches.map((match) => match.filePath),
      ["a.txt"],
    );
  } finally {
    await rm(rootPath, { recursive: true, force: true });
  }
});

test("ripgrep file search rejects a missing target", async () => {
  await assert.rejects(
    searchFilesWithRipgrep({
      ...SEARCH_INPUT,
      abortSignal: new AbortController().signal,
      rootPath: tmpdir(),
      target: undefined,
      query: "x",
    }),
    /search target/,
  );
});

const RIPGREP_MATCH = Object.freeze({
  type: "match",
  data: {
    path: { text: "a.txt" },
    lines: { text: "hello world\n" },
    line_number: 3,
    submatches: [{ match: { text: "world" }, start: 6, end: 11 }],
  },
});

test("decodeRipgrepEvent decodes match, context and byte-encoded events", () => {
  assert.deepEqual(decodeRipgrepEvent(JSON.stringify(RIPGREP_MATCH)), {
    type: "match",
    filePathRaw: "a.txt",
    line: 3,
    text: "hello world",
    column: 7,
  });
  const context = {
    type: "context",
    data: {
      path: { bytes: Buffer.from("b.txt").toString("base64") },
      lines: { bytes: Buffer.from("ctx\r\n").toString("base64") },
      line_number: 2,
      submatches: [],
    },
  };
  assert.deepEqual(decodeRipgrepEvent(JSON.stringify(context)), {
    type: "context",
    filePathRaw: "b.txt",
    line: 2,
    text: "ctx",
  });
  for (const type of ["begin", "end", "summary"]) {
    assert.equal(decodeRipgrepEvent(JSON.stringify({ type, data: {} })), null);
  }
});

test("decodeRipgrepEvent rejects output that violates the ripgrep json protocol", () => {
  const invalidLines = [
    "not json",
    "[]",
    JSON.stringify({ type: "unknown", data: {} }),
    JSON.stringify({ type: "match" }),
    JSON.stringify({ ...RIPGREP_MATCH, data: { ...RIPGREP_MATCH.data, line_number: null } }),
    JSON.stringify({ ...RIPGREP_MATCH, data: { ...RIPGREP_MATCH.data, path: {} } }),
    JSON.stringify({ ...RIPGREP_MATCH, data: { ...RIPGREP_MATCH.data, lines: null } }),
    JSON.stringify({ ...RIPGREP_MATCH, data: { ...RIPGREP_MATCH.data, submatches: [] } }),
  ];
  for (const line of invalidLines) {
    assert.throws(
      () => decodeRipgrepEvent(line),
      (error) =>
        error.code === ERROR_CODE.FATAL_RIPGREP_OUTPUT_INVALID && error.level === ERROR_LEVEL.FATAL,
      line,
    );
  }
});
