/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  CHECK,
  findFallbackChains,
  findInlineTypeChecks,
  findInlineTrimFallbacks,
  findRawTypeofChecks,
  findRuleHits,
  findTextShadowing,
  includesFile,
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
  assert.equal(includesFile("fallbackChain", "model-runtime/src/adapters/a.js"), false);
  assert.equal(includesFile("inlineTrim", "shared/value.js"), false);
});

test("inline trim does not recount field chains already counted as fallback chains", () => {
  const source = "const v = text(a.x || b.x); const w = text(name || alias);";
  assert.equal(findRuleHits("inlineTrim", source, "agent/src/a.js").length, 1);
  assert.equal(findRuleHits("inlineTrim", source, "agent/__tests__/helpers/fixture.js").length, 2);
});

test("detects raw typeof object/function comparisons in both polarities", () => {
  assert.equal(findRawTypeofChecks('const ok = typeof v === "object";').length, 1);
  assert.equal(findRawTypeofChecks('if (typeof fn !== "function") throw x;').length, 1);
  assert.equal(findRawTypeofChecks('const ok = "function" === typeof fn;').length, 1);
  assert.equal(findRawTypeofChecks('const ok = v && typeof v.x == "object";').length, 1);
  assert.equal(findRawTypeofChecks('const ok = typeof v === "string";').length, 0);
  assert.equal(findRawTypeofChecks("const ok = isFunction(fn) && isObjectLike(v);").length, 0);
  assert.equal(includesFile("rawTypeof", "shared/value.js"), false);
  assert.equal(includesFile("rawTypeof", "agent/__tests__/a.test.js"), false);
  assert.equal(includesFile("rawTypeof", "agent/src/a.js"), true);
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
  assert.equal(includesFile("typeCheck", "shared/value.js"), false);
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
  assert.equal(includesFile("fallbackChain", "agent/__tests__/helpers/fixture.js"), false);
  assert.equal(includesFile("inlineTrim", "agent/__tests__/helpers/fixture.js"), true);
  assert.equal(includesFile("inlineTrim", "agent/src/a.test.ts"), false);
  assert.equal(includesFile("fallbackChain", "agent/src/a.js"), true);
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

test("strict plain-object exemption covers exactly the listed files", () => {
  assert.equal(includesFile("typeCheck", "attachment-protocol/src/protocol-utils.js"), false);
  assert.equal(includesFile("typeCheck", "attachment-protocol/src/protocol-utils-extra.js"), true);
  assert.equal(includesFile("rawTypeof", "attachment-protocol/src/protocol-utils.js"), true);
});

test("every exemption declares a reason and the exemption total matches the baseline", () => {
  const total = CHECK.exemptions.reduce((sum, exemption) => sum + exemption.match.length, 0);
  assert.equal(total, CHECK.baseline.exemptions);
  for (const exemption of CHECK.exemptions) assert.ok(exemption.reason.length > 0);
});
