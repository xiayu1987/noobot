/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import fs from "node:fs";
import path from "node:path";
import { createRelativeSourceCollector } from "./lib/guard-scan.mjs";
import { createGuardViolations } from "./lib/guard-violations.mjs";

const root = path.resolve(import.meta.dirname, "..");
const guard = createGuardViolations({ root, label: "session-protocol-boundary" });
const { violations } = guard;
const productionRoots = [
  "agent/src",
  "service",
  "client/noobot-chat/src",
  "authoritative-state/src",
];
const collectProductionSources = createRelativeSourceCollector({
  root,
  extensions: new Set([".js", ".mjs", ".vue"]),
  ignoredDirectories: new Set(["vendor", "dist", "node_modules", "__tests__", "tests"]),
});
const collectProtocolSources = createRelativeSourceCollector({
  root,
  extensions: new Set([".js"]),
});
const canonicalTurnCommitProtocol = "session-protocol/src/turn-commit.js";
const canonicalTurnScopeIdentityProtocol = "session-protocol/src/identity/turn-scope-identity.js";

function inspect(relative) {
  const source = fs.readFileSync(path.join(root, relative), "utf8");
  const checks = [
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
  ];
  for (const [pattern, message] of checks)
    if (pattern.test(source)) violations.push(`${relative}: ${message}`);
}

for (const relative of productionRoots) {
  for (const file of await collectProductionSources(relative)) inspect(file);
}

function inspectTurnCommitProtocolDefinitions(relative) {
  const source = fs.readFileSync(path.join(root, relative), "utf8");
  if (
    relative !== canonicalTurnCommitProtocol &&
    /\b(?:validate|assert)TurnCommittedEventData\b/.test(source)
  ) {
    violations.push(`${relative}: duplicate turn_committed protocol implementation`);
  }
  if (
    relative !== canonicalTurnScopeIdentityProtocol &&
    /\b(?:function|const)\s+(?:canonicalizeTurnScopeId|turnScopeIdentityKey|areCanonicalTurnScopeIdsEqual)\b/.test(
      source,
    )
  ) {
    violations.push(`${relative}: duplicate Turn Scope identity protocol implementation`);
  }
}

for (const file of await collectProtocolSources("session-protocol/src")) {
  inspectTurnCommitProtocolDefinitions(file);
}

guard.report();
