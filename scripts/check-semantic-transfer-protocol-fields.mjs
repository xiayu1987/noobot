#!/usr/bin/env node
/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  defineCheck,
  emptyRuleMeasurements,
  EXEMPTION_KINDS,
  exemptsPath,
  runCheckWhenMain,
} from "./quality/check-protocol.mjs";
import { readRepositoryText, repositoryRoot } from "./quality/repository-files.mjs";
import { addPatternLineHits } from "./quality/boundary-hits.mjs";
import { getFirstPartyFilesUnder } from "./quality/source-inventory.mjs";

const PRODUCTION_ROOTS = Object.freeze([
  "agent/src",
  "semantic-transfer-protocol/src",
  "service",
  "agent-proxy",
  "client/noobot-chat/src",
  "plugin/noobot-plugin-harness/src",
  "plugin/noobot-plugin-workflow/src",
  "plugin/noobot-plugin-workflow/frontend",
]);
const CODE_EXTENSIONS = Object.freeze([".js", ".mjs", ".cjs", ".ts", ".tsx", ".vue"]);
const RULE_FIELDS = Object.freeze({
  legacyTransferField: [
    "transferResult",
    "nodeResultTransferResult",
    "allowCustom",
    "defaultGenerationSource",
  ],
  legacyAttachmentMetas: [
    "attachmentMetas",
    "inputAttachmentMetas",
    "attachment_metas",
    "AttachmentMetas",
  ],
});

async function measure() {
  const measured = emptyRuleMeasurements(CHECK);
  const files = await getFirstPartyFilesUnder(PRODUCTION_ROOTS, {
    repositoryRoot,
    extensions: CODE_EXTENSIONS,
    includeTests: false,
  });
  for (const file of files) {
    const source = await readRepositoryText(file);
    for (const [rule, fields] of Object.entries(RULE_FIELDS)) {
      if (exemptsPath(CHECK, rule, file)) continue;
      for (const field of fields) {
        const pattern = new RegExp(`\\b${field}\\b`);
        const message = `legacy field ${field}`;
        addPatternLineHits({ measurement: measured[rule], file, source, pattern, message });
      }
    }
  }
  return measured;
}

export const CHECK = defineCheck({
  id: "semantic-transfer-protocol-fields",
  description: "Semantic transfer payloads use transferEnvelopes and canonical attachment fields",
  rules: {
    legacyTransferField: {
      description: "Source chains never carry removed semantic-transfer result fields",
      hint: "carry results through transferEnvelopes only",
    },
    legacyAttachmentMetas: {
      description: "attachmentMetas aliases exist only at the artifact adapter boundary",
      hint: "pass canonical attachments; convert attachmentMetas only inside agent/src/artifacts",
    },
  },
  exemptions: [
    {
      id: "artifact-adapter-boundary",
      kind: EXEMPTION_KINDS.PATH_PREFIX,
      rules: ["legacyAttachmentMetas"],
      reason: "artifact adapters translate the external attachmentMetas wire shape",
      match: ["agent/src/artifacts/"],
    },
  ],
  baseline: { legacyTransferField: 0, legacyAttachmentMetas: 0, exemptions: 1 },
  measure,
});

await runCheckWhenMain(CHECK, import.meta.url);
