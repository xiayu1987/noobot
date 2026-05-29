/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import { cleanTerminalOutputForLLM } from "../../../src/system-core/utils/cleaners/terminal-cleaner.js";

test("cleanTerminalOutputForLLM strips ANSI codes", () => {
  const result = cleanTerminalOutputForLLM({
    stdout: "\u001b[32mHello\u001b[0m",
    stderr: "",
    code: 0,
  });
  assert.equal(result.stdout, "Hello");
  assert.equal(result.stderr, "");
  assert.equal(result.code, 0);
  assert.equal(result.truncated, false);
  assert.equal(result.truncated_chars_total, 0);
});

test("cleanTerminalOutputForLLM normalizes line endings", () => {
  const result = cleanTerminalOutputForLLM({
    stdout: "line1\r\nline2\rline3",
    stderr: "",
    code: 0,
  });
  assert.equal(result.stdout, "line1\nline2\nline3");
});

test("cleanTerminalOutputForLLM truncates long output", () => {
  const longText = "A".repeat(10000);
  const result = cleanTerminalOutputForLLM({ stdout: longText, stderr: "", code: 0 }, { maxChars: 100 });
  assert.equal(result.truncated, true);
  assert.equal(result.stdout_original_length, 10000);
  assert.equal(result.truncate_limit_chars, 256);
  assert.equal(result.stdout_truncated_chars, 10000 - 256);
  assert.equal(result.stderr_truncated_chars, 0);
  assert.equal(result.truncated_chars_total, 10000 - 256);
  assert.ok(result.stdout.includes("[truncated head"));
  assert.ok(result.stdout.endsWith("A".repeat(256)));
});

test("cleanTerminalOutputForLLM handles empty input", () => {
  const result = cleanTerminalOutputForLLM({}, { maxChars: 100 });
  assert.equal(result.stdout, "");
  assert.equal(result.stderr, "");
  assert.equal(result.code, 0);
  assert.equal(result.truncated, false);
  assert.equal(result.truncated_chars_total, 0);
});

test("cleanTerminalOutputForLLM handles null/undefined input", () => {
  const result = cleanTerminalOutputForLLM(null, { maxChars: 100 });
  assert.equal(result.stdout, "");
  assert.equal(result.stderr, "");
});

test("cleanTerminalOutputForLLM preserves code field", () => {
  const result = cleanTerminalOutputForLLM({ stdout: "", stderr: "", code: 127 });
  assert.equal(result.code, 127);
});
