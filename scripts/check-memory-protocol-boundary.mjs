#!/usr/bin/env node
/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { readdir } from "node:fs/promises";
import path from "node:path";
import { WORKSPACE_ASSET_SECTIONS, WORKSPACE_SECTIONS } from "../workspace-protocol/src/index.js";
import { PROTOCOL_LEAF_IMPORT_PREFIXES } from "./lib/protocol-leaf-imports.mjs";
import {
  addHit,
  defineCheck,
  emptyRuleMeasurements,
  runCheckWhenMain,
} from "./quality/check-protocol.mjs";
import {
  escapesDirectory,
  importReferences,
  readRepositoryText,
  repositoryRoot,
} from "./quality/repository-files.mjs";
import { addRemovedPathHits } from "./quality/boundary-hits.mjs";
import { getFirstPartyFilesUnder } from "./quality/source-inventory.mjs";

const SCAN = Object.freeze({ repositoryRoot, extensions: [".js", ".mjs"], includeTests: true });
const ASSET_PACKAGE_DIR = "user-template/default-user";
const PURE_PACKAGE_IMPORTS = Object.freeze({
  "memory-protocol": [
    "@noobot/context-protocol/",
    "@noobot/session-protocol",
    ...PROTOCOL_LEAF_IMPORT_PREFIXES,
  ],
  "memory-repair": ["@noobot/memory-protocol/", ...PROTOCOL_LEAF_IMPORT_PREFIXES],
});
const REMOVED_PATHS = Object.freeze(
  [
    "utils/text.js",
    "parsers/id-patch-parser.js",
    "long-memory/protocol.js",
    "experience/schema-config.js",
    "experience/patch-utils.js",
    "experience/domain-summary-parser.js",
    "experience/metadata-store.js",
    "experience/model/text-protocol.js",
    "experience/abort-control.js",
    "experience/daily/parser.js",
    "experience/weekly/parser.js",
    "experience/monthly/parser.js",
    "experience/yearly/parser.js",
    "short-memory/reader.js",
    "short-memory/writer.js",
    "short-memory/compactor.js",
  ].map((file) => `agent/src/memory/${file}`),
);
const AGENT_DUPLICATES = Object.freeze([
  [/LONG_MEMORY_METADATA/, "long memory metadata store"],
  [/NOOBOT_(?:LONG_MEMORY|EXPERIENCE)[A-Z_]*\/\d/, "memory document header literal"],
  [/【经验教训字段模型】|# experience metadata \(text protocol\)/, "legacy memory title literal"],
  [/function\s+ensureExperienceModelIfMissing\s*\(/, "read-time template fallback"],
  [/function\s+parseIdPatchCommands\s*\(/, "experience id patch parser"],
]);

async function measure() {
  const measured = emptyRuleMeasurements(CHECK);
  for (const [packageDir, allowed] of Object.entries(PURE_PACKAGE_IMPORTS)) {
    for (const file of await getFirstPartyFilesUnder([`${packageDir}/src`], SCAN)) {
      for (const { specifier, line } of importReferences(await readRepositoryText(file))) {
        const foreign =
          !specifier.startsWith(".") && !allowed.some((prefix) => specifier.startsWith(prefix));
        if (foreign || escapesDirectory(file, packageDir, specifier)) {
          addHit(measured.purePackageImport, { file, line, message: `imports ${specifier}` });
        }
      }
    }
  }
  await addRemovedPathHits(measured.removedImplementation, REMOVED_PATHS, "must remain removed");
  for (const file of await getFirstPartyFilesUnder(["agent/src"], SCAN)) {
    const source = await readRepositoryText(file);
    for (const [pattern, label] of AGENT_DUPLICATES) {
      if (pattern.test(source)) addHit(measured.agentDuplicate, { file, message: label });
    }
  }
  const assetRoots = new Set(
    WORKSPACE_ASSET_SECTIONS.flatMap((section) => WORKSPACE_SECTIONS[section].paths),
  );
  for (const name of await readdir(path.join(repositoryRoot, ASSET_PACKAGE_DIR))) {
    if (!assetRoots.has(name)) {
      addHit(measured.assetPackageSection, {
        file: `${ASSET_PACKAGE_DIR}/${name}`,
        message: "not a workspace asset section",
      });
    }
  }
  return measured;
}

export const CHECK = defineCheck({
  id: "memory-protocol-boundary",
  description: "Memory document protocol lives in memory-protocol and stays pure",
  rules: {
    purePackageImport: {
      description: "memory-protocol and memory-repair import only their protocol dependencies",
      hint: "move runtime concerns to agent and import only protocol leaf packages",
    },
    removedImplementation: {
      description: "Agent memory protocol copies stay deleted",
      hint: "delete the file and import from @noobot/memory-protocol",
    },
    agentDuplicate: {
      description: "Agent does not redefine memory protocol literals or parsers",
      hint: "import the definition from @noobot/memory-protocol",
    },
    assetPackageSection: {
      description: "The default user asset package only carries workspace asset sections",
      hint: "add the section to workspace-protocol or remove the entry",
    },
  },
  exemptions: [],
  baseline: {
    purePackageImport: 0,
    removedImplementation: 0,
    agentDuplicate: 0,
    assetPackageSection: 0,
    exemptions: 0,
  },
  measure,
});

await runCheckWhenMain(CHECK, import.meta.url);
