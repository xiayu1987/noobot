/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  findEmptyDependencyBags,
  findFetcherFallbacks,
  findOptionalDependencyCalls,
  includesFile,
} from "./check-injected-dependency-defaults.mjs";

test("counts whole-bag empty object defaults on destructured parameters", () => {
  assert.equal(findEmptyDependencyBags("function f({ a, b } = {}) {}").length, 1);
  assert.equal(findEmptyDependencyBags("const f = ({ a } = {}) => a;").length, 1);
  assert.equal(findEmptyDependencyBags("export function f(x, { fetcher } = {}) {}").length, 1);
});

test("ignores required bags and non-empty or non-pattern defaults", () => {
  assert.equal(findEmptyDependencyBags("function f({ a, b }) {}").length, 0);
  assert.equal(findEmptyDependencyBags("function f(options = {}) {}").length, 0);
  assert.equal(findEmptyDependencyBags("function f({ a } = { a: 1 }) {}").length, 0);
});

test("counts optional calls on bare identifiers only", () => {
  assert.equal(findOptionalDependencyCalls("notify?.({ type: 'error' });").length, 1);
  assert.equal(findOptionalDependencyCalls("navigateToLastMessage();").length, 0);
  assert.equal(findOptionalDependencyCalls("client.log?.(record);").length, 0);
});

test("counts fetcher fallbacks that swap the request channel", () => {
  assert.equal(findFetcherFallbacks("const run = fetcher || fetch;").length, 1);
  assert.equal(findFetcherFallbacks("const run = authFetch ?? globalThis.fetch;").length, 1);
  assert.equal(findFetcherFallbacks("const value = options || {};").length, 0);
});

test("parses Vue single-file components", () => {
  const source = "<script setup>\nfunction f({ a } = {}) { a?.(); }\n</script>\n";
  assert.equal(findEmptyDependencyBags(source, "Panel.vue").length, 1);
  assert.equal(findOptionalDependencyCalls(source, "Panel.vue").length, 1);
});

test("scopes the check to client production sources", () => {
  assert.equal(includesFile("client/noobot-chat/src/app/shell/AppShell.vue"), true);
  assert.equal(includesFile("client/noobot-chat/tests/unit/app/AppShell.spec.js"), false);
  assert.equal(includesFile("agent/src/runtime/engine.js"), false);
});
