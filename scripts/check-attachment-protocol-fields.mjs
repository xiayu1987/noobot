#!/usr/bin/env node
/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { defineCheck, emptyRuleMeasurements, runCheckWhenMain } from "./quality/check-protocol.mjs";
import { readRepositoryText, repositoryRoot } from "./quality/repository-files.mjs";
import { addPatternLineHits, addRemovedPathHits } from "./quality/boundary-hits.mjs";
import { getFirstPartyFilesUnder } from "./quality/source-inventory.mjs";

const PRODUCTION_ROOTS = Object.freeze([
  "agent/src",
  "client/noobot-chat/src",
  "semantic-transfer-protocol/src",
  "service",
  "shared",
  "plugin-protocol/src",
  "plugin-runtime/src",
  "plugin/noobot-plugin-harness/src",
  "plugin/noobot-plugin-workflow/src",
  "plugin/noobot-plugin-workflow/frontend",
]);
const CODE_EXTENSIONS = Object.freeze([".js", ".mjs", ".cjs", ".ts", ".tsx", ".vue"]);
const REMOVED_MODEL_ENTRIES = Object.freeze(["attachment-protocol/src/attachment-model.js"]);
const LEGACY_ATTACHMENT_FIELDS = Object.freeze([
  "attachment_id",
  "file_id",
  "client_attachment_id",
  "content_sha256",
  "attachment_source",
  "generation_source",
  "relative_path",
  "sandbox_path",
  "sandbox_view_path",
  "sandboxViewPath",
  "parsed_from_attachment_ids",
]);
const ATTACHMENT_SOURCE_LITERALS = Object.freeze([
  /\battachmentSource\b\s*:\s*(["'`])(?:model|user|subtask|email)\1/,
  /\battachmentSource\b[^\n]*?[=!]==?\s*(["'`])(?:model|user|subtask|email)\1/,
  /(["'`])(?:model|user|subtask|email)\1\s*[=!]==?\s*[^\n]*?\battachmentSource\b/,
]);

async function measure() {
  const measured = emptyRuleMeasurements(CHECK);
  await addRemovedPathHits(
    measured.duplicateAttachmentModel,
    REMOVED_MODEL_ENTRIES,
    "attachment model is owned by attachment-protocol/src/model.js",
  );
  const files = await getFirstPartyFilesUnder(PRODUCTION_ROOTS, {
    repositoryRoot,
    extensions: CODE_EXTENSIONS,
    includeTests: false,
  });
  for (const file of files) {
    const source = await readRepositoryText(file);
    for (const field of LEGACY_ATTACHMENT_FIELDS) {
      addPatternLineHits({
        measurement: measured.legacyAttachmentField,
        file,
        source,
        pattern: new RegExp(`\\b${field}\\b`),
        message: `legacy attachment field ${field}`,
      });
    }
    for (const pattern of ATTACHMENT_SOURCE_LITERALS) {
      addPatternLineHits({
        measurement: measured.attachmentSourceLiteral,
        file,
        source,
        pattern,
        message: "attachmentSource literal outside the attachment protocol",
      });
    }
  }
  return measured;
}

export const CHECK = defineCheck({
  id: "attachment-protocol-fields",
  description: "Attachment metadata uses only canonical attachment-protocol fields",
  rules: {
    duplicateAttachmentModel: {
      description: "The attachment model has one entry in attachment-protocol",
      hint: "import attachment-protocol/src/model.js instead of adding a second model entry",
    },
    legacyAttachmentField: {
      description: "Producers and consumers never use snake_case or removed attachment aliases",
      hint: "use the canonical camelCase attachment field from attachment-protocol",
    },
    attachmentSourceLiteral: {
      description: "attachmentSource values come from the attachment protocol constants",
      hint: "compare against the attachment-protocol source constants instead of string literals",
    },
  },
  exemptions: [],
  baseline: {
    duplicateAttachmentModel: 0,
    legacyAttachmentField: 0,
    attachmentSourceLiteral: 0,
    exemptions: 0,
  },
  measure,
});

await runCheckWhenMain(CHECK, import.meta.url);
