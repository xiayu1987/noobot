/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import test from "node:test";
import { scanCodeTokens } from "./check-numeric-literal-style.mjs";

function tokensOf(source) {
  return scanCodeTokens("sample.js", source).map((item) => item.token);
}

test("rejects numeric separators in real numeric literals", () => {
  assert.deepEqual(tokensOf("const a = 18_000_000;\nconst b = 0x1_0;"), ["18_000_000", "0x1_0"]);
});

test("does not treat digits inside identifiers as literals", () => {
  assert.deepEqual(tokensOf("cfg.qwen3_7_max; const gemini_3_7_flash = $1_2;"), []);
});

test("ignores separators inside strings and comments", () => {
  assert.deepEqual(tokensOf('"18_000_000"; `1_0`; // 1_0\n/* 2_0 */'), []);
});
