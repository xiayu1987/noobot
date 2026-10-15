/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  compareWithBaseline,
  findRebaseIncreases,
  findFallbackChains,
  findInlineTypeChecks,
  findInlineTrimFallbacks,
  findTextShadowing,
  RULES,
  renderModuleSection,
  replaceModuleSection,
} from "./check-fallback-chain-baseline.mjs";

test("detects cross-field and cross-source fallback chains in value position", () => {
  assert.equal(
    findFallbackChains("const id = ctx.runConfig.executionId || ctx.executionId;").length,
    1,
  );
  assert.equal(findFallbackChains("const id = a?.sessionId ?? b?.sessionId ?? '';").length, 1);
  assert.equal(findFallbackChains("call(x.name || x.id || 'node');").length, 1);
  assert.equal(findFallbackChains("const v = (a.x || b.x) || c.x;").length, 1);
});

test("ignores single-field defaults, constant tables and condition positions", () => {
  assert.equal(findFallbackChains("const v = item.label || '';").length, 0);
  assert.equal(findFallbackChains("const v = error?.message || ERROR_CODES.FAILED;").length, 0);
  assert.equal(findFallbackChains("if (a.x || b.x) run();").length, 0);
  assert.equal(findFallbackChains("const v = a.x || b.x ? 1 : 2;").length, 0);
  assert.equal(findFallbackChains("const v = !(a.x || b.x);").length, 0);
  assert.equal(findFallbackChains("const v = ready && (a.x || b.x);").length, 0);
});

test("exempts vendor wire fields and caught error objects", () => {
  assert.equal(findFallbackChains("const id = call.id || call.tool_call_id;").length, 0);
  assert.equal(findFallbackChains("const r = m?.role || m?.lc_kwargs?.role;").length, 0);
  assert.equal(findFallbackChains("const v = error?.stack || error?.message;").length, 0);
  assert.equal(findFallbackChains("const v = error?.code || input.code;").length, 1);
  assert.equal(RULES.fallbackChain.includeFile("model-runtime/src/adapters/a.js"), false);
  assert.equal(RULES.inlineTrim.includeFile("shared/value.js"), false);
});

test("inline trim does not recount field chains already counted as fallback chains", () => {
  const source = "const v = text(a.x || b.x); const w = text(name || alias);";
  assert.equal(RULES.inlineTrim.find(source, "agent/src/a.js").length, 1);
  assert.equal(RULES.inlineTrim.find(source, "agent/__tests__/helpers/fixture.js").length, 2);
});

test("detects local object type checks that duplicate shared isPlainObject", () => {
  assert.equal(
    findInlineTypeChecks('const ok = v && typeof v === "object" && !Array.isArray(v);').length,
    1,
  );
  assert.equal(findInlineTypeChecks("function isPlainObject(v) { return isObj(v); }").length, 1);
  assert.equal(findInlineTypeChecks("const isRecord = (v) => isObj(v);").length, 1);
  assert.equal(findInlineTypeChecks('const ok = typeof v === "object";').length, 0);
  assert.equal(findInlineTypeChecks("const ok = isPlainObject(v);").length, 0);
  assert.equal(RULES.typeCheck.includeFile("shared/value.js"), false);
});

test("rebase may add new rules but never raises an existing rule total", () => {
  const previous = { fallbackChain: { "a.js": 3 } };
  assert.deepEqual(
    findRebaseIncreases(previous, {
      fallbackChain: { "a.js": 1, "b.js": 2 },
      typeCheck: { "c.js": 9 },
    }),
    [],
  );
  assert.deepEqual(findRebaseIncreases(previous, { fallbackChain: { "a.js": 4 } }), [
    "rebase raises fallbackChain from 3 to 4",
  ]);
});

test("scans vue script blocks", () => {
  const source =
    "<template><div /></template>\n<script>\nexport const v = a.x || b.x;\n</script>\n";
  assert.equal(findFallbackChains(source, "Component.vue").length, 1);
});

