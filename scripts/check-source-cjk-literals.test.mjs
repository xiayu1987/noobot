/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import test from "node:test";
import { CHECK, measureCjkLiterals } from "./check-source-cjk-literals.mjs";
import { createExemptionUsage } from "./quality/check-protocol.mjs";

function catalogSources(extra) {
  const sources = {};
  for (const exemption of CHECK.exemptions) {
    for (const prefix of exemption.match)
      sources[`${prefix}${prefix.endsWith("/") ? "a.js" : ""}`] = '"中"';
  }
  return { ...sources, ...extra };
}

test("reports CJK literals in non-exempt source files with line numbers", () => {
  const measured = measureCjkLiterals(
    CHECK,
    catalogSources({
      "agent/src/a.js": 'const ok = 1;\nconst label = "你好";',
      "agent/src/b.js": "1",
    }),
    createExemptionUsage(CHECK),
  );
  assert.equal(measured.cjkLiteral.total, 1);
  assert.deepEqual(measured.cjkLiteral.samples, [
    "agent/src/a.js:2 CJK literal outside i18n catalogs",
  ]);
});

test("exempted catalogs, scripts and listed files pass and use every exemption", () => {
  const usage = createExemptionUsage(CHECK);
  const measured = measureCjkLiterals(CHECK, catalogSources({}), usage);
  assert.equal(measured.cjkLiteral.total, 0);
  assert.deepEqual(usage.staleEntries(), []);
});

test("exemptions whose files no longer contain CJK are stale", () => {
  const usage = createExemptionUsage(CHECK);
  measureCjkLiterals(CHECK, catalogSources({ "sanitize/src/index.js": "const a = 1;" }), usage);
  assert.deepEqual(usage.staleEntries(), ["pii-field-names cjkLiteral sanitize/src/index.js"]);
});
