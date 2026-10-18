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
  importReferences,
  readRepositoryText,
  repositoryRoot,
} from "./quality/repository-files.mjs";
import { addPatternLineHits, addRemovedPathHits } from "./quality/boundary-hits.mjs";
import { getFirstPartyFilesUnder } from "./quality/source-inventory.mjs";

const SCAN = Object.freeze({ extensions: [".js", ".mjs"], includeTests: true });
const PROTOCOL_ROOT = "agent-config-protocol/src";
const REMOVED_PATHS = Object.freeze([
  ...[
    "protocol.js",
    "run-config-resolver.js",
    "key-normalizer.js",
    "time-config-normalizer.js",
    "config-file-migration.js",
    "config-merge.js",
    "builtin-scenarios.js",
    "tool-policy.js",
    "user-override-policy.js",
  ].map((fileName) => `${PROTOCOL_ROOT}/${fileName}`),
  "agent/src/config/core/builtin-scenarios.js",
  "agent/src/config/core/config-merge.js",
  "agent/src/config/core/key-normalizer.js",
  "agent/src/config/core/time-config-normalizer.js",
  "agent/src/config/core/user-override-policy.js",
  "agent/src/config/core/template-resolver.js",
  "agent/src/bot/config/run-config-resolver.js",
  "agent/src/bot/config/tool-policy-manager.js",
  "agent/src/bot/session/plugin-policy-api.js",
]);
const CONSUMER_ROOTS = Object.freeze([
  "agent/src",
  "agent/scripts",
  "service/services",
  "service/scripts/project-launcher",
  "client/shared/electron/runtime",
]);
const FORBIDDEN_PROTOCOL_IMPORTS = Object.freeze({
  exact: ["node:fs", "node:path", "@noobot/model-runtime", "@noobot/plugin-runtime"],
  prefixes: ["noobot-agent", "../agent", "node:fs/"],
  fragments: ["agent/src"],
});
const LEGACY_TOOL_POLICY = /\btools\.(?:allowed|denied)\b/;
const PROTOCOL_LINE_RULES = Object.freeze([
  ["legacyToolPolicy", LEGACY_TOOL_POLICY, "legacy tools.allowed/denied field"],
  ["protocolPurity", /const\s+tSystem\s*=/, "protocol localization fallback"],
]);
const CONSUMER_LINE_RULES = Object.freeze([
  [
    "legacyToolPolicy",
    /\b(?:ToolPolicyManager|applyRunConfigToolPolicy|_applyRunConfigToolPolicy)\b/,
    "parallel tool-policy entry",
  ],
  ["legacyToolPolicy", LEGACY_TOOL_POLICY, "legacy tools.allowed/denied field"],
  [
    "duplicateConfigGrammar",
    /function\s+normalizeConfigParamKey\b|const\s+normalizeConfigParamKey\b/,
    "local config param key normalization",
  ],
  [
    "configParamsSource",
    /\b(?:globalConfig|rawGlobalConfig)\??\.configParams\b/,
    "configParams read from global configuration",
  ],
]);

const filesUnder = (directories) =>
  getFirstPartyFilesUnder(directories, { ...SCAN, repositoryRoot });

function isForbiddenProtocolImport(specifier) {
  return (
    FORBIDDEN_PROTOCOL_IMPORTS.exact.includes(specifier) ||
    FORBIDDEN_PROTOCOL_IMPORTS.prefixes.some((prefix) => specifier.startsWith(prefix)) ||
    FORBIDDEN_PROTOCOL_IMPORTS.fragments.some((fragment) => specifier.includes(fragment))
  );
}

async function measure() {
  const measured = emptyRuleMeasurements(CHECK);
  await addRemovedPathHits(measured.removedImplementation, REMOVED_PATHS, "must remain removed");
  for (const file of await filesUnder([PROTOCOL_ROOT])) {
    const source = await readRepositoryText(file);
    for (const { specifier, line } of importReferences(source)) {
      if (isForbiddenProtocolImport(specifier)) {
        addHit(measured.protocolPurity, {
          file,
          line,
          message: `imports runtime module ${specifier}`,
        });
      }
    }
    for (const [rule, pattern, message] of PROTOCOL_LINE_RULES) {
      addPatternLineHits({ measurement: measured[rule], file, source, pattern, message });
    }
  }
  for (const file of await filesUnder(CONSUMER_ROOTS)) {
    const source = await readRepositoryText(file);
    for (const [rule, pattern, message] of CONSUMER_LINE_RULES) {
      addPatternLineHits({ measurement: measured[rule], file, source, pattern, message });
    }
    if (source.includes("[A-Z0-9_]+") && source.includes("${")) {
      addHit(measured.duplicateConfigGrammar, { file, message: "local config template grammar" });
    }
  }
  return measured;
}

export const CHECK = defineCheck({
  id: "agent-config-protocol-boundary",
  description:
    "Agent configuration grammar, tool policy and parameters are owned by agent-config-protocol",
  rules: {
    removedImplementation: {
      description: "Obsolete duplicate configuration implementations stay deleted",
      hint: "delete the file and use @noobot/agent-config-protocol",
    },
    protocolPurity: {
      description: "The configuration protocol does not import runtime, filesystem or localization",
      hint: "move runtime access to the Agent and pass resolved values into the protocol",
    },
    legacyToolPolicy: {
      description: "Tool policy uses the protocol policy fields and a single resolver",
      hint: "resolve tool policy through @noobot/agent-config-protocol",
    },
    duplicateConfigGrammar: {
      description: "Config param keys and template grammar are parsed only by the protocol",
      hint: "call the protocol key normalizer and template resolver",
    },
    configParamsSource: {
      description: "configParams come from the explicit resolution context",
      hint: "pass configParams through the resolution context instead of globalConfig",
    },
  },
  exemptions: [],
  baseline: {
    removedImplementation: 0,
    protocolPurity: 0,
    legacyToolPolicy: 0,
    duplicateConfigGrammar: 0,
    configParamsSource: 0,
    exemptions: 0,
  },
  measure,
});

await runCheckWhenMain(CHECK, import.meta.url);
