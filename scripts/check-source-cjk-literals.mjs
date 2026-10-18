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
  runCheckWhenMain,
} from "./quality/check-protocol.mjs";
import { readRepositoryText, repositoryRoot } from "./quality/repository-files.mjs";
import { addExemptablePatternLineHits } from "./quality/boundary-hits.mjs";
import { getFirstPartyCodeFiles } from "./quality/source-inventory.mjs";

const CJK_PATTERN = /[\u4e00-\u9fff]/;
const SOURCE_EXTENSIONS = Object.freeze([".js", ".mjs", ".cjs", ".ts", ".tsx", ".vue"]);

function fileExemption(id, file, reason) {
  return { id, kind: EXEMPTION_KINDS.PATH_PREFIX, rules: ["cjkLiteral"], reason, match: [file] };
}

export function measureCjkLiterals(check, sources, usage) {
  const measured = emptyRuleMeasurements(check);
  for (const [file, source] of Object.entries(sources)) {
    addExemptablePatternLineHits({
      usage,
      rule: "cjkLiteral",
      measurement: measured.cjkLiteral,
      file,
      source,
      pattern: CJK_PATTERN,
      message: "CJK literal outside i18n catalogs",
    });
  }
  return measured;
}

async function measure(usage) {
  const files = await getFirstPartyCodeFiles({
    repositoryRoot,
    extensions: SOURCE_EXTENSIONS,
    includeTests: false,
  });
  const sources = {};
  for (const file of files) sources[file] = await readRepositoryText(file);
  return measureCjkLiterals(CHECK, sources, usage);
}

export const CHECK = defineCheck({
  id: "source-cjk-literals",
  description: "User-facing CJK text lives in i18n catalogs",
  rules: {
    cjkLiteral: {
      description: "Production sources never embed CJK literals outside exempted catalogs",
      hint: "move user-facing text into an i18n catalog",
    },
  },
  exemptions: [
    {
      id: "i18n-catalogs",
      kind: EXEMPTION_KINDS.PATH_PREFIX,
      rules: ["cjkLiteral"],
      reason: "i18n catalogs are the single home of localized text",
      match: [
        "i18n/",
        "client/startup/src/locales/",
        "plugin/noobot-plugin-character/frontend/i18n/",
        "plugin/noobot-plugin-harness/frontend/i18n/",
        "plugin/noobot-plugin-harness/src/i18n/",
        "plugin/noobot-plugin-workflow/frontend/i18n/",
        "plugin/noobot-plugin-workflow/src/core/i18n.js",
      ],
    },
    {
      id: "developer-scripts",
      kind: EXEMPTION_KINDS.PATH_PREFIX,
      rules: ["cjkLiteral"],
      reason: "developer scripts are not shipped and print operator-facing text",
      match: ["scripts/", "agent/scripts/", "service/scripts/"],
    },
    {
      id: "runnable-examples",
      kind: EXEMPTION_KINDS.PATH_PREFIX,
      rules: ["cjkLiteral"],
      reason: "workflow examples demonstrate localized task input",
      match: ["workflow/examples/"],
    },
    fileExemption(
      "web-boilerplate-cleaner",
      "agent/src/shared/utils/text-cleaner.js",
      "matches Chinese web page boilerplate",
    ),
    fileExemption(
      "web-boilerplate-cleaner-web",
      "agent/src/shared/utils/web/text-cleaner.js",
      "matches Chinese web page boilerplate",
    ),
    fileExemption(
      "secret-field-names",
      "agent/src/tools/collaboration/user-interaction-tool.js",
      "matches Chinese secret field names",
    ),
    fileExemption(
      "windows-registry-output",
      "client/shared/electron/dependencies/detect.js",
      "parses localized Windows registry output",
    ),
    fileExemption(
      "installer-output",
      "client/shared/electron/dependencies/installer.js",
      "parses localized installer output",
    ),
    fileExemption(
      "language-endonym",
      "client/startup/src/components/SuperAdminSetupForm.vue",
      "language endonym",
    ),
    fileExemption(
      "experience-field-model",
      "memory-protocol/src/experience/fields.js",
      "default user experience field model",
    ),
    fileExemption(
      "experience-document-labels",
      "memory-protocol/src/experience/schema.js",
      "persisted memory document labels",
    ),
    fileExemption(
      "long-memory-field-model",
      "memory-protocol/src/long-memory.js",
      "default long memory field model",
    ),
    fileExemption(
      "memory-document-migration",
      "memory-repair/src/document-migration.js",
      "legacy memory document title for migration",
    ),
    fileExemption(
      "bilingual-model-diagnostics",
      "model-runtime/src/diagnostics/model-access.js",
      "bilingual diagnostic errors",
    ),
    fileExemption("pii-field-names", "sanitize/src/index.js", "matches Chinese PII field names"),
    fileExemption(
      "cli-yes-no-replies",
      "service/cli/interaction-prompt.js",
      "accepts Chinese yes/no replies",
    ),
    fileExemption(
      "self-contained-service-template",
      "user-template/default-user/services/web-search-service-handler.js",
      "self-contained bilingual service template",
    ),
  ],
  baseline: { cjkLiteral: 0, exemptions: 25 },
  measure,
});

await runCheckWhenMain(CHECK, import.meta.url);
