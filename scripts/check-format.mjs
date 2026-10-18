#!/usr/bin/env node
/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import * as prettier from "prettier";
import {
  addHit,
  defineCheck,
  emptyRuleMeasurements,
  runCheckWhenMain,
} from "./quality/check-protocol.mjs";
import { listRepositoryFiles, repositoryRoot } from "./quality/repository-files.mjs";

const FORMATTED_FILE_PATTERN = /\.(?:cjs|js|json|md|mjs|vue|yaml|yml)$/i;
const IGNORE_PATH = ".prettierignore";

export async function measureFormat(root, files) {
  const measured = emptyRuleMeasurements(CHECK);
  const ignorePath = path.join(root, IGNORE_PATH);
  for (const file of files) {
    const filepath = path.join(root, file);
    const { ignored } = await prettier.getFileInfo(filepath, { ignorePath });
    if (ignored) continue;
    const options = await prettier.resolveConfig(filepath, { editorconfig: true });
    const source = await readFile(filepath, "utf8");
    if (!(await prettier.check(source, { ...options, filepath }))) {
      addHit(measured.unformattedFile, { file, message: "differs from prettier output" });
    }
  }
  return measured;
}

export const CHECK = defineCheck({
  id: "format",
  description: "Repository text files match prettier output",
  rules: {
    unformattedFile: {
      description: "A tracked or untracked non-ignored file differs from prettier output",
      hint: "run npx prettier --write <file>",
    },
  },
  exemptions: [],
  baseline: { unformattedFile: 0, exemptions: 0 },
  measure: () =>
    measureFormat(repositoryRoot, listRepositoryFiles(repositoryRoot, FORMATTED_FILE_PATTERN)),
});

await runCheckWhenMain(CHECK, import.meta.url);
