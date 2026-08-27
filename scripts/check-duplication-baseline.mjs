/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  FIRST_PARTY_IGNORED_GLOBS,
  getFirstPartySourceRoots,
} from "./quality/source-inventory.mjs";

const repositoryRoot = path.resolve(import.meta.dirname, "..");
const baseline = Object.freeze({
  clones: 168,
  duplicatedLines: 4410,
  percentage: 1.81962221,
});

const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "noobot-duplication-"));
try {
  const baseConfig = JSON.parse(
    await readFile(path.join(repositoryRoot, "jscpd-config.json"), "utf8"),
  );
  const reportDirectory = path.join(temporaryRoot, "report");
  const configPath = path.join(temporaryRoot, "jscpd-config.json");
  await writeFile(
    configPath,
    `${JSON.stringify(
      {
        ...baseConfig,
        ignore: FIRST_PARTY_IGNORED_GLOBS,
        output: reportDirectory,
        reporters: ["json"],
        silent: true,
      },
      null,
      2,
    )}\n`,
    "utf8",
  );

  const sourceRoots = await getFirstPartySourceRoots({ repositoryRoot });
  execFileSync(
    process.platform === "win32" ? "npx.cmd" : "npx",
    ["--yes", "jscpd@5.0.11", ...sourceRoots, "--config", configPath],
    { cwd: repositoryRoot, stdio: "pipe" },
  );
  const report = JSON.parse(
    await readFile(path.join(reportDirectory, "jscpd-report.json"), "utf8"),
  );
  const total = report?.statistics?.total || {};
  const actual = {
    clones: Number(total.clones || 0),
    duplicatedLines: Number(total.duplicatedLines || 0),
    percentage: Number(Number(total.percentage || 0).toFixed(8)),
    sources: Number(total.sources || 0),
  };
  const violations = [];
  if (actual.clones > baseline.clones) {
    violations.push(`clones ${actual.clones} exceeds baseline ${baseline.clones}`);
  }
  if (actual.duplicatedLines > baseline.duplicatedLines) {
    violations.push(
      `duplicated lines ${actual.duplicatedLines} exceeds baseline ${baseline.duplicatedLines}`,
    );
  }
  if (actual.percentage > baseline.percentage) {
    violations.push(
      `duplicated percentage ${actual.percentage.toFixed(8)} exceeds baseline ${baseline.percentage.toFixed(8)}`,
    );
  }
  if (violations.length) {
    console.error(
      `Duplication baseline failed (${actual.sources} sources):\n${violations.join("\n")}`,
    );
    process.exitCode = 1;
  } else {
    console.log(
      `Duplication baseline passed (${actual.sources} sources, ${actual.clones} clones, ${actual.duplicatedLines} duplicated lines, ${actual.percentage.toFixed(8)}%)`,
    );
  }
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}
