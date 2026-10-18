/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { defineCheck, emptyRuleMeasurements, runCheckWhenMain } from "./quality/check-protocol.mjs";
import { readRepositoryText, repositoryRoot } from "./quality/repository-files.mjs";
import { addPatternOffsetHits } from "./quality/boundary-hits.mjs";
import { getFirstPartyFilesUnder } from "./quality/source-inventory.mjs";

const PLUGIN_KEY_CALLS = Object.freeze([
  {
    sourceDir: "plugin/noobot-plugin-harness/src",
    directKeyCall: /translateI18nText\s*\(\s*[^,]+,\s*["'][A-Za-z0-9_]+["']/g,
  },
  {
    sourceDir: "plugin/noobot-plugin-workflow/src",
    directKeyCall: /tWorkflow\s*\(\s*[^,]+,\s*["']workflow[A-Za-z0-9_]+["']/g,
  },
]);

async function measure() {
  const measured = emptyRuleMeasurements(CHECK);
  for (const { sourceDir, directKeyCall } of PLUGIN_KEY_CALLS) {
    const files = await getFirstPartyFilesUnder([sourceDir], {
      repositoryRoot,
      extensions: [".js"],
      includeTests: true,
    });
    for (const file of files) {
      addPatternOffsetHits({
        measurement: measured.directKeyCall,
        file,
        source: await readRepositoryText(file),
        pattern: directKeyCall,
        message: "direct plugin i18n key string",
      });
    }
  }
  return measured;
}

export const CHECK = defineCheck({
  id: "plugin-i18n-keyset",
  description: "Plugin i18n keys are referenced only through each plugin's i18n module",
  rules: {
    directKeyCall: {
      description: "Plugin sources never pass literal i18n keys to the plugin translator",
      hint: "reference the key constant exported by the plugin i18n module",
    },
  },
  exemptions: [],
  baseline: { directKeyCall: 0, exemptions: 0 },
  measure,
});

await runCheckWhenMain(CHECK, import.meta.url);
