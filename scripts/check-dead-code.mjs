/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { DEVELOPMENT_THRESHOLDS } from "./lib/development-thresholds.mjs";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import {
  addHit,
  defineCheck,
  emptyRuleMeasurements,
  EXEMPTION_KINDS,
  NO_EXEMPTIONS,
  runCheckWhenMain,
} from "./quality/check-protocol.mjs";
import { repositoryRoot } from "./quality/repository-files.mjs";
import { isFirstPartyProductionPath } from "./quality/source-inventory.mjs";

const require = createRequire(import.meta.url);
const knipCli = path.resolve(path.dirname(require.resolve("knip")), "../bin/knip.js");
const ISSUE_RULES = Object.freeze({
  files: "unusedFiles",
  exports: "unusedExports",
  nsExports: "unusedExports",
  dependencies: "unusedDependencies",
  devDependencies: "unusedDependencies",
  optionalPeerDependencies: "unusedDependencies",
});

function measureIssueGroup(measurement, { file, type, issues }, usage) {
  const rule = ISSUE_RULES[type];
  for (const issue of issues) {
    if (usage.exempts(rule, EXEMPTION_KINDS.PROPERTY_NAME, `${file}#${issue.name}`)) continue;
    addHit(measurement, { file, line: issue.line, message: `${type}: ${issue.name}` });
  }
}

function measureReportRow(measured, row, usage) {
  for (const [type, rule] of Object.entries(ISSUE_RULES)) {
    measureIssueGroup(measured[rule], { file: row.file, type, issues: row[type] }, usage);
  }
}

export function measureDeadCodeReport(report, usage = NO_EXEMPTIONS) {
  if (!Array.isArray(report.issues)) throw new TypeError("Knip report must contain issues");
  const measured = emptyRuleMeasurements(CHECK);
  for (const row of report.issues) {
    if (isFirstPartyProductionPath(row.file)) measureReportRow(measured, row, usage);
  }
  return measured;
}

export function scanDeadCode(root, configPath) {
  const result = spawnSync(
    process.execPath,
    [knipCli, "--directory", root, "--config", configPath, "--reporter", "json", "--no-progress"],
    {
      cwd: root,
      encoding: "utf8",
      maxBuffer: DEVELOPMENT_THRESHOLDS.length.deadCodeOutputBytes,
    },
  );
  if (result.error) throw result.error;
  if (result.status !== 0 && result.status !== 1) {
    throw new Error(`Knip failed (exit ${result.status}): ${result.stderr}\n${result.stdout}`);
  }
  try {
    return JSON.parse(result.stdout);
  } catch (error) {
    throw new Error(`Knip returned an invalid report: ${result.stderr}\n${result.stdout}`, {
      cause: error,
    });
  }
}

export const CHECK = defineCheck({
  id: "dead-code",
  description: "First-party production files, exports and dependencies remain reachable",
  rules: {
    unusedFiles: {
      description:
        "Source files unreachable from application, package, plugin, script and test entries",
      hint: "delete the unused file or declare its verified runtime entry",
    },
    unusedExports: {
      description: "Exports that no other reachable module imports",
      hint: "remove the unused export or converge its consumer; keep package exports as public entries",
    },
    unusedDependencies: {
      description: "Declared dependencies without a reachable consumer",
      hint: "remove the unused dependency or document a verified dynamic loader exemption",
    },
  },
  exemptions: [
    {
      id: "connector-dynamic-drivers",
      kind: EXEMPTION_KINDS.PROPERTY_NAME,
      rules: ["unusedDependencies"],
      reason:
        "Connector channels pass these package names to loadDriverModule, which imports a variable",
      match: [
        "connector-instances/package.json#mysql2",
        "connector-instances/package.json#pg",
        "connector-instances/package.json#ssh2",
      ],
    },
  ],
  baseline: { unusedFiles: 0, unusedExports: 80, unusedDependencies: 29, exemptions: 3 },
  measure: async (usage) =>
    measureDeadCodeReport(scanDeadCode(repositoryRoot, "knip.config.mjs"), usage),
});

await runCheckWhenMain(CHECK, import.meta.url);
