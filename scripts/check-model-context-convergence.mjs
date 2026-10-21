#!/usr/bin/env node
/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { defineCheck, emptyRuleMeasurements, runCheckWhenMain } from "./quality/check-protocol.mjs";
import { addContractHits } from "./quality/boundary-hits.mjs";
import { readRepositoryText, repositoryRoot } from "./quality/repository-files.mjs";
import { getFirstPartyFilesUnder } from "./quality/source-inventory.mjs";
import { AGENT_CONTRACTS } from "./quality/model-context-convergence/agent-contracts.mjs";
import { PROTOCOL_CONTRACTS } from "./quality/model-context-convergence/protocol-contracts.mjs";
import {
  addLegacyWindowHits,
  addSourcePolicyHits,
  SOURCE_POLICY_EXEMPTIONS,
  SOURCE_POLICY_RULES,
} from "./quality/model-context-convergence/source-policy-audit.mjs";

const CODE_EXTENSIONS = Object.freeze([".js", ".mjs", ".cjs", ".ts", ".tsx"]);
const SOURCE_ROOTS = Object.freeze([
  "context-protocol/src",
  "agent/src",
  "plugin/noobot-plugin-harness/src",
  "plugin/noobot-plugin-workflow/src",
]);
const LEGACY_WINDOW_ROOTS = Object.freeze([
  "agent/src",
  "plugin/noobot-plugin-harness/src",
  "shared",
]);

function productionFilesUnder(directories) {
  return getFirstPartyFilesUnder(directories, {
    repositoryRoot,
    extensions: CODE_EXTENSIONS,
    includeTests: false,
  });
}

async function measure(usage) {
  const measured = emptyRuleMeasurements(CHECK);
  for (const contract of [...PROTOCOL_CONTRACTS, ...AGENT_CONTRACTS]) {
    const source = await readRepositoryText(contract.file);
    addContractHits({ measured, file: contract.file, source, contract });
  }
  for (const file of await productionFilesUnder(SOURCE_ROOTS)) {
    addSourcePolicyHits({ usage, measured, file, source: await readRepositoryText(file) });
  }
  for (const file of await productionFilesUnder(LEGACY_WINDOW_ROOTS)) {
    addLegacyWindowHits({ measured, file, source: await readRepositoryText(file) });
  }
  return measured;
}

export const CHECK = defineCheck({
  id: "model-context-convergence",
  description: "Model messages are resolved centrally as system -> history -> incremental",
  rules: {
    missingMarker: {
      description: "Every owner file keeps its declared convergence contract",
      hint: "restore the owner implementation or update the contract in scripts/quality/model-context-convergence/",
    },
    forbiddenPattern: {
      description: "Owner files contain no removed compatibility or second-source path",
      hint: "delete the second path and delegate to the canonical context-protocol owner",
    },
    ...SOURCE_POLICY_RULES,
  },
  exemptions: SOURCE_POLICY_EXEMPTIONS,
  baseline: {
    missingMarker: 0,
    forbiddenPattern: 0,
    legacySourcePattern: 0,
    latestInjectedRetention: 0,
    summarizedWrite: 0,
    summaryMutationCall: 0,
    messageIdFallback: 0,
    legacyWindowMarker: 0,
    exemptions: 10,
  },
  measure,
});

await runCheckWhenMain(CHECK, import.meta.url);
