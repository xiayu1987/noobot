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
import { getFirstPartyCodeFiles } from "./quality/source-inventory.mjs";
import { countEffectiveCodeLines } from "./quality/effective-line-count.mjs";

const MAX_EFFECTIVE_LINES = 800;

async function measure() {
  const measured = emptyRuleMeasurements(CHECK);
  for (const file of await getFirstPartyCodeFiles({ repositoryRoot, includeTests: true })) {
    const effectiveLines = countEffectiveCodeLines(await readRepositoryText(file));
    if (effectiveLines > MAX_EFFECTIVE_LINES) {
      addHit(measured.oversizedFile, {
        file,
        message: `${effectiveLines} effective lines exceed ${MAX_EFFECTIVE_LINES}`,
      });
    }
  }
  return measured;
}

export const CHECK = defineCheck({
  id: "file-effective-lines",
  description: `First-party code files stay within ${MAX_EFFECTIVE_LINES} effective lines`,
  rules: {
    oversizedFile: {
      description: `A code file, including tests, has more than ${MAX_EFFECTIVE_LINES} effective lines`,
      hint: "split the file along a real responsibility boundary",
    },
  },
  exemptions: [],
  baseline: { oversizedFile: 0, exemptions: 0 },
  measure,
});

await runCheckWhenMain(CHECK, import.meta.url);
