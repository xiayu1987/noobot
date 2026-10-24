/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import test from "node:test";
import { parse } from "espree";
import { isBrowserCallback } from "./browser-callbacks.mjs";

function callOf(source) {
  return parse(source, { ecmaVersion: "latest" }).body[0].expression;
}

test("recognizes function arguments of Playwright browser-executed methods", () => {
  const call = callOf("page.evaluate((node) => node.x, value)");
  assert.equal(isBrowserCallback(call.arguments[0], call), true);
  assert.equal(isBrowserCallback(call.arguments[1], call), false);
  const init = callOf("page.addInitScript(function () {})");
  assert.equal(isBrowserCallback(init.arguments[0], init), true);
});

test("ignores computed members, other methods and non-call parents", () => {
  const computed = callOf('page["evaluate"](() => 1)');
  assert.equal(isBrowserCallback(computed.arguments[0], computed), false);
  const other = callOf("items.map(() => 1)");
  assert.equal(isBrowserCallback(other.arguments[0], other), false);
  const direct = callOf("evaluate(() => 1)");
  assert.equal(isBrowserCallback(direct.arguments[0], direct), false);
});
