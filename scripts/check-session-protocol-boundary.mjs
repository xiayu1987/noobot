/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const productionRoots = [
  "agent/src",
  "service",
  "client/noobot-chat/src",
  "authoritative-state/src",
];
const ignored = new Set(["vendor", "dist", "node_modules", "__tests__", "tests"]);
const violations = [];
const canonicalTurnCommitProtocol = "session-protocol/src/turn-commit.js";

function visit(relative) {
  const absolute = path.join(root, relative);
  for (const entry of fs.readdirSync(absolute, { withFileTypes: true })) {
    if (ignored.has(entry.name)) continue;
    const child = path.join(relative, entry.name);
    if (entry.isDirectory()) visit(child);
    else if (/\.(?:js|mjs|vue)$/.test(entry.name)) inspect(child);
  }
}

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

for (const relative of productionRoots) visit(relative);

function inspectTurnCommitProtocolDefinitions(relative) {
  const source = fs.readFileSync(path.join(root, relative), "utf8");
  if (
    relative !== canonicalTurnCommitProtocol &&
    /\b(?:validate|assert)TurnCommittedEventData\b/.test(source)
  ) {
    violations.push(`${relative}: duplicate turn_committed protocol implementation`);
  }
}

function visitSessionProtocol(relative) {
  const absolute = path.join(root, relative);
  for (const entry of fs.readdirSync(absolute, { withFileTypes: true })) {
    const child = path.join(relative, entry.name);
    if (entry.isDirectory()) visitSessionProtocol(child);
    else if (/\.js$/.test(entry.name)) inspectTurnCommitProtocolDefinitions(child);
  }
}

visitSessionProtocol("session-protocol/src");
if (violations.length) {
  console.error(violations.join("\n"));
  process.exitCode = 1;
} else {
  console.log("Session protocol boundary passed");
}
