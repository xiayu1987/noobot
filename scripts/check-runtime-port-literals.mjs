#!/usr/bin/env node
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
import { addExemptablePatternLineHits } from "./quality/boundary-hits.mjs";
import { getFirstPartyCodeFiles } from "./quality/source-inventory.mjs";

const SCANNED_EXTENSIONS = Object.freeze([
  ".js",
  ".mjs",
  ".cjs",
  ".ts",
  ".vue",
  ".sh",
  ".json",
  ".example",
]);
const PORT_LITERAL = /\b1006[0-9]\b/;

async function measure(usage) {
  const measured = emptyRuleMeasurements(CHECK);
  const files = await getFirstPartyCodeFiles({
    repositoryRoot,
    extensions: SCANNED_EXTENSIONS,
    includeTests: false,
  });
  for (const file of files) {
    const source = await readRepositoryText(file);
    addExemptablePatternLineHits({
      usage,
      rule: "portLiteral",
      measurement: measured.portLiteral,
      file,
      source,
      pattern: PORT_LITERAL,
      message: "runtime port literal",
    });
  }
  return measured;
}

export const CHECK = defineCheck({
  id: "runtime-port-literals",
  description: "Runtime ports are declared once by runtime-topology-protocol",
  rules: {
    portLiteral: {
      description: "Production sources and committed configs never hard-code runtime ports",
      hint: "derive ports from @noobot/runtime-topology-protocol",
    },
  },
  exemptions: [
    {
      id: "runtime-topology-ports",
      kind: EXEMPTION_KINDS.PATH_PREFIX,
      rules: ["portLiteral"],
      reason: "ports.js is the single source of truth for runtime ports",
      match: ["runtime-topology-protocol/src/ports.js"],
    },
  ],
  baseline: { portLiteral: 0, exemptions: 1 },
  measure,
});

await runCheckWhenMain(CHECK, import.meta.url);
