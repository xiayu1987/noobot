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
const PROTOCOL_DIR = "workspace-protocol";
const guard = createGuardViolations({ root: ROOT, label: "workspace-protocol-boundary" });
const { violations } = guard;
const sourceFiles = createRelativeSourceCollector({
  root: ROOT,
  extensions: new Set([".js", ".mjs"]),
});

for (const file of await sourceFiles(`${PROTOCOL_DIR}/src`)) {
  const text = await readFile(path.join(ROOT, file), "utf8");
  for (const [, specifier] of text.matchAll(/from\s+["']([^"']+)["']/g)) {
    if (!specifier.startsWith(".")) {
      violations.push(`${file}: workspace-protocol must stay dependency free, found ${specifier}`);
    }
  }
}

const WORKSPACE_RUNTIME_LITERAL =
  /["'`]runtime\/[A-Za-z0-9_-]+|["']runtime["']\s*,\s*["'][A-Za-z0-9_-]+["']/;
const SCANNED_SOURCE_ROOTS = Object.freeze([
  "agent/src",
  "service/services",
  "service/routes",
  "service/scripts",
  "execution-isolation-protocol/src",
  "memory-protocol/src",
  "memory-repair/src",
  "path-resolver/src",
  "plugin/noobot-plugin-workflow/src",
  "plugin/noobot-plugin-character/src",
  "plugin/noobot-plugin-harness/src",
]);
const WORKSPACE_RUNTIME_PATH_SEGMENTS = Object.freeze([
  /(?:join|resolve)\((?:[^()]|\([^()]*\))*?["'`]runtime["'`]/g,
  /\[\s*["'`]runtime["'`]\s*,/g,
]);
for (const root of SCANNED_SOURCE_ROOTS) {
  for (const file of await sourceFiles(root)) {
    const text = await readFile(path.join(ROOT, file), "utf8");
    const lines = text.split("\n");
    lines.forEach((line, index) => {
      if (WORKSPACE_RUNTIME_LITERAL.test(line)) {
        violations.push(
          `${file}:${index + 1}: workspace runtime paths must come from @noobot/workspace-protocol`,
        );
      }
    });
    for (const pattern of WORKSPACE_RUNTIME_PATH_SEGMENTS) {
      for (const match of text.matchAll(pattern)) {
        const line = text.slice(0, match.index).split("\n").length;
        violations.push(
          `${file}:${line}: workspace runtime path segments must come from @noobot/workspace-protocol`,
        );
      }
    }
  }
}

guard.report();
