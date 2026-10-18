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
import { getFirstPartyFilesUnder } from "./quality/source-inventory.mjs";

const RULE_PATTERNS = Object.freeze({
  inlineNormalization: [
    /String\(\s*parentSessionId\s*\|\|\s*""\s*\)\.trim\(\)/,
    /\btext\(\s*parentSessionId\s*\)/,
    /\(\s*parentSessionId\s*\?\?\s*""\s*\)\.trim\(\)/,
  ],
  runtimeFallback: [/systemRuntime\?\.parentSessionId\s*\|\|/, /runtime\?\.parentSessionId\s*\|\|/],
});

async function measure(usage) {
  const measured = emptyRuleMeasurements(CHECK);
  const files = await getFirstPartyFilesUnder(["agent/src"], {
    repositoryRoot,
    extensions: [".js"],
    includeTests: false,
  });
  for (const file of files) {
    const source = await readRepositoryText(file);
    for (const [rule, patterns] of Object.entries(RULE_PATTERNS)) {
      for (const pattern of patterns) {
        const message = `parentSessionId ${rule}`;
        const measurement = measured[rule];
        addExemptablePatternLineHits({ usage, rule, measurement, file, source, pattern, message });
      }
    }
  }
  return measured;
}

export const CHECK = defineCheck({
  id: "parent-sessionid-unification",
  description: "parentSessionId is normalized once by the session layer",
  rules: {
    inlineNormalization: {
      description: "Callers never re-normalize parentSessionId with text() or String().trim()",
      hint: "read the parentSessionId already normalized by agent/src/session",
    },
    runtimeFallback: {
      description: "parentSessionId never falls back between runtime carriers",
      hint: "read parentSessionId from its single writer instead of chaining runtime sources",
    },
  },
  exemptions: [
    {
      id: "session-normalization-layer",
      kind: EXEMPTION_KINDS.PATH_PREFIX,
      rules: ["inlineNormalization"],
      reason: "agent/src/session is the single layer that normalizes inbound parentSessionId",
      match: ["agent/src/session/"],
    },
  ],
  baseline: { inlineNormalization: 0, runtimeFallback: 0, exemptions: 1 },
  measure,
});

await runCheckWhenMain(CHECK, import.meta.url);
