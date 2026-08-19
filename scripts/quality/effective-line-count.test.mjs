/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import test from "node:test";
import { countEffectiveCodeLines } from "./effective-line-count.mjs";

test("effective line count excludes blank and pure comment lines", () => {
  assert.equal(
    countEffectiveCodeLines(`
// line comment
/*
 * block comment
 */
const value = 1; // trailing comment

value += 1;
`),
    2,
  );
});

test("effective line count preserves multiline strings and Vue content", () => {
  assert.equal(
    countEffectiveCodeLines(`
const text = \`first
second\`;
<!-- template comment -->
<template>
  <div>{{ text }}</div>
</template>
`),
    5,
  );
});

test("effective line count handles code around block comments", () => {
  assert.equal(countEffectiveCodeLines("const value = /* reason */ 1;\n/* only */\nvalue;"), 2);
});
