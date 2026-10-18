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
import { getFirstPartyFilesUnder } from "./quality/source-inventory.mjs";

const SCANNED_EXTENSIONS = Object.freeze([".js", ".mjs", ".cjs", ".ts", ".tsx"]);
const CONCRETE_PLUGIN_SPECIFIER = /(?:^|[/@])noobot-plugin-(?:harness|workflow)(?:\/|$)/i;
const AGENT_SOURCE_SPECIFIER = /(?:^|\/)agent\/src\//;

async function addImportHits(measurement, roots, specifierPattern) {
  const files = await getFirstPartyFilesUnder(roots, {
    repositoryRoot,
    extensions: SCANNED_EXTENSIONS,
    includeTests: true,
  });
  for (const file of files) {
    for (const { specifier, line } of importReferences(await readRepositoryText(file))) {
      if (specifierPattern.test(specifier)) addHit(measurement, { file, line, message: specifier });
    }
  }
}

async function measure() {
  const measured = emptyRuleMeasurements(CHECK);
  await addImportHits(
    measured.agentImportsConcretePlugin,
    ["agent/src"],
    CONCRETE_PLUGIN_SPECIFIER,
  );
  await addImportHits(measured.pluginImportsAgentSource, ["plugin"], AGENT_SOURCE_SPECIFIER);
  return measured;
}

export const CHECK = defineCheck({
  id: "agent-plugin-decoupling",
  description: "Agent core and concrete plugins meet only through the plugin protocol",
  rules: {
    agentImportsConcretePlugin: {
      description: "agent/src imports the harness or workflow plugin package directly",
      hint: "expose the capability through plugin-protocol hooks instead of importing the plugin",
    },
    pluginImportsAgentSource: {
      description: "A plugin reaches into agent/src internals",
      hint: "depend on a protocol package; agent/src is not a plugin API",
    },
  },
  exemptions: [],
  baseline: { agentImportsConcretePlugin: 0, pluginImportsAgentSource: 0, exemptions: 0 },
  measure,
});

await runCheckWhenMain(CHECK, import.meta.url);
