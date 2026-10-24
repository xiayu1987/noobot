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
import { createExemptionUsage } from "./quality/check-protocol.mjs";

const chains = (source, filename = "source.js") =>
  findFallbackChains(source, filename, createExemptionUsage(CHECK));
const ruleHits = (rule, source, file) =>
  findRuleHits(rule, source, file, createExemptionUsage(CHECK));

test("detects cross-field and cross-source fallback chains in value position", () => {
  assert.equal(chains("const id = ctx.runConfig.executionId || ctx.executionId;").length, 1);
  assert.equal(chains("const id = a?.sessionId ?? b?.sessionId ?? '';").length, 1);
  assert.equal(chains("call(x.name || x.id || 'node');").length, 1);
  assert.equal(chains("const v = (a.x || b.x) || c.x;").length, 1);
});

test("ignores single-field defaults, constant tables and condition positions", () => {
  assert.equal(chains("const v = item.label || '';").length, 0);
  assert.equal(chains("const v = error?.message || ERROR_CODES.FAILED;").length, 0);
  assert.equal(chains("if (a.x || b.x) run();").length, 0);
  assert.equal(chains("const v = a.x || b.x ? 1 : 2;").length, 0);
  assert.equal(chains("const v = !(a.x || b.x);").length, 0);
  assert.equal(chains("const v = ready && (a.x || b.x);").length, 0);
});

test("exempts vendor wire fields and caught error objects", () => {
  assert.equal(chains("const id = call.id || call.call_id;").length, 0);
  assert.equal(chains("const r = m?.role || m?.lc_kwargs?.role;").length, 0);
  assert.equal(chains("const v = error?.stack || error?.message;").length, 0);
  assert.equal(chains("const v = error?.code || input.code;").length, 1);
  assert.equal(
    ruleHits("fallbackChain", "const v = a.x || b.x;", "model-runtime/src/adapters/a.js").length,
    0,
  );
  assert.equal(ruleHits("inlineTrim", "const v = text(a || b);", "shared/value.js").length, 0);
});

test("inline trim does not recount field chains already counted as fallback chains", () => {
  const source = "const v = text(a.x || b.x); const w = text(name || alias);";
  assert.equal(ruleHits("inlineTrim", source, "agent/src/a.js").length, 1);
  assert.equal(ruleHits("inlineTrim", source, "agent/__tests__/helpers/fixture.js").length, 2);
});

test("detects raw typeof object/function comparisons in both polarities", () => {
  assert.equal(findRawTypeofChecks('const ok = typeof v === "object";').length, 1);
  assert.equal(findRawTypeofChecks('if (typeof fn !== "function") throw x;').length, 1);
  assert.equal(findRawTypeofChecks('const ok = "function" === typeof fn;').length, 1);
  assert.equal(findRawTypeofChecks('const ok = v && typeof v.x == "object";').length, 1);
  assert.equal(findRawTypeofChecks('const ok = typeof v === "string";').length, 0);
  assert.equal(findRawTypeofChecks("const ok = isFunction(fn) && isObjectLike(v);").length, 0);
  assert.equal(ruleHits("rawTypeof", 'typeof v === "object";', "shared/value.js").length, 0);
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
  assert.equal(ruleHits("typeCheck", "const isRecord = (v) => v;", "shared/value.js").length, 0);
});

test("scans vue script blocks", () => {
  const source =
    "<template><div /></template>\n<script>\nexport const v = a.x || b.x;\n</script>\n";
  assert.equal(chains(source, "Component.vue").length, 1);
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
  const typeCheck = "const isRecord = (v) => v;";
  const raw = 'typeof v === "object";';
  assert.equal(
    ruleHits("typeCheck", typeCheck, "attachment-protocol/src/protocol-utils.js").length,
    0,
  );
  assert.equal(
    ruleHits("typeCheck", typeCheck, "attachment-protocol/src/protocol-utils-extra.js").length,
    1,
  );
  assert.equal(ruleHits("rawTypeof", raw, "attachment-protocol/src/protocol-utils.js").length, 1);
});

test("path exemptions are recorded only when they suppress a hit", () => {
  const usage = createExemptionUsage(CHECK);
  findRuleHits(
    "fallbackChain",
    "const v = a.call_id || b.x;",
    "model-runtime/src/adapters/a.js",
    usage,
  );
  assert.equal(usage.staleEntries().includes("vendor-wire-fields fallbackChain call_id"), true);
  assert.equal(
    usage.staleEntries().includes("vendor-adapters fallbackChain model-runtime/src/adapters/"),
    false,
  );
});

test("shared-helper rules skip browser-executed callbacks; fallback chains still count", () => {
  const source = `await page.evaluate((node) => {
      const ok = typeof node === "object" && !Array.isArray(node);
      return ok && typeof window.x === "function" && String(node.textContent ?? "").trim();
    });
    const outside = typeof value === "object";
    await page.evaluate((node) => node.a.x || node.b.x);`;
  assert.equal(findRawTypeofChecks(source).length, 1);
  assert.equal(findInlineTrimFallbacks(source).length, 0);
  assert.equal(findInlineTypeChecks(source).length, 0);
  assert.equal(chains(source).length, 1);
});
