/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { readFile } from "node:fs/promises";
import path from "node:path";
import { createRelativeSourceCollector } from "./lib/guard-scan.mjs";
import { createGuardViolations } from "./lib/guard-violations.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const PROTOCOL_DIR = "memory-protocol";
const guard = createGuardViolations({ root: ROOT, label: "memory-protocol-boundary" });
const { violations } = guard;
const sourceFiles = createRelativeSourceCollector({
  root: ROOT,
  extensions: new Set([".js", ".mjs"]),
});

const ALLOWED_PACKAGE_IMPORTS = ["@noobot/context-protocol/"];

for (const file of await sourceFiles(`${PROTOCOL_DIR}/src`)) {
  const text = await readFile(path.join(ROOT, file), "utf8");
  const imports = Array.from(text.matchAll(/from\s+["']([^"']+)["']/g), (match) => match[1]);
  for (const specifier of imports) {
    const escapesPackage =
      specifier.startsWith(".") &&
      !path.resolve(ROOT, path.dirname(file), specifier).startsWith(path.join(ROOT, PROTOCOL_DIR));
    const isForeignPackage =
      !specifier.startsWith(".") &&
      !ALLOWED_PACKAGE_IMPORTS.some((prefix) => specifier.startsWith(prefix));
    if (escapesPackage || isForeignPackage) {
      violations.push(`${file}: memory-protocol must stay pure, forbidden import ${specifier}`);
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
  [/NOOBOT_LONG_MEMORY(?:_MODEL)?\/\d/, "long memory protocol header literal"],
  [/function\s+parseIdPatchCommands\s*\(/, "experience id patch parser"],
  [/messageItem\??\.injectedMessage\s*===/, "hand-written injected message check"],
];
for (const file of await sourceFiles("agent/src/memory")) {
  const text = await readFile(path.join(ROOT, file), "utf8");
  for (const [pattern, label] of forbiddenAgentDefinitions) {
    if (pattern.test(text)) violations.push(`${file}: forbidden duplicate ${label}`);
  }
}

guard.report();
