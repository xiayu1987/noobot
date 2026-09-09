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
const guard = createGuardViolations({ root: ROOT, label: "agent-context-boundary" });
const { violations } = guard;
const sourceFiles = createRelativeSourceCollector({
  root: ROOT,
  extensions: new Set([".js", ".mjs"]),
});

const assertAbsent = (relativePath) =>
  guard.assertAbsent(relativePath, "obsolete boundary adapter must be removed");

for (const file of await sourceFiles("context-protocol/src")) {
  const text = await readFile(path.join(ROOT, file), "utf8");
  const imports = Array.from(text.matchAll(/from\s+["']([^"']+)["']/g), (match) => match[1]);
  for (const specifier of imports) {
    const importsAgentRuntime =
      specifier.startsWith("@noobot/agent") ||
      specifier.startsWith("noobot-agent") ||
      (specifier.startsWith(".") &&
        !path
          .resolve(ROOT, path.dirname(file), specifier)
          .startsWith(path.join(ROOT, "context-protocol")));
    if (importsAgentRuntime) {
      violations.push(
        `${file}: context-protocol must not import Agent runtime module ${specifier}`,
      );
    }
  }
}

const runtimeConsumers = [
  ...(await sourceFiles("agent/src")),
  ...(await sourceFiles("plugin/noobot-plugin-harness/src")),
  ...(await sourceFiles("plugin/noobot-plugin-workflow/src")),
  ...(await sourceFiles("user-template")),
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

await assertAbsent("agent/src/context/runtime-state/store.js");
await assertAbsent("agent/src/context/runtime-state/diagnostics.js");
await assertAbsent("agent/src/bot/session/context-builder.js");
await assertAbsent("agent/src/context/session/message-context.js");
await assertAbsent("agent/src/context/session/summarized-message.js");
await assertAbsent("agent/src/session/utils/context-window-normalizer.js");
await assertAbsent("agent/src/context/session/dialog-process-id-resolver.js");
await assertAbsent("agent/src/context/session/message-content-utils.js");
await assertAbsent("agent/src/context/session/message-converter.js");
await assertAbsent("agent/src/context/assembly/message-builder/message-utils.js");
await assertAbsent("agent/src/context/parent-session-id-resolver.js");

const forbiddenAgentProtocolDefinitions = [
  [/function\s+resolveMessageRole\s*\(/, "message role resolver"],
  [/function\s+resolveMessageToolCalls\s*\(/, "message tool-call resolver"],
  [/function\s+resolveMessageToolCallId\s*\(/, "message tool-call id resolver"],
  [/function\s+resolveParentSessionId(?:WithMeta)?\s*\(/, "parent session resolver"],
];
for (const file of await sourceFiles("agent/src")) {
  const text = await readFile(path.join(ROOT, file), "utf8");
  for (const [pattern, label] of forbiddenAgentProtocolDefinitions) {
    if (pattern.test(text)) violations.push(`${file}: forbidden duplicate ${label}`);
  }
}

guard.report();
