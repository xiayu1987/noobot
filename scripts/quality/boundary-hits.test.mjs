/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  addExemptablePatternLineHits,
  addMissingConsumerHits,
  addMissingMarkerHits,
  addPatternLineHits,
  addPatternOffsetHits,
  addRemovedPathHits,
} from "./boundary-hits.mjs";
import {
  createExemptionUsage,
  defineCheck,
  EXEMPTION_KINDS,
  measurementFromHits,
} from "./check-protocol.mjs";

test("addPatternLineHits records each matching line with its line number", () => {
  const measurement = measurementFromHits([]);
  const source = "one\ntwo legacy\nlegacy three\n";
  addPatternLineHits({ measurement, file: "a.js", source, pattern: /legacy/, message: "legacy" });
  assert.equal(measurement.total, 2);
  assert.deepEqual(measurement.samples, ["a.js:2 legacy", "a.js:3 legacy"]);
});

test("addPatternOffsetHits records multi-line matches at the line where they start", () => {
  const measurement = measurementFromHits([]);
  const source = "x\n[\n  1,\n]\ny [2]";
  addPatternOffsetHits({
    measurement,
    file: "a.js",
    source,
    pattern: /\[[^\]]*\]/g,
    message: "list",
  });
  assert.deepEqual(measurement.samples, ["a.js:2 list", "a.js:5 list"]);
});

test("addRemovedPathHits reports existing paths with the given message", async () => {
  const measurement = measurementFromHits([]);
  await addRemovedPathHits(measurement, ["package.json", "zz-missing-quality-probe"], "gone");
  assert.deepEqual(measurement.samples, ["package.json gone"]);
});

test("addMissingMarkerHits reports only markers absent from the file", async () => {
  const measurement = measurementFromHits([]);
  await addMissingMarkerHits(measurement, "package.json", ['"name"', "zz-missing-marker"]);
  assert.deepEqual(measurement.samples, ["package.json missing zz-missing-marker"]);
});

test("addMissingConsumerHits reports consumers that do not reference their marker", async () => {
  const measurement = measurementFromHits([]);
  await addMissingConsumerHits(measurement, [
    ["package.json", '"scripts"'],
    ["package.json", "zz-missing-consumer"],
  ]);
  assert.deepEqual(measurement.samples, ["package.json must consume zz-missing-consumer"]);
});

test("addExemptablePatternLineHits records exempt hits on the usage instead of the measurement", () => {
  const check = defineCheck({
    id: "s",
    description: "d",
    rules: { r: { description: "d", hint: "h" } },
    exemptions: [
      { id: "e", kind: EXEMPTION_KINDS.PATH_PREFIX, rules: ["r"], reason: "x", match: ["vendor/"] },
    ],
    baseline: { r: 0, exemptions: 1 },
    measure: async () => ({}),
  });
  const usage = createExemptionUsage(check);
  const measurement = measurementFromHits([]);
  const args = { usage, rule: "r", measurement, pattern: /bad/, message: "bad" };
  addExemptablePatternLineHits({ ...args, file: "vendor/a.js", source: "ok" });
  assert.deepEqual(usage.staleEntries(), ["e r vendor/"]);
  addExemptablePatternLineHits({ ...args, file: "vendor/a.js", source: "bad" });
  addExemptablePatternLineHits({ ...args, file: "src/a.js", source: "bad" });
  assert.deepEqual(usage.staleEntries(), []);
  assert.deepEqual(measurement.samples, ["src/a.js:1 bad"]);
});
