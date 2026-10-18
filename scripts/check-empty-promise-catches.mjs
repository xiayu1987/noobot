/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { defineCheck, emptyRuleMeasurements, runCheckWhenMain } from "./quality/check-protocol.mjs";
import { readRepositoryText, repositoryRoot } from "./quality/repository-files.mjs";
import { addPatternOffsetHits } from "./quality/boundary-hits.mjs";
import { getFirstPartyProductionFiles } from "./quality/source-inventory.mjs";

export const EMPTY_PROMISE_CATCH = /\.catch\s*\(\s*(?:async\s*)?\([^)]*\)\s*=>\s*\{\s*\}\s*\)/gu;

async function measure() {
  const measured = emptyRuleMeasurements(CHECK);
  for (const file of await getFirstPartyProductionFiles({ repositoryRoot })) {
    addPatternOffsetHits({
      measurement: measured.emptyPromiseCatch,
      file,
      source: await readRepositoryText(file),
      pattern: EMPTY_PROMISE_CATCH,
      message: "empty Promise rejection handler",
    });
  }
  return measured;
}

export const CHECK = defineCheck({
  id: "empty-promise-catches",
  description: "Production Promise rejections are never swallowed silently",
  rules: {
    emptyPromiseCatch: {
      description: "Production sources never call .catch with an empty arrow handler",
      hint: "handle or report the rejection, or let it propagate",
    },
  },
  exemptions: [],
  baseline: { emptyPromiseCatch: 0, exemptions: 0 },
  measure,
});

await runCheckWhenMain(CHECK, import.meta.url);
