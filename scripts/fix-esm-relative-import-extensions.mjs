/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  ESM_SOURCE_EXTENSIONS,
  inspectSourceFile,
} from "./check-esm-relative-import-extensions.mjs";
import { repositoryRoot } from "./quality/repository-files.mjs";
import { getFirstPartyCodeFiles } from "./quality/source-inventory.mjs";

export function applyImportReplacements(source, findings) {
  return findings
    .map(({ replacement }) => replacement)
    .filter(Boolean)
    .sort((left, right) => right.start - left.start)
    .reduce(
      (result, { start, end, text }) => `${result.slice(0, start)}${text}${result.slice(end)}`,
      source,
    );
}

export async function fixEsmRelativeImportExtensions(root, files) {
  let fixed = 0;
  for (const file of files) {
    const absolute = path.join(root, file);
    const source = fs.readFileSync(absolute, "utf8");
    const findings = await inspectSourceFile(absolute, source);
    const result = applyImportReplacements(source, findings);
    if (result === source) continue;
    fs.writeFileSync(absolute, result);
    fixed += findings.filter(({ replacement }) => replacement).length;
  }
  return fixed;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const files = await getFirstPartyCodeFiles({
    repositoryRoot,
    extensions: ESM_SOURCE_EXTENSIONS,
    includeTests: true,
  });
  const fixed = await fixEsmRelativeImportExtensions(repositoryRoot, files);
  process.stdout.write(
    `fixed ${fixed} relative import(s); run check:esm-import-extensions to verify\n`,
  );
}
