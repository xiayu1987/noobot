#!/usr/bin/env node
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
const guard = createGuardViolations({ root: ROOT, label: "agent-transport-protocol-boundary" });
const { violations } = guard;
const TARGET_DIRS = [
  "client/noobot-chat/src/modules/chat",
  "client/noobot-chat/src/infrastructure/websocket",
  "service/services",
  "service/ws",
  "agent-proxy/src",
  "agent/src",
];
const TRANSPORT_DIRS = TARGET_DIRS.filter((directory) => directory !== "agent/src");

const sourceFiles = createRelativeSourceCollector({
  root: ROOT,
  extensions: new Set([".js", ".mjs", ".vue"]),
});

const allFiles = [...new Set((await Promise.all(TARGET_DIRS.map(sourceFiles))).flat())];
const transportFiles = new Set((await Promise.all(TRANSPORT_DIRS.map(sourceFiles))).flat());
const commonForbidden = [
  [/\bpayload\?*\.config\b/, "payload.config compatibility read"],
  [/\brunConfig\?*\.config\b/, "runConfig.config compatibility read"],
  [/\bnormalizeRunConfig\s*\(/, "normalizeRunConfig compatibility adapter"],
];
const legacyAgentActions = /\baction\s*:\s*["'](?:stop|continue|interaction_response)["']/;

for (const file of allFiles) {
  const source = await readFile(path.join(ROOT, file), "utf8");
  const lines = source.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    for (const [pattern, label] of commonForbidden) {
      if (pattern.test(line)) violations.push(`${file}:${index + 1}: ${label}`);
    }
    if (transportFiles.has(file) && legacyAgentActions.test(line)) {
      violations.push(
        `${file}:${index + 1}: legacy Agent action; use @noobot/agent-transport-protocol`,
      );
    }
  }
}

guard.report();
