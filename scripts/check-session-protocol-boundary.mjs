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
import { readRepositoryText, repositoryRoot } from "./quality/repository-files.mjs";
import { getFirstPartyFilesUnder } from "./quality/source-inventory.mjs";

const PRODUCTION_ROOTS = Object.freeze([
  "agent/src",
  "service",
  "client/noobot-chat/src",
  "authoritative-state/src",
  "context-protocol/src",
  "shared",
  "plugin/noobot-plugin-harness/src",
  "plugin/noobot-plugin-workflow/src",
  "plugin/noobot-plugin-character/src",
]);
const TURN_COMMIT_PROTOCOL = "session-protocol/src/turn-commit.js";
const TURN_SCOPE_PROTOCOL = "session-protocol/src/identity/turn-scope-identity.js";
const LEGACY_SESSION_FIELDS = Object.freeze([
  [/@noobot\/event-protocol\/turn-lifecycle/, "Turn lifecycle imported from event-protocol"],
  [/\bbackendSessionId\b/, "multiple Session identity field"],
  [/\bexpectedVersion\b/, "legacy Session concurrency field"],
  [/\bexpectedSessionVersion\b/, "legacy Session concurrency field"],
  [/\bidempotencyKey\b/, "second command idempotency field"],
  [/\bsessionVersion\b/, "legacy Session aggregate version field"],
  [/\bsnapshotVersion\b/, "legacy Session snapshot version field"],
  [/\bcommittedVersion\b/, "legacy committed Session version field"],
  [/\bsessionAliases\b/, "multiple Session identity registry"],
  [/\bsessionIdentityPending\b/, "deferred Session identity branch"],
  [/\baliasPromoted\b/, "Session identity promotion branch"],
  [/\binjected_message_type\b/, "legacy injected message type field"],
  [/(?:\?\.|\.)channel_state\b/, "legacy persisted channel state field"],
  [/version\s*\?\?\s*revision/, "Session version compatibility read"],
]);
const PROTOCOL_OWNERS = Object.freeze([
  [TURN_COMMIT_PROTOCOL, /\b(?:validate|assert)TurnCommittedEventData\b/, "turn_committed"],
  [
    TURN_SCOPE_PROTOCOL,
    /\b(?:function|const)\s+(?:canonicalizeTurnScopeId|turnScopeIdentityKey|areCanonicalTurnScopeIdsEqual)\b/,
    "Turn Scope identity",
  ],
]);

async function measure() {
  const measured = emptyRuleMeasurements(CHECK);
  const productionFiles = await getFirstPartyFilesUnder(PRODUCTION_ROOTS, {
    repositoryRoot,
    extensions: [".js", ".mjs", ".vue"],
    includeTests: false,
  });
  for (const file of productionFiles) {
    const source = await readRepositoryText(file);
    for (const [pattern, message] of LEGACY_SESSION_FIELDS) {
      if (pattern.test(source)) addHit(measured.legacySessionField, { file, message });
    }
  }
  const protocolFiles = await getFirstPartyFilesUnder(["session-protocol/src"], {
    repositoryRoot,
    extensions: [".js"],
    includeTests: true,
  });
  for (const file of protocolFiles) {
    const source = await readRepositoryText(file);
    for (const [owner, pattern, label] of PROTOCOL_OWNERS) {
      if (file !== owner && pattern.test(source)) {
        addHit(measured.duplicateProtocol, { file, message: `duplicate ${label} protocol` });
      }
    }
  }
  return measured;
}

export const CHECK = defineCheck({
  id: "session-protocol-boundary",
  description: "Session identity, version and Turn commit protocol have one definition",
  rules: {
    legacySessionField: {
      description: "Production code never reads removed Session identity or version fields",
      hint: "use the session-protocol identity and revision fields",
    },
    duplicateProtocol: {
      description: "Turn commit and Turn Scope identity are defined once in session-protocol",
      hint: "import the canonical definition instead of redefining it",
    },
  },
  exemptions: [],
  baseline: { legacySessionField: 0, duplicateProtocol: 0, exemptions: 0 },
  measure,
});

await runCheckWhenMain(CHECK, import.meta.url);
