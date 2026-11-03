/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { DEVELOPMENT_THRESHOLDS } from "./lib/development-thresholds.mjs";
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
const COMPLEXITY_LIMIT = DEVELOPMENT_THRESHOLDS.quantity.complexityLimit;
const NESTING_LIMIT = DEVELOPMENT_THRESHOLDS.quantity.nestingLimit;
export const LINT_RULES = Object.freeze({
  complexity: ["error", COMPLEXITY_LIMIT],
  "max-lines-per-function": ["error", { max: 150, skipBlankLines: true, skipComments: true }],
  "no-nested-ternary": "error",
  "max-depth": ["error", NESTING_LIMIT],
  "max-params": ["error", 4],
});
const COUNTED_RULES = Object.freeze({
  complexityCount: "complexity",
  longFunctionCount: "max-lines-per-function",
  nestedTernaryCount: "no-nested-ternary",
  deepNestingCount: "max-depth",
  longParameterListCount: "max-params",
});
const MEASUREMENT_BY_RULE = new Map(
  Object.entries(COUNTED_RULES).map(([name, rule]) => [rule, name]),
);

function measuredComplexity(message) {
  const value = Number(/complexity of (\d+)/.exec(message.message)?.[1]);
  if (!Number.isInteger(value))
    throw new TypeError(`unexpected complexity message: ${message.message}`);
  return value;
}

function addCountedRuleHits(measured, file, messages) {
  for (const message of messages) {
    const name = MEASUREMENT_BY_RULE.get(message.ruleId);
    if (name) addHit(measured[name], { file, line: message.line, message: message.message });
  }
}

export function measureLintResults(results, repositoryRoot = root) {
  const measured = Object.fromEntries(
    [...Object.keys(COUNTED_RULES), "maxComplexity"].map((name) => [name, emptyMeasurement()]),
  );
  for (const result of results) {
    const file = path.relative(repositoryRoot, result.filePath);
    addCountedRuleHits(measured, file, result.messages);
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
      description: `blocks nested deeper than ${NESTING_LIMIT} levels`,
      hint: "flatten with early returns or extracted helpers",
    },
    longParameterListCount: {
      description: "functions with more than 4 positional parameters",
      hint: "pass a single named options object defined by the caller protocol",
    },
  },
  exemptions: [],
  baseline: {
    complexityCount: 126,
    longFunctionCount: 57,
    maxComplexity: 48,
    nestedTernaryCount: 74,
    deepNestingCount: 286,
    longParameterListCount: 41,
    exemptions: 0,
  },
  measure,
});

await runCheckWhenMain(CHECK, import.meta.url);
