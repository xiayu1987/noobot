#!/usr/bin/env node
/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { defineCheck, emptyRuleMeasurements, runCheckWhenMain } from "./quality/check-protocol.mjs";
import { readRepositoryText, repositoryRoot } from "./quality/repository-files.mjs";
import { addPatternLineHits } from "./quality/boundary-hits.mjs";
import { getFirstPartyFilesUnder } from "./quality/source-inventory.mjs";

const SCANNED_ROOTS = Object.freeze(["agent", "service", "agent-proxy", "client", "plugin"]);
const CODE_EXTENSIONS = Object.freeze([".js", ".mjs", ".cjs", ".ts", ".tsx"]);
const LEGACY_KEYS = Object.freeze([
  "run_timeout_ms",
  "wait_timeout_ms",
  "script_timeout_ms",
  "docker_lock_wait_timeout_ms",
  "start_timeout_ms",
  "idle_timeout_ms",
  "cleanup_interval_ms",
  "shutdown_grace_ms",
  "poll_interval_ms",
  "summarize_timeout_ms",
  "execution_bundle_timeout_ms",
  "timeout_ms",
]);

function legacyKeyPattern(key) {
  return new RegExp(`\\.${key}\\b|\\b[A-Za-z_$][\\w$]*\\s*\\[\\s*["']${key}["']\\s*\\]`);
}

async function measure() {
  const measured = emptyRuleMeasurements(CHECK);
  const files = await getFirstPartyFilesUnder(SCANNED_ROOTS, {
    repositoryRoot,
    extensions: CODE_EXTENSIONS,
    includeTests: false,
  });
  for (const file of files) {
    const source = await readRepositoryText(file);
    for (const key of LEGACY_KEYS) {
      addPatternLineHits({
        measurement: measured.legacyTimeKeyRead,
        file,
        source,
        pattern: legacyKeyPattern(key),
        message: `legacy time key ${key}`,
      });
    }
  }
  return measured;
}

export const CHECK = defineCheck({
  id: "legacy-time-keys",
  description: "Time settings are read only through their canonical *Ms keys",
  rules: {
    legacyTimeKeyRead: {
      description: "Sources never read removed snake_case *_ms time keys",
      hint: "read the canonical camelCase *Ms key from the config protocol",
    },
  },
  exemptions: [],
  baseline: { legacyTimeKeyRead: 0, exemptions: 0 },
  measure,
});

await runCheckWhenMain(CHECK, import.meta.url);
