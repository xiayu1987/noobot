/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { ESLint } from "eslint";
import { LINT_RULES, measureLintResults } from "./check-complexity-baseline.mjs";

const repositoryRoot = path.resolve(import.meta.dirname, "..");
const fixturePath = path.join(repositoryRoot, "scripts/quality/nesting-fixture.js");
const lint = new ESLint({
  cwd: repositoryRoot,
  overrideConfig: [{ files: ["**/*.js"], rules: LINT_RULES }],
});

async function nesting(source) {
  const results = await lint.lintText(source, { filePath: fixturePath });
  assert.equal(
    results.some((result) => result.fatalErrorCount > 0),
    false,
  );
  return measureLintResults(results, repositoryRoot).deepNestingCount;
}

for (const loop of [
  "for (let i = 0; i < 1; i++)",
  "for (const value of [])",
  "for (const key in {})",
  "while (true)",
]) {
  test(`allows two levels and reports the third level for ${loop}`, async () => {
    assert.equal((await nesting(`${loop} { ${loop} {} }`)).total, 0);
    const measured = await nesting(`${loop} { ${loop} { ${loop} {} } }`);
    assert.equal(measured.total, 1);
    assert.deepEqual(measured.files, { "scripts/quality/nesting-fixture.js": 1 });
    assert.match(measured.samples[0], /Maximum allowed is 2/);
  });
}

test("counts mixed loop and conditional nesting", async () => {
  assert.equal((await nesting("for (;;) { if (true) {} }")).total, 0);
  assert.equal((await nesting("for (;;) { if (true) { for (;;) {} } }")).total, 1);
});

test("starts a separate nesting depth inside extracted functions", async () => {
  assert.equal(
    (await nesting("for (;;) { for (;;) { const helper = () => { for (;;) {} }; helper(); } }"))
      .total,
    0,
  );
});

test("measurement counts each registered rule and ignores unrelated lint messages", () => {
  const messages = [
    { ruleId: "max-depth", line: 3, message: "third level" },
    { ruleId: "complexity", line: 4, message: "Function has a complexity of 21." },
    { ruleId: "max-params", line: 5, message: "five parameters" },
    { ruleId: "max-lines-per-function", line: 6, message: "long function" },
    { ruleId: "no-nested-ternary", line: 7, message: "nested ternary" },
    { ruleId: "no-unused-vars", line: 8, message: "unrelated" },
    { ruleId: null, line: 9, message: "parser diagnostic" },
  ];
  const measured = measureLintResults(
    [
      { filePath: fixturePath, messages },
      {
        filePath: path.join(repositoryRoot, "scripts/quality/second-fixture.js"),
        messages: [
          { ruleId: "max-depth", line: 10, message: "fourth level" },
          { ruleId: "complexity", line: 11, message: "Function has a complexity of 25." },
        ],
      },
    ],
    repositoryRoot,
  );
  assert.deepEqual(
    Object.fromEntries(Object.entries(measured).map(([name, value]) => [name, value.total])),
    {
      complexityCount: 2,
      longFunctionCount: 1,
      nestedTernaryCount: 1,
      deepNestingCount: 2,
      longParameterListCount: 1,
      maxComplexity: 25,
    },
  );
  assert.deepEqual(measured.deepNestingCount.files, {
    "scripts/quality/nesting-fixture.js": 1,
    "scripts/quality/second-fixture.js": 1,
  });
  assert.deepEqual(measured.deepNestingCount.samples, [
    "scripts/quality/nesting-fixture.js:3 third level",
    "scripts/quality/second-fixture.js:10 fourth level",
  ]);
});
