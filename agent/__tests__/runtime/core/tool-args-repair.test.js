/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";

import { repairToolCallArgs } from "../../../src/runtime/tool-execution/tool-args-repair.js";

const schema = z.object({
  filePath: z.string(),
  startLine: z.number().int().min(1).optional(),
  endLine: z.number().int().min(1).optional(),
  maxLines: z.number().int().min(-1).optional().default(1000),
  includeLineNumbers: z.boolean().optional().default(true),
  overwrite: z.boolean().optional().default(true),
  strip: z.number().int().optional().default(1),
  dryRun: z.boolean().optional().default(false),
  options: z.object({ verbose: z.boolean().optional() }).optional(),
});

test("repairToolCallArgs returns null when args already match the schema", () => {
  assert.equal(repairToolCallArgs(schema, { filePath: "a.js", maxLines: 10 }), null);
});

test("repairToolCallArgs converts exact boolean and integer literals declared by the schema", () => {
  const args = {
    filePath: "a.js",
    startLine: "1",
    endLine: "60",
    maxLines: "-1",
    includeLineNumbers: "true",
    overwrite: "false",
    strip: "0",
    dryRun: "false",
  };
  const repaired = repairToolCallArgs(schema, args);

  assert.deepEqual(repaired.args, {
    filePath: "a.js",
    startLine: 1,
    endLine: 60,
    maxLines: -1,
    includeLineNumbers: true,
    overwrite: false,
    strip: 0,
    dryRun: false,
  });
  assert.equal(repaired.repairs.length, 7);
  assert.deepEqual(
    repaired.repairs.find((item) => item.path[0] === "dryRun"),
    {
      path: ["dryRun"],
      from: "false",
      to: false,
    },
  );
  assert.equal(args.dryRun, "false");
});

test("repairToolCallArgs repairs nested fields by issue path", () => {
  const repaired = repairToolCallArgs(schema, { filePath: "a.js", options: { verbose: "true" } });
  assert.deepEqual(repaired.args.options, { verbose: true });
  assert.deepEqual(repaired.repairs[0].path, ["options", "verbose"]);
});

test("repairToolCallArgs refuses non-literal values instead of guessing", () => {
  for (const value of ["yes", "1", "TRUE", " true", ""]) {
    assert.equal(repairToolCallArgs(schema, { filePath: "a.js", dryRun: value }), null, value);
  }
  for (const value of ["1.5", "1e3", " 1", "abc", "9007199254740993"]) {
    assert.equal(repairToolCallArgs(schema, { filePath: "a.js", startLine: value }), null, value);
  }
});

test("repairToolCallArgs rejects converted values that still violate schema constraints", () => {
  assert.equal(repairToolCallArgs(schema, { filePath: "a.js", startLine: "0" }), null);
});

test("repairToolCallArgs gives up when any unrelated issue remains", () => {
  assert.equal(repairToolCallArgs(schema, { dryRun: "false" }), null);
  assert.equal(repairToolCallArgs(schema, { filePath: 1, dryRun: "false" }), null);
});

test("repairToolCallArgs ignores tools without a zod schema and non-object args", () => {
  assert.equal(repairToolCallArgs(undefined, { dryRun: "false" }), null);
  assert.equal(repairToolCallArgs({ type: "object" }, { dryRun: "false" }), null);
  assert.equal(repairToolCallArgs(schema, "dryRun=false"), null);
});
