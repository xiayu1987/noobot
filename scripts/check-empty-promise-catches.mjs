/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getFirstPartyProductionFiles } from "./quality/source-inventory.mjs";

const EMPTY_PROMISE_CATCH = /\.catch\s*\(\s*(?:async\s*)?\([^)]*\)\s*=>\s*\{\s*\}\s*\)/gu;

export function findEmptyPromiseCatchOffsets(source = "") {
  return Array.from(String(source || "").matchAll(EMPTY_PROMISE_CATCH), (match) => match.index);
}

function lineNumberAt(source, offset) {
  return source.slice(0, offset).split("\n").length;
}

export async function checkEmptyPromiseCatches({ repoRoot = process.cwd() } = {}) {
  const relativeFiles = await getFirstPartyProductionFiles({ repositoryRoot: repoRoot });
  const violations = [];
  for (const relativeFile of relativeFiles) {
    const file = path.join(repoRoot, relativeFile);
    const source = await fs.readFile(file, "utf8");
    for (const offset of findEmptyPromiseCatchOffsets(source)) {
      violations.push({
        file: path.relative(repoRoot, file).split(path.sep).join("/"),
        line: lineNumberAt(source, offset),
      });
    }
  }
  return { checkedFiles: relativeFiles.length, violations };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const result = await checkEmptyPromiseCatches();
  if (result.violations.length) {
    for (const violation of result.violations) {
      console.error(`${violation.file}:${violation.line}: empty Promise rejection handler`);
    }
    process.exitCode = 1;
  } else {
    console.log(`Empty Promise catch check passed (${result.checkedFiles} production sources).`);
  }
}
