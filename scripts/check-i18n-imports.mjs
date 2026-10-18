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
import { addExemptablePatternOffsetHits } from "./quality/boundary-hits.mjs";
import { readRepositoryText, repositoryRoot } from "./quality/repository-files.mjs";
import { getFirstPartyCodeFiles } from "./quality/source-inventory.mjs";

export const DIRECT_I18N_IMPORT = /(?:from\s*|import\s*\(\s*)["']noobot-i18n(?:\/[^"']*)?["']/g;

export async function measureI18nImports(files, usage) {
  const measured = emptyRuleMeasurements(CHECK);
  for (const file of files) {
    addExemptablePatternOffsetHits({
      usage,
      rule: "directI18nImport",
      measurement: measured.directI18nImport,
      file,
      source: await readRepositoryText(file),
      pattern: DIRECT_I18N_IMPORT,
      message: "direct noobot-i18n import",
    });
  }
  return measured;
}

export const CHECK = defineCheck({
  id: "i18n-imports",
  description: "noobot-i18n is imported only by its declared locale entry points",
  rules: {
    directI18nImport: {
      description: "Module imports noobot-i18n outside a declared locale entry point",
      hint: "take localized text from the owning entry point instead of importing noobot-i18n",
    },
  },
  exemptions: [
    {
      id: "agent-locale-consumers",
      kind: EXEMPTION_KINDS.PATH_PREFIX,
      rules: ["directI18nImport"],
      reason: "agent runtime renders its own backend messages and prompts",
      match: ["agent/src/"],
    },
    {
      id: "agent-proxy-locale-consumers",
      kind: EXEMPTION_KINDS.PATH_PREFIX,
      rules: ["directI18nImport"],
      reason: "agent-proxy renders its own channel and HTTP messages",
      match: ["agent-proxy/src/"],
    },
    {
      id: "chat-client-locale-consumers",
      kind: EXEMPTION_KINDS.PATH_PREFIX,
      rules: ["directI18nImport"],
      reason: "chat client owns its UI message catalog",
      match: ["client/noobot-chat/src/"],
    },
    {
      id: "electron-window-messages",
      kind: EXEMPTION_KINDS.PATH_PREFIX,
      rules: ["directI18nImport"],
      reason: "desktop shell window renders its desktop.* messages outside the chat client",
      match: ["client/shared/electron/runtime/window.js"],
    },
    {
      id: "model-runtime-capability-messages",
      kind: EXEMPTION_KINDS.PATH_PREFIX,
      rules: ["directI18nImport"],
      reason: "model runtime renders its modelRuntime.* backend messages",
      match: ["model-runtime/src/adapters/openai-capability-adapter.js"],
    },
    {
      id: "service-dependency-root",
      kind: EXEMPTION_KINDS.PATH_PREFIX,
      rules: ["directI18nImport"],
      reason: "service composition root injects locale text into service dependencies",
      match: ["service/bootstrap/create-app-dependencies.js"],
    },
  ],
  baseline: { directI18nImport: 0, exemptions: 6 },
  measure: async (usage) =>
    measureI18nImports(
      await getFirstPartyCodeFiles({
        repositoryRoot,
        extensions: [".js", ".mjs", ".cjs", ".jsx", ".ts", ".tsx", ".vue"],
        includeTests: true,
      }),
      usage,
    ),
});

await runCheckWhenMain(CHECK, import.meta.url);
