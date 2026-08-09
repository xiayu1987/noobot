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

import { hasRipgrep, searchFilesWithRipgrep } from "../../src/tools/execution/file-search.js";

test("ripgrep file search treats a leading-dash query as a literal pattern", async (t) => {
  if (!(await hasRipgrep())) {
    t.skip("ripgrep is not installed");
    return;
  }
  const rootPath = await mkdtemp(path.join(tmpdir(), "noobot-file-search-"));
  try {
    await writeFile(path.join(rootPath, "theme.css"), ":root { --surface-color: white; }\n", "utf8");

    const result = await searchFilesWithRipgrep({
      rootPath,
      workspacePath: rootPath,
      query: "--",
      isRegex: false,
      glob: "*.css",
    });

    assert.equal(result.matches.length, 1);
    assert.equal(result.matches[0].filePath, "theme.css");
    assert.match(result.matches[0].text, /--surface-color/);
  } finally {
    await rm(rootPath, { recursive: true, force: true });
  }
});

test("ripgrep file search scans files larger than the former per-file threshold", async (t) => {
  if (!(await hasRipgrep())) {
    t.skip("ripgrep is not installed");
    return;
  }
  const rootPath = await mkdtemp(path.join(tmpdir(), "noobot-large-file-search-"));
  try {
    const marker = "NOOBOT_SEARCH_MARKER_LARGE_FILE";
    const prefixLine = "x".repeat(255);
    const lineCount = 10000;
    const content = `${Array.from({ length: lineCount }, () => prefixLine).join("\n")}\n${marker}\n`;
    assert.ok(Buffer.byteLength(content, "utf8") > 2 * 1024 * 1024);
    await writeFile(path.join(rootPath, "large.txt"), content, "utf8");

    const result = await searchFilesWithRipgrep({
      rootPath,
      workspacePath: rootPath,
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
