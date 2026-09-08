/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { ESLint } from "eslint";

const repositoryRoot = path.resolve(import.meta.dirname, "../..");
const fixturePath = path.join(repositoryRoot, "scripts/quality/unused-code-fixture.js");
const eslint = new ESLint({ cwd: repositoryRoot });

async function lintRuleIds(source) {
  const [result] = await eslint.lintText(source, { filePath: fixturePath });
  return result.messages.map((message) => message.ruleId);
}

test("quality lint rejects unused imports", async () => {
  const ruleIds = await lintRuleIds('import unused from "./dependency.js";\n');
  assert.ok(ruleIds.includes("unused-imports/no-unused-imports"));
});

test("quality lint rejects unused local functions", async () => {
  const ruleIds = await lintRuleIds("function unused() {}\n");
  assert.ok(ruleIds.includes("unused-imports/no-unused-vars"));
});

test("quality lint accepts referenced imports and functions", async () => {
  const ruleIds = await lintRuleIds(
    'import value from "./dependency.js";\nfunction read() { return value; }\nread();\n',
  );
  assert.equal(ruleIds.includes("unused-imports/no-unused-imports"), false);
  assert.equal(ruleIds.includes("unused-imports/no-unused-vars"), false);
});
