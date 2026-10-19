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
import { UNUSED_PARAMETER_OPTIONS, UNUSED_VARS_RULE_ID } from "./quality/unused-code-config.mjs";

const root = path.resolve(import.meta.dirname, "..");

export function createUnusedParameterLinter(repositoryRoot = root) {
  return new ESLint({
    cwd: repositoryRoot,
    overrideConfig: [
      {
        files: ["**/*.{js,mjs,cjs,vue}"],
        rules: { [UNUSED_VARS_RULE_ID]: ["error", UNUSED_PARAMETER_OPTIONS] },
      },
    ],
  });
}

export function measureLintResults(results, repositoryRoot = root) {
  const measurement = emptyMeasurement();
  for (const result of results) {
    const file = path.relative(repositoryRoot, result.filePath);
    for (const { ruleId, line, message } of result.messages) {
      if (ruleId === UNUSED_VARS_RULE_ID) addHit(measurement, { file, line, message });
    }
  }
  return measurement;
}

async function measure() {
  const files = await getFirstPartyProductionFiles({ repositoryRoot: root });
  const results = await createUnusedParameterLinter().lintFiles(files);
  return { unusedParameters: measureLintResults(results) };
}

export const CHECK = defineCheck({
  id: "unused-parameters",
  description: "parameters and catch bindings that the function body never reads",
  rules: {
    unusedParameters: {
      description: "unused positional parameters (including leading ones) and catch bindings",
      hint: "drop the parameter or converge the caller protocol so the position is not required",
    },
  },
  exemptions: [],
  baseline: { unusedParameters: 49, exemptions: 0 },
  measure,
});

await runCheckWhenMain(CHECK, import.meta.url);
