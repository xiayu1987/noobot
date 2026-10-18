#!/usr/bin/env node
/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { isProtocolLeafImport } from "./lib/protocol-leaf-imports.mjs";
import {
  addHit,
  defineCheck,
  emptyRuleMeasurements,
  runCheckWhenMain,
} from "./quality/check-protocol.mjs";
import {
  importReferences,
  readRepositoryText,
  repositoryRoot,
} from "./quality/repository-files.mjs";
import { addPatternLineHits, addPatternOffsetHits } from "./quality/boundary-hits.mjs";
import { getFirstPartyFilesUnder } from "./quality/source-inventory.mjs";

const SCAN = Object.freeze({ repositoryRoot, extensions: [".js", ".mjs"], includeTests: true });
const RUNTIME_LITERAL = /["'`]runtime\/[A-Za-z0-9_-]+|["']runtime["']\s*,\s*["'][A-Za-z0-9_-]+["']/;
const RUNTIME_SEGMENTS = Object.freeze([
  /(?:join|resolve)\((?:[^()]|\([^()]*\))*?["'`]runtime["'`]/g,
  /\[\s*["'`]runtime["'`]\s*,/g,
]);
const CONSUMER_ROOTS = Object.freeze([
  "agent/src",
  "service/services",
  "service/routes",
  "service/scripts",
  "execution-isolation-protocol/src",
  "memory-protocol/src",
  "memory-repair/src",
  "path-resolver/src",
  "runtime-events/src",
  "plugin/noobot-plugin-workflow/src",
  "plugin/noobot-plugin-character/src",
  "plugin/noobot-plugin-harness/src",
]);

async function measure() {
  const measured = emptyRuleMeasurements(CHECK);
  for (const file of await getFirstPartyFilesUnder(["workspace-protocol/src"], SCAN)) {
    for (const { specifier, line } of importReferences(await readRepositoryText(file))) {
      if (!specifier.startsWith(".") && !isProtocolLeafImport(specifier)) {
        addHit(measured.purePackageImport, { file, line, message: `imports ${specifier}` });
      }
    }
  }
  for (const file of await getFirstPartyFilesUnder(CONSUMER_ROOTS, SCAN)) {
    const source = await readRepositoryText(file);
    addPatternLineHits({
      measurement: measured.runtimePath,
      file,
      source,
      pattern: RUNTIME_LITERAL,
      message: "runtime path literal",
    });
    for (const pattern of RUNTIME_SEGMENTS) {
      addPatternOffsetHits({
        measurement: measured.runtimePath,
        file,
        source,
        pattern,
        message: "runtime path segment",
      });
    }
  }
  return measured;
}

export const CHECK = defineCheck({
  id: "workspace-protocol-boundary",
  description: "Workspace runtime layout is owned by workspace-protocol",
  rules: {
    purePackageImport: {
      description: "workspace-protocol imports only protocol leaf packages",
      hint: "move the dependency out of workspace-protocol",
    },
    runtimePath: {
      description: "Consumers never spell workspace runtime paths by hand",
      hint: "resolve the path through @noobot/workspace-protocol",
    },
  },
  exemptions: [],
  baseline: { purePackageImport: 0, runtimePath: 0, exemptions: 0 },
  measure,
});

await runCheckWhenMain(CHECK, import.meta.url);
