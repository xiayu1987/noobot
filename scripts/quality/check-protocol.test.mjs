/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  defineCheck,
  evaluateCheck,
  EXEMPTION_KINDS,
  exemptMatches,
  exemptsPath,
  formatCheckResult,
  measurementFromHits,
} from "./check-protocol.mjs";

const rule = { description: "d", hint: "fix it" };
const exemption = {
  id: "vendor",
  kind: EXEMPTION_KINDS.PATH_PREFIX,
  rules: ["a"],
  reason: "vendor format",
  match: ["vendor/", "legacy/x.js"],
};
const spec = (overrides = {}) => ({
  id: "sample",
  description: "sample check",
  rules: { a: rule, b: rule },
  exemptions: [exemption],
  baseline: { a: 2, b: 0, exemptions: 2 },
  measure: async () => ({}),
  ...overrides,
});
const measured = (a, b = 0) => ({
  a: { total: a, files: a ? { "x.js": a } : {}, samples: [] },
  b: { total: b, files: {}, samples: [] },
});

test("defineCheck requires description, hint, reason, kind and a complete baseline", () => {
  assert.throws(() => defineCheck(spec({ rules: { a: { description: "d" } } })), /hint/);
  assert.throws(() => defineCheck(spec({ exemptions: [{ ...exemption, reason: "" }] })), /reason/);
  assert.throws(() => defineCheck(spec({ exemptions: [{ ...exemption, kind: "glob" }] })), /kind/);
  assert.throws(
    () => defineCheck(spec({ exemptions: [{ ...exemption, rules: ["z"] }] })),
    /unknown rules/,
  );
  assert.throws(() => defineCheck(spec({ baseline: { a: 2, exemptions: 2 } })), /baseline\.b/);
  assert.throws(
    () => defineCheck(spec({ baseline: { a: 2, b: 0, c: 1, exemptions: 2 } })),
    /unknown keys/,
  );
  assert.throws(() => defineCheck(spec({ extra: true })), /unknown keys/);
});

test("evaluateCheck fails on increases with hint and top files, and on stale baselines", () => {
  const check = defineCheck(spec());
  assert.deepEqual(evaluateCheck(check, measured(2)).increases, []);
  const increased = evaluateCheck(check, measured(3));
  assert.match(increased.increases[0], /a: 3 exceeds baseline 2; fix it\n {2}x\.js: 3/);
  const stale = formatCheckResult(check, evaluateCheck(check, measured(1)), "scripts/s.mjs");
  assert.equal(stale.ok, false);
  assert.match(stale.text, /stale baseline, lower it in scripts\/s\.mjs: a: 1 below baseline 2/);
});

test("exemption entries are counted against the baseline", () => {
  const widened = defineCheck(
    spec({ exemptions: [{ ...exemption, match: [...exemption.match, "more/"] }] }),
  );
  assert.match(
    evaluateCheck(widened, measured(2)).increases[0],
    /exemptions: 3 exceeds baseline 2/,
  );
  const passed = formatCheckResult(
    defineCheck(spec()),
    evaluateCheck(defineCheck(spec()), measured(2)),
    "s",
  );
  assert.deepEqual(passed, { ok: true, text: "[sample] passed (a=2, b=0, exemptions=2)" });
});

test("evaluateCheck rejects missing or malformed measurements", () => {
  const check = defineCheck(spec());
  assert.throws(() => evaluateCheck(check, { a: measured(1).a }), /missing rule b/);
  assert.throws(() => evaluateCheck(check, { ...measured(1), c: measured(1).a }), /unknown keys/);
  assert.throws(
    () => evaluateCheck(check, { ...measured(1), b: { total: -1, files: {}, samples: [] } }),
    /non-negative/,
  );
});

test("exemption lookups are scoped by rule and kind", () => {
  const check = defineCheck(spec());
  assert.equal(exemptsPath(check, "a", "vendor/y.js"), true);
  assert.equal(exemptsPath(check, "b", "vendor/y.js"), false);
  assert.deepEqual([...exemptMatches(check, "a", EXEMPTION_KINDS.PROPERTY_NAME)], []);
  assert.deepEqual(
    measurementFromHits([
      { file: "x.js", line: 3, message: "m1" },
      { file: "x.js", message: "m2" },
      { file: "y.js", line: 1, message: "m3" },
    ]),
    { total: 3, files: { "x.js": 2, "y.js": 1 }, samples: ["x.js:3 m1", "x.js m2", "y.js:1 m3"] },
  );
  assert.throws(() => measurementFromHits([{ file: "x.js" }]), /hit\.message/);
});

test("evaluateCheck reports line samples before top files and truncates them", () => {
  const check = defineCheck(spec({ baseline: { a: 0, b: 0, exemptions: 2 } }));
  const hits = [...Array(85).keys()].map((index) => ({
    file: "x.js",
    line: index + 1,
    message: "hit",
  }));
  const [report] = evaluateCheck(check, {
    a: measurementFromHits(hits),
    b: measured(0).b,
  }).increases;
  assert.match(report, /a: 85 exceeds baseline 0; fix it\n {2}- x\.js:1 hit/);
  assert.match(report, /\.\.\. and 5 more$/);
  assert.doesNotMatch(report, / {2}x\.js: 85/);
});
