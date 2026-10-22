/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { defineCheck, emptyMeasurement, runCheckWhenMain } from "./quality/check-protocol.mjs";
import { mergeDuplicationIgnoreGlobs } from "./quality/duplication-config.mjs";
import {
  FIRST_PARTY_IGNORED_GLOBS,
  getFirstPartySourceRoots,
} from "./quality/source-inventory.mjs";

const repositoryRoot = path.resolve(import.meta.dirname, "..");

export function measureReport(report, root = repositoryRoot) {
  const { clones, duplicatedLines } = report.statistics.total;
  const cloneFiles = {};
  const lineFiles = {};
  for (const duplicate of report.duplicates) {
    for (const side of [duplicate.firstFile, duplicate.secondFile]) {
      const file = path.relative(root, side.name);
      cloneFiles[file] = (cloneFiles[file] ?? 0) + 1;
      lineFiles[file] = (lineFiles[file] ?? 0) + duplicate.lines;
    }
  }
  return {
    clones: { ...emptyMeasurement(), total: clones, files: cloneFiles },
    duplicatedLines: { ...emptyMeasurement(), total: duplicatedLines, files: lineFiles },
  };
}

async function runJscpd(temporaryRoot) {
  const baseConfig = JSON.parse(
    await readFile(path.join(repositoryRoot, "jscpd-config.json"), "utf8"),
  );
  const reportDirectory = path.join(temporaryRoot, "report");
  const configPath = path.join(temporaryRoot, "jscpd-config.json");
  const config = {
    ...baseConfig,
    ignore: mergeDuplicationIgnoreGlobs(baseConfig.ignore, FIRST_PARTY_IGNORED_GLOBS),
    output: reportDirectory,
    reporters: ["json"],
    silent: true,
  };
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
  const sourceRoots = await getFirstPartySourceRoots({ repositoryRoot });
  execFileSync(
    process.platform === "win32" ? "npx.cmd" : "npx",
    ["--yes", "jscpd@5.0.11", ...sourceRoots, "--config", configPath],
    { cwd: repositoryRoot, stdio: "pipe" },
  );
  return JSON.parse(await readFile(path.join(reportDirectory, "jscpd-report.json"), "utf8"));
}

async function measure() {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "noobot-duplication-"));
  try {
    return measureReport(await runJscpd(temporaryRoot));
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
}

export const CHECK = defineCheck({
  id: "duplication",
  description: "copy-pasted code blocks detected by jscpd across first-party sources",
  rules: {
    clones: {
      description: "jscpd clone pairs (statistics.total.clones)",
      hint: "extract the shared block into one owning module and import it",
    },
    duplicatedLines: {
      description: "lines covered by clones (statistics.total.duplicatedLines)",
      hint: "extract the shared block into one owning module and import it",
    },
  },
  exemptions: [],
  baseline: { clones: 48, duplicatedLines: 543, exemptions: 0 },
  measure,
});

await runCheckWhenMain(CHECK, import.meta.url);
