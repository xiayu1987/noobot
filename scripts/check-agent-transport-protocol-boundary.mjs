#!/usr/bin/env node
/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const ROOT = path.resolve(import.meta.dirname, "..");
const TARGET_DIRS = [
  "client/noobot-chat/src/modules/chat",
  "client/noobot-chat/src/infrastructure/websocket",
  "service/services",
  "service/ws",
  "agent-proxy/src",
  "agent/src",
];
const TRANSPORT_DIRS = TARGET_DIRS.filter((directory) => directory !== "agent/src");

async function sourceFiles(relativeDirectory) {
  const absoluteDirectory = path.join(ROOT, relativeDirectory);
  const entries = await readdir(absoluteDirectory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const relative = path.join(relativeDirectory, entry.name);
    if (entry.isDirectory()) files.push(...await sourceFiles(relative));
    else if (/\.(?:js|mjs|vue)$/.test(entry.name)) files.push(relative);
  }
  return files;
}

const allFiles = [...new Set((await Promise.all(TARGET_DIRS.map(sourceFiles))).flat())];
const transportFiles = new Set((await Promise.all(TRANSPORT_DIRS.map(sourceFiles))).flat());
const violations = [];
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
      violations.push(`${file}:${index + 1}: legacy Agent action; use @noobot/agent-transport-protocol`);
    }
  }
}

if (violations.length) {
  console.error("[agent-transport-protocol-boundary] failed");
  console.error(violations.join("\n"));
  process.exitCode = 1;
} else {
  console.log("[agent-transport-protocol-boundary] ok");
}
