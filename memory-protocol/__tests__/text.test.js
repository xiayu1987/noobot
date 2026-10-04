/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import { stripMarkdownFence } from "../src/text.js";

test("stripMarkdownFence removes fences with and without language tags", () => {
  assert.equal(stripMarkdownFence('```json\n{"a":1}\n```'), '{"a":1}');
  assert.equal(stripMarkdownFence("```\n  body text  \n```"), "body text");
  assert.equal(stripMarkdownFence("  ```md\nline1\nline2\n```  "), "line1\nline2");
  assert.equal(stripMarkdownFence("``````"), "");
});

test("stripMarkdownFence returns unfenced or partially fenced text unchanged", () => {
  assert.equal(stripMarkdownFence("  plain text  "), "plain text");
  assert.equal(stripMarkdownFence('```json\n{"a":1}'), '```json\n{"a":1}');
  assert.equal(stripMarkdownFence("````"), "````");
  assert.equal(stripMarkdownFence(null), "");
});

test("stripMarkdownFence stays linear on long whitespace input", () => {
  const input = `\`\`\`${" ".repeat(200_000)}x`;
  const startedAt = performance.now();
  assert.equal(stripMarkdownFence(input), input);
  assert.equal(stripMarkdownFence(`\`\`\`${" \n".repeat(100_000)}\`\`\``), "");
  assert.ok(performance.now() - startedAt < 200);
});
