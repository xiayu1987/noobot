/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  addHit,
  defineCheck,
  emptyRuleMeasurements,
  runCheckWhenMain,
} from "./quality/check-protocol.mjs";
import { readRepositoryText, repositoryRoot } from "./quality/repository-files.mjs";
import { findForbiddenComments, listSourceFiles } from "./quality/source-comments.mjs";

async function measure() {
  const measured = emptyRuleMeasurements(CHECK);
  for (const file of listSourceFiles(repositoryRoot)) {
    for (const comment of findForbiddenComments(await readRepositoryText(file), file)) {
      addHit(measured.sourceComment, {
        file,
        line: comment.loc.start.line,
        message: "source comment",
      });
    }
  }
  return measured;
}

export const CHECK = defineCheck({
  id: "source-comments",
  description: "Source files carry only the license header and shebang as comments",
  rules: {
    sourceComment: {
      description: "Code, styles and shell scripts never contain explanatory comments",
      hint: "express intent through naming and structure, or run scripts/remove-source-comments.mjs",
    },
  },
  exemptions: [],
  baseline: { sourceComment: 0, exemptions: 0 },
  measure,
});

await runCheckWhenMain(CHECK, import.meta.url);
