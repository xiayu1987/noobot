#!/usr/bin/env node
/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  MESSAGE_REMOVED_FIELD,
  isCategorizedMessageIdentityName,
} from "../session-protocol/src/identity/message-identity-schema.js";
import {
  addHit,
  defineCheck,
  emptyRuleMeasurements,
  EXEMPTION_KINDS,
  runCheckWhenMain,
} from "./quality/check-protocol.mjs";
import { offsetLine, readRepositoryText, repositoryRoot } from "./quality/repository-files.mjs";
import { getFirstPartyFilesUnder } from "./quality/source-inventory.mjs";

const SOURCE_ROOTS = Object.freeze([
  "agent",
  "agent-proxy",
  "service",
  "client/noobot-chat",
  "plugin",
  "shared",
  "session-protocol",
  "session-repair",
  "context-protocol",
  "event-protocol",
  "memory-protocol",
  "semantic-transfer-protocol",
  "workspace-protocol",
]);
const CODE_EXTENSIONS = Object.freeze([".js", ".mjs", ".cjs", ".ts", ".tsx", ".vue"]);
const LEGACY_KEY_FIELDS = Object.freeze(Object.keys(MESSAGE_REMOVED_FIELD));
const FIELD_NAME = String.raw`[A-Za-z_$][\w$]*Message(?:Id|Uid)s?|message(?:Id|Uid)`;
const FIELD_POSITIONS = Object.freeze([
  new RegExp(String.raw`\??\.(${FIELD_NAME})\b(?!\s*\()`, "g"),
  new RegExp(String.raw`(?<![\w$.])(${FIELD_NAME})\s*:(?!:)`, "g"),
  new RegExp(String.raw`[{,]\s*(${FIELD_NAME})\s*(?=[,}=])`, "g"),
  new RegExp(String.raw`\[\s*["'](${FIELD_NAME})["']\s*\]`, "g"),
]);

function ruleFor(name) {
  if (LEGACY_KEY_FIELDS.includes(name)) return "legacyKeyField";
  return isCategorizedMessageIdentityName(name) ? null : "unregisteredField";
}

const MODULE_BINDING_STATEMENT =
  /^\s*(?:import|export)\s*(?:type\s+)?\{[^}]*\}\s*(?:from\s*["'][^"']+["'])?;?/gm;

function maskModuleBindings(source) {
  return source.replace(MODULE_BINDING_STATEMENT, (statement) => statement.replace(/[^\n]/g, " "));
}

function collectFieldHits(measured, file, rawSource) {
  const source = maskModuleBindings(rawSource);
  const seen = new Set();
  for (const pattern of FIELD_POSITIONS) {
    for (const match of source.matchAll(pattern)) {
      const name = match[1];
      const rule = ruleFor(name);
      const offset = match.index + match[0].indexOf(name);
      if (!rule || seen.has(offset)) continue;
      seen.add(offset);
      addHit(measured[rule], { file, line: offsetLine(source, offset), message: name });
    }
  }
}

async function measure(usage) {
  const measured = emptyRuleMeasurements(CHECK);
  const files = await getFirstPartyFilesUnder(SOURCE_ROOTS, {
    repositoryRoot,
    extensions: CODE_EXTENSIONS,
    includeTests: true,
  });
  for (const file of files) {
    if (usage.exempts("legacyKeyField", EXEMPTION_KINDS.PATH_PREFIX, file)) continue;
    collectFieldHits(measured, file, await readRepositoryText(file));
  }
  return measured;
}

export const CHECK = defineCheck({
  id: "message-identity-fields",
  description: "Message identity fields are registered in session-protocol message-identity-schema",
  rules: {
    legacyKeyField: {
      description: "Bare messageId and removed identity fields do not appear in field positions",
      hint: "use messageUid or the role-specific correlation field from MESSAGE_FIELD_SCHEMA",
    },
    unregisteredField: {
      description:
        "Every *MessageId(s) field ends with a registered correlation field; session references end with MessageUid(s)",
      hint: "rename session references to *MessageUid(s), or register the correlation field",
    },
  },
  exemptions: [
    {
      id: "message-identity-schema",
      kind: EXEMPTION_KINDS.PATH_PREFIX,
      rules: ["legacyKeyField"],
      reason: "the schema is the single place that names removed and renamed legacy fields",
      match: ["session-protocol/src/identity/message-identity-schema.js"],
    },
  ],
  baseline: { legacyKeyField: 751, unregisteredField: 131, exemptions: 1 },
  measure,
});

await runCheckWhenMain(CHECK, import.meta.url);
