#!/usr/bin/env node
/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { defineCheck, emptyRuleMeasurements, runCheckWhenMain } from "./quality/check-protocol.mjs";
import { readRepositoryText, repositoryRoot } from "./quality/repository-files.mjs";
import { addPatternLineHits } from "./quality/boundary-hits.mjs";
import { getFirstPartyFilesUnder } from "./quality/source-inventory.mjs";

const SCAN = Object.freeze({ extensions: [".js", ".mjs", ".vue"], includeTests: true });
const TRANSPORT_ROOTS = Object.freeze([
  "client/noobot-chat/src/modules/chat",
  "client/noobot-chat/src/infrastructure/websocket",
  "service/services",
  "service/ws",
  "agent-proxy/src",
]);
const RUNTIME_ROOTS = Object.freeze([...TRANSPORT_ROOTS, "agent/src"]);
const RUN_CONFIG_COMPATIBILITY = Object.freeze([
  [/\bpayload\?*\.config\b/, "payload.config compatibility read"],
  [/\brunConfig\?*\.config\b/, "runConfig.config compatibility read"],
  [/\bnormalizeRunConfig\s*\(/, "normalizeRunConfig compatibility adapter"],
]);
const LEGACY_AGENT_ACTION = /\baction\s*:\s*["'](?:stop|continue|interaction_response)["']/;

const filesUnder = (directories) =>
  getFirstPartyFilesUnder(directories, { ...SCAN, repositoryRoot });

async function measure() {
  const measured = emptyRuleMeasurements(CHECK);
  const transportFiles = new Set(await filesUnder(TRANSPORT_ROOTS));
  for (const file of await filesUnder(RUNTIME_ROOTS)) {
    const source = await readRepositoryText(file);
    for (const [pattern, message] of RUN_CONFIG_COMPATIBILITY) {
      addPatternLineHits({
        measurement: measured.runConfigCompatibility,
        file,
        source,
        pattern,
        message,
      });
    }
    if (!transportFiles.has(file)) continue;
    addPatternLineHits({
      measurement: measured.legacyAgentAction,
      file,
      source,
      pattern: LEGACY_AGENT_ACTION,
      message: "legacy Agent action literal",
    });
  }
  return measured;
}

export const CHECK = defineCheck({
  id: "agent-transport-protocol-boundary",
  description: "Run configuration and Agent actions travel through agent-transport-protocol",
  rules: {
    runConfigCompatibility: {
      description: "Nested run configuration compatibility reads and adapters stay removed",
      hint: "read run preferences from the transport protocol message, not payload.config",
    },
    legacyAgentAction: {
      description: "Transport layers send Agent actions through the protocol constants",
      hint: "use the action constants from @noobot/agent-transport-protocol",
    },
  },
  exemptions: [],
  baseline: { runConfigCompatibility: 0, legacyAgentAction: 0, exemptions: 0 },
  measure,
});

await runCheckWhenMain(CHECK, import.meta.url);
