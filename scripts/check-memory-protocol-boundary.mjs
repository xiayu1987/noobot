/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { WORKSPACE_ASSET_SECTIONS, WORKSPACE_SECTIONS } from "../workspace-protocol/src/index.js";
import { createRelativeSourceCollector } from "./lib/guard-scan.mjs";
import { createGuardViolations } from "./lib/guard-violations.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const PROTOCOL_DIR = "memory-protocol";
const REPAIR_DIR = "memory-repair";
const guard = createGuardViolations({ root: ROOT, label: "memory-protocol-boundary" });
const { violations } = guard;
const sourceFiles = createRelativeSourceCollector({
  root: ROOT,
  extensions: new Set([".js", ".mjs"]),
});

const PACKAGE_IMPORT_ALLOWLIST = Object.freeze({
  [PROTOCOL_DIR]: ["@noobot/context-protocol/"],
  [REPAIR_DIR]: ["@noobot/memory-protocol/"],
});

for (const [packageDir, allowedImports] of Object.entries(PACKAGE_IMPORT_ALLOWLIST)) {
  for (const file of await sourceFiles(`${packageDir}/src`)) {
    const text = await readFile(path.join(ROOT, file), "utf8");
    const imports = Array.from(text.matchAll(/from\s+["']([^"']+)["']/g), (match) => match[1]);
    for (const specifier of imports) {
      const escapesPackage =
        specifier.startsWith(".") &&
        !path.resolve(ROOT, path.dirname(file), specifier).startsWith(path.join(ROOT, packageDir));
      const isForeignPackage =
        !specifier.startsWith(".") &&
        !allowedImports.some((prefix) => specifier.startsWith(prefix));
      if (escapesPackage || isForeignPackage) {
        violations.push(`${file}: ${packageDir} must stay pure, forbidden import ${specifier}`);
      }
    }
  }
}

const assertAbsent = (relativePath) =>
  guard.assertAbsent(relativePath, "memory protocol logic moved to @noobot/memory-protocol");

for (const relativePath of [
  "agent/src/memory/utils/text.js",
  "agent/src/memory/parsers/id-patch-parser.js",
  "agent/src/memory/long-memory/protocol.js",
  "agent/src/memory/experience/schema-config.js",
  "agent/src/memory/experience/patch-utils.js",
  "agent/src/memory/experience/domain-summary-parser.js",
  "agent/src/memory/experience/metadata-store.js",
  "agent/src/memory/experience/model/text-protocol.js",
  "agent/src/memory/experience/abort-control.js",
  "agent/src/memory/experience/daily/parser.js",
  "agent/src/memory/experience/weekly/parser.js",
  "agent/src/memory/experience/monthly/parser.js",
  "agent/src/memory/experience/yearly/parser.js",
  "agent/src/memory/short-memory/reader.js",
  "agent/src/memory/short-memory/writer.js",
  "agent/src/memory/short-memory/compactor.js",
]) {
  await assertAbsent(relativePath);
}

const forbiddenAgentDefinitions = [
  [/LONG_MEMORY_METADATA/, "long memory metadata store"],
  [/NOOBOT_(?:LONG_MEMORY|EXPERIENCE)[A-Z_]*\/\d/, "memory document header literal"],
  [/【经验教训字段模型】|# experience metadata \(text protocol\)/, "legacy memory title literal"],
  [/function\s+ensureExperienceModelIfMissing\s*\(/, "read-time template fallback"],
  [/function\s+parseIdPatchCommands\s*\(/, "experience id patch parser"],
];
for (const file of await sourceFiles("agent/src")) {
  const text = await readFile(path.join(ROOT, file), "utf8");
  for (const [pattern, label] of forbiddenAgentDefinitions) {
    if (pattern.test(text)) violations.push(`${file}: forbidden duplicate ${label}`);
  }
}

const ASSET_PACKAGE_DIR = "user-template/default-user";
const allowedAssetRoots = new Set(
  WORKSPACE_ASSET_SECTIONS.flatMap((section) => WORKSPACE_SECTIONS[section].paths),
);
for (const name of await readdir(path.join(ROOT, ASSET_PACKAGE_DIR))) {
  if (!allowedAssetRoots.has(name)) {
    violations.push(
      `${ASSET_PACKAGE_DIR}/${name}: asset package only carries workspace asset sections`,
    );
  }
}

guard.report();
