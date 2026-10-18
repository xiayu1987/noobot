#!/usr/bin/env node
/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { defineCheck, emptyRuleMeasurements, runCheckWhenMain } from "./quality/check-protocol.mjs";
import { readRepositoryText, repositoryRoot } from "./quality/repository-files.mjs";
import {
  addPatternOffsetHits,
  addRemovedPathHits,
  addMissingMarkerHits,
  addMissingConsumerHits,
} from "./quality/boundary-hits.mjs";
import { getFirstPartyFilesUnder } from "./quality/source-inventory.mjs";

const PROTOCOL = "security-assessment-protocol/src/index.js";
const REMOVED_PATHS = Object.freeze(["event-protocol/src/tool-risk.js"]);
const PROTOCOL_MARKERS = Object.freeze([
  "SECURITY_ASSESSMENT_PROTOCOL_NAME",
  "SECURITY_RISK_LEVEL",
  "TOOL_BASELINE_PROFILES",
  "classifyToolExecutionRisk",
  "classifyResourceRisk",
  "createSecurityAssessment",
  "raiseSecurityAssessment",
  "shouldRequireSecurityConfirmation",
]);
const CONSUMERS = Object.freeze([
  ["agent/src/tools/execution/tool-risk.js", "createSecurityAssessment"],
  ["agent/src/tools/execution/file-read-tool.js", "classifyResourceRisk"],
  ["agent/src/tools/execution/file-write-tool.js", "classifyResourceRisk"],
  ["agent/src/tools/execution/file-search-tool.js", "classifyResourceRisk"],
  ["agent/src/tools/execution/file-patch-tool.js", "classifyResourceSetRisk"],
  ["agent/src/tools/execution/script-tool.js", "classifyToolExecutionRisk"],
  ["event-protocol/src/message-event.js", "validateSecurityAssessment"],
  ["client/noobot-chat/src/shared/ui/BaseThinkingLogLine.vue", "normalizeSecurityRiskLevel"],
]);
const PRODUCTION_ROOTS = Object.freeze([
  "agent-config-protocol/src",
  "agent-proxy/src",
  "agent-transport-protocol/src",
  "agent/src",
  "attachment-protocol/src",
  "authoritative-state/src",
  "client/mac/src",
  "client/noobot-chat/src",
  "client/shared/electron",
  "client/startup/src",
  "client/windows/src",
  "context-protocol/src",
  "event-protocol/src",
  "execution-isolation-protocol/src",
  "hook-protocol/src",
  "model-protocol/src",
  "model-proxy/src",
  "model-runtime/src",
  "path-resolver/src",
  "plugin-protocol/src",
  "plugin-runtime/src",
  "plugin/noobot-plugin-harness/src",
  "plugin/noobot-plugin-workflow/src",
  "runtime-events/src",
  "sanitize/src",
  "semantic-transfer-protocol/src",
  "service/bootstrap",
  "service/cli",
  "service/config",
  "service/deps",
  "service/routes",
  "service/runtime-events",
  "service/services",
  "service/ws",
  "session-protocol/src",
  "session-repair/src",
  "workflow/src",
]);
const DUPLICATE_CLASSIFICATION = Object.freeze([
  [
    /\b(?:const|let|var)\s+(?:RISK_ORDER|TOOL_BASELINE_PROFILES|CONFIRMATION_MINIMUM_RISK|CONFIRMATION_LEVELS)\b/g,
    "risk classification table",
  ],
  [
    /(?:new\s+Set\s*\()?\[\s*["']low["']\s*,\s*["']medium["']\s*,\s*["']high["']\s*,\s*["']critical["']\s*,?\s*\]/g,
    "risk level list",
  ],
  [/\bmaxSecurityRiskLevel\s*\(/g, "risk level maximum"],
]);

async function measure() {
  const measured = emptyRuleMeasurements(CHECK);
  await addRemovedPathHits(measured.removedProtocol, REMOVED_PATHS, "must remain removed");
  await addMissingMarkerHits(measured.protocolSurface, PROTOCOL, PROTOCOL_MARKERS);
  await addMissingConsumerHits(measured.protocolConsumer, CONSUMERS);
  const productionFiles = await getFirstPartyFilesUnder(PRODUCTION_ROOTS, {
    repositoryRoot,
    extensions: [".js", ".mjs", ".vue"],
    includeTests: false,
  });
  for (const file of productionFiles) {
    const source = await readRepositoryText(file);
    for (const [pattern, message] of DUPLICATE_CLASSIFICATION) {
      addPatternOffsetHits({
        measurement: measured.duplicateClassification,
        file,
        source,
        pattern,
        message,
      });
    }
  }
  return measured;
}

export const CHECK = defineCheck({
  id: "security-assessment-protocol-boundary",
  description: "Security risk levels and classification are owned by security-assessment-protocol",
  rules: {
    removedProtocol: {
      description: "Obsolete duplicate risk protocols stay deleted",
      hint: "delete the file and import from @noobot/security-assessment-protocol",
    },
    protocolSurface: {
      description: "The protocol exports risk levels, baseline profiles and classifiers",
      hint: "restore the export in security-assessment-protocol/src/index.js",
    },
    protocolConsumer: {
      description: "Risk consumers classify and validate through the protocol",
      hint: "import the listed classifier from @noobot/security-assessment-protocol",
    },
    duplicateClassification: {
      description: "Production code does not redefine risk levels, ordering or tables",
      hint: "use SECURITY_RISK_LEVEL and the protocol classifiers instead of a local copy",
    },
  },
  exemptions: [],
  baseline: {
    removedProtocol: 0,
    protocolSurface: 0,
    protocolConsumer: 0,
    duplicateClassification: 0,
    exemptions: 0,
  },
  measure,
});

await runCheckWhenMain(CHECK, import.meta.url);
