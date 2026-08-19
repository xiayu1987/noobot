/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { getFirstPartyCodeFiles } from "./quality/source-inventory.mjs";
import { countEffectiveCodeLines } from "./quality/effective-line-count.mjs";

const MAX_EFFECTIVE_LINES = 800;
const repositoryRoot = path.resolve(import.meta.dirname, "..");
const files = await getFirstPartyCodeFiles({ repositoryRoot, includeTests: true });
const violations = [];
let maximum = { file: "", effectiveLines: 0 };

for (const file of files) {
  const effectiveLines = countEffectiveCodeLines(
    await readFile(path.join(repositoryRoot, file), "utf8"),
  );
  if (effectiveLines > maximum.effectiveLines) maximum = { file, effectiveLines };
  if (effectiveLines > MAX_EFFECTIVE_LINES) violations.push({ file, effectiveLines });
}

violations.sort((left, right) => right.effectiveLines - left.effectiveLines);
if (violations.length) {
  console.error(
    [
      `Effective file line check failed (maximum ${MAX_EFFECTIVE_LINES}):`,
      ...violations.map(({ file, effectiveLines }) => `${file}: ${effectiveLines}`),
    ].join("\n"),
  );
  process.exitCode = 1;
} else {
  console.log(
    `Effective file line check passed (${files.length} files, max ${maximum.effectiveLines} at ${maximum.file})`,
  );
}
