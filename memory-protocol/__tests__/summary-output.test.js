/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeDomainSummaryOutput,
  parseDailyExperienceOutput,
} from "../src/experience/summary-output.js";

test("daily output parses domain patches", () => {
  const items = parseDailyExperienceOutput(
    'ADD D[1] domain="coding" new=true experiences="先读代码 || 先读代码" lessons="别猜"',
  );
  assert.deepEqual(items, [
    {
      domain_name: "coding",
      is_new_domain: true,
      experiences: ["先读代码"],
      lessons: ["别猜"],
    },
  ]);
});

test("missing patch commands report parse error", () => {
  const errors = [];
  const items = parseDailyExperienceOutput("free text", {
    onParseError: (error) => errors.push(error),
  });
  assert.deepEqual(items, []);
  assert.equal(errors[0].error, "daily_patch_command_not_found");
});

test("monthly output groups subcategories under categories", () => {
  const summary = normalizeDomainSummaryOutput({
    schemaKey: "monthly",
    fallbackDomainName: "coding",
    rawContent: [
      'ADD M[1] category="debug" subcategory="trace" patterns="看日志" methodologies="二分"',
      'ADD M[2] category="debug" subcategory="test" patterns="先复现" methodologies="最小用例"',
    ].join("\n"),
  });
  assert.equal(summary.domain_name, "coding");
  assert.equal(summary.categories.length, 1);
  assert.equal(summary.categories[0].category_name, "debug");
  assert.deepEqual(
    summary.categories[0].subcategories.map((item) => item.subcategory_name),
    ["trace", "test"],
  );
});

test("unknown schema is rejected", () => {
  assert.throws(() => normalizeDomainSummaryOutput({ schemaKey: "hourly" }), /unknown/);
});
