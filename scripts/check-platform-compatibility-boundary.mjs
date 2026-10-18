/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { defineCheck, emptyRuleMeasurements, runCheckWhenMain } from "./quality/check-protocol.mjs";
import { readRepositoryText } from "./quality/repository-files.mjs";
import { addPatternOffsetHits } from "./quality/boundary-hits.mjs";

const FORMER_PLATFORM_FACT_OWNERS = Object.freeze([
  {
    file: "path-resolver/src/platform.js",
    patterns: [/\["win",\s*"win32",\s*"windows"\]/g, /\["mac",\s*"macos",\s*"darwin",\s*"osx"\]/g],
  },
  {
    file: "execution-isolation-protocol/src/protocol.js",
    patterns: [/platform[^\n]*===?[^\n]*["']win32["']/g, /["']cmd\.exe["']|["']\/bin\/sh["']/g],
  },
  {
    file: "agent/src/shared/storage/atomic-file-write.js",
    patterns: [/EPERM|EACCES|EBUSY/g, /platform[^\n]*===?/g],
  },
  {
    file: "agent/src/tools/execution/native-script-runtime.js",
    patterns: [/process\.platform[^\n]*(?:soffice|libreoffice)/gi],
  },
  {
    file: "agent/src/tools/execution/native-script-tool.js",
    patterns: [/process\.platform\s*!==?\s*["']win32["']/g],
  },
  {
    file: "agent/src/tools/execution/script-tool/process-exec.js",
    patterns: [
      /process\.platform\s*[!=]==?\s*["']win32["']/g,
      /["']where["']\s*:\s*["']which["']/g,
      /process\.kill\(-/g,
      /shift_jis|euc-kr|windows-1252/g,
    ],
  },
  {
    file: "service/services/openvscode/process.js",
    patterns: [/process\.platform\s*===?\s*["']win32["']/g, /["']taskkill["']/g],
  },
  {
    file: "client/shared/electron/runtime/services.js",
    patterns: [
      /process\.platform\s*===?\s*["']win32["']/g,
      /["']taskkill["']/g,
      /["']npm\.cmd["']/g,
    ],
  },
]);

async function measure() {
  const measured = emptyRuleMeasurements(CHECK);
  for (const { file, patterns } of FORMER_PLATFORM_FACT_OWNERS) {
    const source = await readRepositoryText(file);
    for (const pattern of patterns) {
      addPatternOffsetHits({
        measurement: measured.platformFact,
        file,
        source,
        pattern,
        message: `platform fact ${pattern}`,
      });
    }
  }
  return measured;
}

export const CHECK = defineCheck({
  id: "platform-compatibility-boundary",
  description:
    "Platform compatibility facts are implemented once by @noobot/platform-compatibility",
  rules: {
    platformFact: {
      description: "Former owners never re-implement OS names, shells, kill or encoding facts",
      hint: "consume the fact from @noobot/platform-compatibility",
    },
  },
  exemptions: [],
  baseline: { platformFact: 0, exemptions: 0 },
  measure,
});

await runCheckWhenMain(CHECK, import.meta.url);
