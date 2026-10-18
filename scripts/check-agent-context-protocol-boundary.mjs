#!/usr/bin/env node
/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
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
import { addPatternOffsetHits, addRemovedPathHits } from "./quality/boundary-hits.mjs";
import { getFirstPartyFilesUnder } from "./quality/source-inventory.mjs";

const SCAN = Object.freeze({ extensions: [".js", ".mjs"], includeTests: true });
const PROTOCOL_ROOT = "context-protocol";
const RUNTIME_CONSUMER_ROOTS = Object.freeze([
  "agent/src",
  "plugin/noobot-plugin-harness/src",
  "plugin/noobot-plugin-workflow/src",
  "user-template",
]);
const AGENT_RUNTIME_PACKAGES = Object.freeze(["@noobot/agent", "noobot-agent"]);
const REMOVED_PATHS = Object.freeze([
  "agent/src/context/runtime-state/store.js",
  "agent/src/context/runtime-state/diagnostics.js",
  "agent/src/bot/session/context-builder.js",
  "agent/src/context/session/message-context.js",
  "agent/src/context/session/summarized-message.js",
  "agent/src/session/utils/context-window-normalizer.js",
  "agent/src/context/session/dialog-process-id-resolver.js",
  "agent/src/context/session/message-content-utils.js",
  "agent/src/context/session/message-converter.js",
  "agent/src/context/assembly/message-builder/message-utils.js",
  "agent/src/context/parent-session-id-resolver.js",
]);
const SOURCE_RULES = Object.freeze([
  ["legacyRuntimeRead", /execution\?*\.controllers\?*\.runtime/g, "execution.controllers.runtime"],
  ["legacyRuntimeRead", /agentContext\?*\.runtime/g, "agentContext.runtime"],
  ["legacyRuntimeRead", /runtimeAgentContext\?*\.payload/g, "runtimeAgentContext.payload"],
  ["legacyRuntimeRead", /payload\?*\.tools\?*\.registry/g, "payload.tools.registry"],
  ["duplicateProtocol", /function\s+resolveMessageRole\s*\(/g, "message role resolver"],
  ["duplicateProtocol", /function\s+resolveMessageToolCalls\s*\(/g, "message tool-call resolver"],
  [
    "duplicateProtocol",
    /function\s+resolveMessageToolCallId\s*\(/g,
    "message tool-call id resolver",
  ],
  [
    "duplicateProtocol",
    /function\s+resolveParentSessionId(?:WithMeta)?\s*\(/g,
    "parent session resolver",
  ],
  [
    "duplicateProtocol",
    /(?:if\s*\(|\|\||&&|=>|return)\s*!?[\w$?.]*\.(?:injectedMessage|pluginMessage)\s*===\s*true(?!\)\s*target\.)/g,
    "hand-written injected/plugin message check",
  ],
  [
    "duplicateProtocol",
    /readContextMessageField\([^)]*["'](?:injectedMessage|pluginMessage)["']\)/g,
    "injected/plugin flag read",
  ],
]);

const filesUnder = (directories) =>
  getFirstPartyFilesUnder(directories, { ...SCAN, repositoryRoot });

function importsAgentRuntime(file, specifier) {
  return (
    AGENT_RUNTIME_PACKAGES.some((prefix) => specifier.startsWith(prefix)) ||
    escapesDirectory(file, PROTOCOL_ROOT, specifier)
  );
}

async function measure() {
  const measured = emptyRuleMeasurements(CHECK);
  for (const file of await filesUnder([`${PROTOCOL_ROOT}/src`])) {
    for (const { specifier, line } of importReferences(await readRepositoryText(file))) {
      if (importsAgentRuntime(file, specifier)) {
        addHit(measured.protocolPurity, { file, line, message: `imports ${specifier}` });
      }
    }
  }
  await addRemovedPathHits(measured.removedAdapter, REMOVED_PATHS, "must remain removed");
  for (const file of await filesUnder(RUNTIME_CONSUMER_ROOTS)) {
    const source = await readRepositoryText(file);
    for (const [rule, pattern, message] of SOURCE_RULES) {
      addPatternOffsetHits({ measurement: measured[rule], file, source, pattern, message });
    }
  }
  return measured;
}

export const CHECK = defineCheck({
  id: "agent-context-protocol-boundary",
  description: "Context message semantics are owned by context-protocol and read through it",
  rules: {
    protocolPurity: {
      description: "context-protocol does not import the Agent runtime",
      hint: "move the dependency into the Agent and pass data into the protocol",
    },
    removedAdapter: {
      description: "Obsolete context boundary adapters stay deleted",
      hint: "delete the file and use @noobot/context-protocol",
    },
    legacyRuntimeRead: {
      description: "Runtime state is not read through legacy context carriers",
      hint: "read the value from the runtime port or the explicit execution context",
    },
    duplicateProtocol: {
      description:
        "Message role, tool-call, parent session and flag semantics come from the protocol",
      hint: "import the resolver or predicate from @noobot/context-protocol",
    },
  },
  exemptions: [],
  baseline: {
    protocolPurity: 0,
    removedAdapter: 0,
    legacyRuntimeRead: 0,
    duplicateProtocol: 0,
    exemptions: 0,
  },
  measure,
});

await runCheckWhenMain(CHECK, import.meta.url);
