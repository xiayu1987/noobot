/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import { cleanTextUniversal, cleanConnectorOutputForLLM } from "../../system-core/utils/text-cleaner.js";

test("cleanTextUniversal plain text", () => {
  const result = cleanTextUniversal("  hello   world  \n\n\n  foo  bar  ", { format: "text" });
  assert.ok(result.includes("hello"));
  assert.ok(result.includes("world"));
  assert.ok(result.includes("foo"));
  assert.ok(result.includes("bar"));
});

test("cleanTextUniversal strips markdown headers and links", () => {
  const result = cleanTextUniversal("# Title\n\n[link](http://example.com)\n\n- item1\n- item2", { format: "markdown" });
  assert.ok(!result.includes("#"));
  assert.ok(!result.includes("http://example.com"));
  assert.ok(!result.includes("- "));
});

test("cleanTextUniversal strips code blocks and inline code", () => {
  const result = cleanTextUniversal("Before ```code block``` after `inline` end", { format: "markdown" });
  assert.ok(!result.includes("```"));
  assert.ok(!result.includes("`"));
});

test("cleanTextUniversal auto-detects markdown", () => {
  const result = cleanTextUniversal("# Heading\n\nSome text", { format: "auto" });
  assert.ok(!result.includes("#"));
});

test("cleanTextUniversal auto-detects plain text", () => {
  const result = cleanTextUniversal("Just plain text", { format: "auto" });
  assert.equal(result, "Just plain text");
});

test("cleanTextUniversal respects maxChars", () => {
  const longText = "A".repeat(200);
  const result = cleanTextUniversal(longText, { format: "text", maxChars: 50 });
  assert.ok(result.length <= 50);
});

test("cleanTextUniversal filters noise lines", () => {
  const result = cleanTextUniversal("Real content\n广告\nCopyright 2026\nMore content", { format: "text" });
  assert.ok(result.includes("Real content"));
  assert.ok(!result.includes("广告"));
  assert.ok(!result.toLowerCase().includes("copyright"));
});

test("cleanConnectorOutputForLLM terminal type", () => {
  const result = cleanConnectorOutputForLLM({
    connectorType: "terminal",
    output: { stdout: "hello", stderr: "", code: 0 },
  });
  assert.equal(result.stdout, "hello");
  assert.equal(result.code, 0);
});

test("cleanConnectorOutputForLLM database type returns stdout structure", () => {
  const result = cleanConnectorOutputForLLM({
    connectorType: "database",
    output: { stdout: '[{"id":1}]', stderr: "", code: 0 },
  });
  assert.equal(result.stdout, '[{"id":1}]');
  assert.equal(result.code, 0);
});

test("cleanConnectorOutputForLLM unknown type defaults to terminal", () => {
  const result = cleanConnectorOutputForLLM({
    connectorType: "unknown",
    output: { stdout: "test", stderr: "", code: 0 },
  });
  assert.equal(result.stdout, "test");
});
