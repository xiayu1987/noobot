/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  defineCheck,
  emptyRuleMeasurements,
  EXEMPTION_KINDS,
  runCheckWhenMain,
} from "./quality/check-protocol.mjs";
import { readRepositoryText, repositoryRoot } from "./quality/repository-files.mjs";
import { addExemptablePatternOffsetHits } from "./quality/boundary-hits.mjs";
import { getFirstPartyFilesUnder } from "./quality/source-inventory.mjs";

const RUNTIME_SOURCE_ROOTS = Object.freeze(["client", "agent/src"]);
const SCANNED_EXTENSIONS = Object.freeze([".js", ".mjs", ".cjs", ".jsx", ".ts", ".tsx"]);
export const directPathModulePattern =
  /(?:\bfrom\s*|\brequire\s*\(\s*|\bimport\s*\(\s*)["'](?:node:)?path(?:\/(?:posix|win32))?["']/g;

async function measure(usage) {
  const measured = emptyRuleMeasurements(CHECK);
  const files = await getFirstPartyFilesUnder(RUNTIME_SOURCE_ROOTS, {
    repositoryRoot,
    extensions: SCANNED_EXTENSIONS,
    includeTests: true,
  });
  for (const file of files) {
    addExemptablePatternOffsetHits({
      usage,
      rule: "directPathModule",
      measurement: measured.directPathModule,
      file,
      source: await readRepositoryText(file),
      pattern: directPathModulePattern,
      message: "direct path module access",
    });
  }
  return measured;
}

export const CHECK = defineCheck({
  id: "bare-file-paths",
  description: "Client and agent runtime sources reach file path APIs only through the resolver",
  rules: {
    directPathModule: {
      description: "Runtime sources never import node:path, path/posix or path/win32 directly",
      hint: "import path helpers from @noobot/client-shared/path-resolver or @noobot/path-resolver",
    },
  },
  exemptions: [
    {
      id: "client-path-resolver",
      kind: EXEMPTION_KINDS.PATH_PREFIX,
      rules: ["directPathModule"],
      reason: "client/shared/path-resolver.js is the single wrapper around the Node path module",
      match: ["client/shared/path-resolver.js"],
    },
  ],
  baseline: { directPathModule: 0, exemptions: 1 },
  measure,
});

await runCheckWhenMain(CHECK, import.meta.url);