test("detects String(x || d).trim() and String(x ?? d).trim() re-implementations of text()", () => {
  assert.equal(
    findInlineTrimFallbacks('const v = String(runConfig.commandId || "").trim();').length,
    1,
  );
  assert.equal(findInlineTrimFallbacks('const v = String(a ?? "").trim();').length, 1);
  assert.equal(findInlineTrimFallbacks('const v = String(a || "message").trim();').length, 1);
  assert.equal(findInlineTrimFallbacks('const v = String(a?.b || "").trim?.();').length, 1);
  assert.equal(findInlineTrimFallbacks('const v = text(a || "d");').length, 1);
  assert.equal(findInlineTrimFallbacks("const v = text(a.x ?? b.x);").length, 1);
});

test("ignores text(), plain String().trim() and non-fallback arguments", () => {
  assert.equal(findInlineTrimFallbacks('const v = text(a) || "d";').length, 0);
  assert.equal(findInlineTrimFallbacks('const v = (text(a) || "d") === "d";').length, 0);
  assert.equal(findInlineTrimFallbacks("const v = String(a).trim();").length, 0);
  assert.equal(findInlineTrimFallbacks("const v = String(a && b).trim();").length, 0);
  assert.equal(findInlineTrimFallbacks('const v = String(a || "").toLowerCase();').length, 0);
});

test("rules share the source-inventory test path predicate", () => {
  assert.equal(RULES.fallbackChain.includeFile("agent/__tests__/helpers/fixture.js"), false);
  assert.equal(RULES.inlineTrim.includeFile("agent/__tests__/helpers/fixture.js"), true);
  assert.equal(RULES.inlineTrim.includeFile("agent/src/a.test.ts"), false);
  assert.equal(RULES.fallbackChain.includeFile("agent/src/a.js"), true);
});

test("baseline only allows decreases and flags stale entries", () => {
  const { increases, decreases } = compareWithBaseline(
    { "a.js": 3, "c.js": 1 },
    { "a.js": 2, "b.js": 4 },
  );
  assert.deepEqual(increases, ["a.js: 3 exceeds baseline 2", "c.js: 1 exceeds baseline 0"]);
  assert.deepEqual(decreases, ["b.js: 0 below baseline 4"]);
});

test("module table is generated from the grouped baseline", () => {
  const baseline = {
    fallbackChain: { "agent/src/a.js": 2, "plugin/noobot-plugin-workflow/src/b.js": 1 },
    inlineTrim: { "agent/src/a.js": 4 },
  };
  const section = renderModuleSection(baseline);
  assert.match(
    section,
    /总计：回退链 3 处 \/ 2 个文件；内联 trim 兜底 4 处 \/ 1 个文件；内联类型判断 0 处 \/ 0 个文件；遮蔽 text\(\) 0 处 \/ 0 个文件。/,
  );
  assert.match(section, /\| `agent` \| 2 \| 4 \| 0 \| 0 \|/);
  assert.match(section, /\| `plugin\/noobot-plugin-workflow` \| 1 \| 0 \| 0 \| 0 \|/);
  const doc =
    "head\n<!-- fallback-chain-modules:start -->\nold\n<!-- fallback-chain-modules:end -->\ntail";
  assert.equal(replaceModuleSection(doc, baseline), `head\n${section}\ntail`);
  assert.throws(() => replaceModuleSection("no markers", baseline), /missing module markers/);
});

test("files importing text() must not rebind text in a local scope", () => {
  const imported = 'import { text } from "@noobot/shared/value";\n';
  assert.equal(
    findTextShadowing(`${imported}function f({ text = "" }) { return text; }`).length,
    1,
  );
  assert.equal(findTextShadowing(`${imported}function f(text) { return text; }`).length, 1);
  assert.equal(
    findTextShadowing(`${imported}const f = () => { const text = 1; return text; };`).length,
    1,
  );
  assert.equal(
    findTextShadowing(`${imported}function f({ text: inputText = "" }) { return text(inputText); }`)
      .length,
    0,
  );
  assert.equal(findTextShadowing("function f(text) { return text; }").length, 0);
  const vue = `<template><div /></template>\n<script setup>\n${imported}function f(text) { return text; }\n</script>\n`;
  assert.equal(findTextShadowing(vue, "Component.vue").length, 1);
});
