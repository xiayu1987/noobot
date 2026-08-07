/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { access, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const ROOT = path.resolve(import.meta.dirname, "..");
const violations = [];

async function sourceFiles(directory) {
  const entries = await readdir(path.join(ROOT, directory), { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const relative = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await sourceFiles(relative));
    else if (/\.(?:js|mjs)$/.test(entry.name)) files.push(relative);
  }
  return files;
}

async function assertAbsent(relative) {
  try {
    await access(path.join(ROOT, relative));
    violations.push(`${relative}: obsolete boundary adapter must be removed`);
  } catch {
    // Expected.
  }
}

for (const file of await sourceFiles("context-protocol/src")) {
  const text = await readFile(path.join(ROOT, file), "utf8");
  const imports = Array.from(text.matchAll(/from\s+["']([^"']+)["']/g), (match) => match[1]);
  for (const specifier of imports) {
    const importsAgentRuntime =
      specifier.startsWith("@noobot/agent") ||
      specifier.startsWith("noobot-agent") ||
      (specifier.startsWith(".") && !path.resolve(ROOT, path.dirname(file), specifier).startsWith(path.join(ROOT, "context-protocol")));
    if (importsAgentRuntime) {
      violations.push(`${file}: context-protocol must not import Agent runtime module ${specifier}`);
    }
  }
}

const runtimeConsumers = [
  ...await sourceFiles("agent/src"),
  ...await sourceFiles("plugin/noobot-plugin-harness/src"),
  ...await sourceFiles("plugin/noobot-plugin-workflow/src"),
  ...await sourceFiles("user-template"),
];
const forbiddenReads = [
  [/execution\?*\.controllers\?*\.runtime/, "execution.controllers.runtime"],
  [/agentContext\?*\.runtime/, "agentContext.runtime"],
  [/runtimeAgentContext\?*\.payload/, "runtimeAgentContext.payload"],
  [/payload\?*\.tools\?*\.registry/, "payload.tools.registry"],
];
for (const file of runtimeConsumers) {
  const text = await readFile(path.join(ROOT, file), "utf8");
  for (const [pattern, label] of forbiddenReads) {
    if (pattern.test(text)) violations.push(`${file}: forbidden legacy read ${label}`);
  }
}

await assertAbsent("agent/src/context/runtime-state/message-store.js");
await assertAbsent("agent/src/context/runtime-state/context-diagnostics.js");
await assertAbsent("agent/src/bot/session/context-builder.js");
await assertAbsent("agent/src/context/session/message-context-policy.js");
await assertAbsent("agent/src/context/session/summarized-message-policy.js");
await assertAbsent("agent/src/session/utils/context-window-normalizer.js");

const resolverText = await readFile(
  path.join(ROOT, "agent/src/context/session/dialog-process-id-resolver.js"),
  "utf8",
);
for (const legacyPath of ["currentDialogProcessId", "controllers", "upstream", "systemRuntime"]) {
  if (resolverText.includes(legacyPath)) {
    violations.push(`dialog-process-id-resolver.js: forbidden identity fallback ${legacyPath}`);
  }
}

if (violations.length) {
  console.error(violations.join("\n"));
  process.exitCode = 1;
} else {
  console.log("[agent-context-boundary] ok");
}
