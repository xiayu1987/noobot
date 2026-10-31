/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import path from "node:path";
import { ESLint } from "eslint";
import {
  addHit,
  defineCheck,
  emptyMeasurement,
  runCheckWhenMain,
} from "./quality/check-protocol.mjs";
import { getFirstPartyProductionFiles } from "./quality/source-inventory.mjs";

const root = path.resolve(import.meta.dirname, "..");
const COMPLEXITY_LIMIT = 20;
const LINT_RULES = Object.freeze({
  complexity: ["error", COMPLEXITY_LIMIT],
  "max-lines-per-function": ["error", { max: 150, skipBlankLines: true, skipComments: true }],
  "no-nested-ternary": "error",
  "max-depth": ["error", 4],
  "max-params": ["error", 4],
});
const COUNTED_RULES = Object.freeze({
  complexityCount: "complexity",
  longFunctionCount: "max-lines-per-function",
  nestedTernaryCount: "no-nested-ternary",
  deepNestingCount: "max-depth",
  longParameterListCount: "max-params",
});

function measuredComplexity(message) {
  const value = Number(/complexity of (\d+)/.exec(message.message)?.[1]);
  if (!Number.isInteger(value))
    throw new TypeError(`unexpected complexity message: ${message.message}`);
  return value;
}

export function measureLintResults(results, repositoryRoot = root) {
  const measured = Object.fromEntries(
    [...Object.keys(COUNTED_RULES), "maxComplexity"].map((name) => [name, emptyMeasurement()]),
  );
  for (const result of results) {
    const file = path.relative(repositoryRoot, result.filePath);
    for (const [name, ruleId] of Object.entries(COUNTED_RULES)) {
      for (const message of result.messages) {
        if (message.ruleId === ruleId)
          addHit(measured[name], { file, line: message.line, message: message.message });
      }
    }
    const values = result.messages
      .filter(({ ruleId }) => ruleId === "complexity")
      .map(measuredComplexity);
    if (!values.length) continue;
    const fileMax = Math.max(...values);
    measured.maxComplexity.files[file] = fileMax;
    measured.maxComplexity.total = Math.max(measured.maxComplexity.total, fileMax);
  }
  return measured;
}

async function measure() {
  const lint = new ESLint({
    cwd: root,
    overrideConfig: [{ files: ["**/*.{js,mjs,cjs,vue}"], rules: LINT_RULES }],
  });
  const files = await getFirstPartyProductionFiles({ repositoryRoot: root });
  return measureLintResults(await lint.lintFiles(files));
}

export const CHECK = defineCheck({
  id: "complexity",
  description: "function complexity, length, nesting and parameter-count limits",
  rules: {
    complexityCount: {
      description: `functions with cyclomatic complexity above ${COMPLEXITY_LIMIT}`,
      hint: "split the function by responsibility instead of adding branches",
    },
    longFunctionCount: {
      description: "functions longer than 150 effective lines",
      hint: "extract cohesive steps into named functions",
    },
    maxComplexity: {
      description: "highest cyclomatic complexity of any single function",
      hint: "reduce the most complex function listed below",
    },
    nestedTernaryCount: {
      description: "nested conditional expressions",
      hint: "replace nested ternaries with a lookup table or early returns",
    },
    deepNestingCount: {
      description: "blocks nested deeper than 4 levels",
      hint: "flatten with early returns or extracted helpers",
    },
    longParameterListCount: {
      description: "functions with more than 4 positional parameters",
      hint: "pass a single named options object defined by the caller protocol",
    },
  },
  exemptions: [],
  baseline: {
    complexityCount: 158,
    longFunctionCount: 57,
    maxComplexity: 48,
    nestedTernaryCount: 76,
    deepNestingCount: 20,
    longParameterListCount: 45,
    exemptions: 0,
  },
  measure,
});

await runCheckWhenMain(CHECK, import.meta.url);
