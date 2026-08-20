#!/usr/bin/env node
/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { access, readFile, readdir } from "node:fs/promises";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const violations = [];

async function source(relativePath) {
  return readFile(path.join(ROOT, relativePath), "utf8");
}

async function assertAbsent(relativePath) {
  try {
    await access(path.join(ROOT, relativePath));
    violations.push(`${relativePath}: obsolete connector implementation must remain removed`);
  } catch {
    // Absence is required.
  }
}

async function sourceFiles(relativeDirectory) {
  const files = [];
  for (const entry of await readdir(path.join(ROOT, relativeDirectory), { withFileTypes: true })) {
    const relativePath = path.join(relativeDirectory, entry.name);
    if (entry.isDirectory()) files.push(...(await sourceFiles(relativePath)));
    else if (/\.(?:js|mjs|vue)$/.test(entry.name)) files.push(relativePath);
  }
  return files;
}

for (const relativePath of [
  "agent/src/integrations/connectors/connector-event-listener.js",
  "agent/src/integrations/connectors/history-store.js",
  "agent/src/tools/connectors/base-connector-tool.js",
  "agent/src/tools/connectors/connector-toolkit/tool-connect-database.js",
  "agent/src/tools/connectors/connector-toolkit/tool-connect-email.js",
  "agent/src/tools/connectors/connector-toolkit/tool-connect-terminal.js",
]) {
  await assertAbsent(relativePath);
}

const protocolCatalog = await source("connector-protocol/src/catalog.js");
for (const marker of [
  "CONNECTOR_TYPE",
  "CONNECTOR_CATALOG",
  "resolveConnectorDefinition",
  "buildConnectorConnectionInfo",
]) {
  if (!protocolCatalog.includes(marker)) {
    violations.push(`connector-protocol/src/catalog.js: missing ${marker}`);
  }
}

const productionRoots = [
  "agent-config-protocol/src",
  "agent-transport-protocol/src",
  "agent/src",
  "client/noobot-chat/src",
  "service",
];
const forbiddenLegacyTerms = [
  "selectedConnectors",
  "normalizeSelectedConnectors",
  "getRootSessionSelectedConnectors",
  "setRootSessionSelectedConnectors",
  "database_connect_connector",
  "terminal_connect_connector",
  "email_connect_connector",
  "getConnectorHistoryStore",
  "connectorEventListener",
];
for (const relativePath of (await Promise.all(productionRoots.map(sourceFiles))).flat()) {
  const content = await source(relativePath);
  if (/export\s+const\s+CONNECTOR_TYPE\b/.test(content)) {
    violations.push(`${relativePath}: connector types belong to connector-protocol`);
  }
  for (const term of forbiddenLegacyTerms) {
    if (content.includes(term)) violations.push(`${relativePath}: obsolete connector term ${term}`);
  }
}

const runPreferences = await source("agent-transport-protocol/src/run-preferences.js");
if (runPreferences.includes("selectedConnectorIds")) {
  violations.push(
    "agent-transport-protocol/src/run-preferences.js: Session connector selection cannot be a run preference",
  );
}

if (violations.length) {
  console.error(`[connector-protocol-boundary] failed\n${violations.join("\n")}`);
  process.exitCode = 1;
} else {
  console.log("[connector-protocol-boundary] ok");
}
