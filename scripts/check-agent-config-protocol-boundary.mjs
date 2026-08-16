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

async function filesUnder(relativeDirectory) {
  const files = [];
  for (const entry of await readdir(path.join(ROOT, relativeDirectory), { withFileTypes: true })) {
    const relative = path.join(relativeDirectory, entry.name);
    if (entry.isDirectory()) files.push(...(await filesUnder(relative)));
    else if (/\.(?:js|mjs)$/.test(entry.name)) files.push(relative);
  }
  return files;
}

async function assertAbsent(relativePath) {
  try {
    await access(path.join(ROOT, relativePath));
    violations.push(`${relativePath}: obsolete duplicate config implementation must be removed`);
  } catch {
    // Absence is required.
  }
}

const obsoleteProtocolFiles = [
  "protocol.js",
  "run-config-resolver.js",
  "key-normalizer.js",
  "time-config-normalizer.js",
  "config-file-migration.js",
  "config-merge.js",
  "builtin-scenarios.js",
  "tool-policy.js",
  "user-override-policy.js",
];
for (const fileName of obsoleteProtocolFiles) {
  await assertAbsent(`agent-config-protocol/src/${fileName}`);
}

const protocolFiles = await filesUnder("agent-config-protocol/src");
for (const file of protocolFiles) {
  const source = await readFile(path.join(ROOT, file), "utf8");
  for (const match of source.matchAll(/from\s+["']([^"']+)["']/g)) {
    const specifier = match[1];
    if (
      specifier.startsWith("noobot-agent") ||
      specifier.startsWith("../agent") ||
      specifier.includes("agent/src") ||
      specifier === "node:fs" ||
      specifier.startsWith("node:fs/") ||
      specifier === "node:path" ||
      specifier === "@noobot/model-runtime" ||
      specifier === "@noobot/plugin-runtime"
    ) {
      violations.push(`${file}: protocol must not import Agent runtime module ${specifier}`);
    }
  }
  if (/\btools\.(?:allowed|denied)\b/.test(source)) {
    violations.push(`${file}: legacy tool policy fields are forbidden`);
  }
  if (/const\s+tSystem\s*=/.test(source)) {
    violations.push(`${file}: protocol localization fallback is forbidden`);
  }
}

for (const relativePath of [
  "agent/src/config/core/builtin-scenarios.js",
  "agent/src/config/core/config-merge.js",
  "agent/src/config/core/key-normalizer.js",
  "agent/src/config/core/time-config-normalizer.js",
  "agent/src/config/core/user-override-policy.js",
  "agent/src/config/core/template-resolver.js",
  "agent/src/bot/config/run-config-resolver.js",
  "agent/src/bot/config/tool-policy-manager.js",
  "agent/src/bot/session/plugin-policy-api.js",
])
  await assertAbsent(relativePath);

const agentSourceFiles = await filesUnder("agent/src");
const agentScriptFiles = await filesUnder("agent/scripts");
const serviceSourceFiles = await filesUnder("service/services");
const serviceConfigScriptFiles = await filesUnder("service/scripts/project-launcher");
const desktopConfigFiles = await filesUnder("client/shared/electron/runtime");
const protocolConsumerFiles = [
  ...agentSourceFiles,
  ...agentScriptFiles,
  ...serviceSourceFiles,
  ...serviceConfigScriptFiles,
  ...desktopConfigFiles,
];
for (const file of protocolConsumerFiles) {
  const source = await readFile(path.join(ROOT, file), "utf8");
  if (/\b(?:ToolPolicyManager|applyRunConfigToolPolicy|_applyRunConfigToolPolicy)\b/.test(source)) {
    violations.push(`${file}: obsolete parallel tool-policy entry is forbidden`);
  }
  if (/\btools\.(?:allowed|denied)\b/.test(source)) {
    violations.push(`${file}: legacy tool policy fields are forbidden`);
  }
  if (/function\s+normalizeConfigParamKey\b|const\s+normalizeConfigParamKey\b/.test(source)) {
    violations.push(`${file}: config param key normalization must use the protocol`);
  }
  if (source.includes("[A-Z0-9_]+") && source.includes("${")) {
    violations.push(`${file}: config template grammar must use the protocol`);
  }
  if (/\b(?:globalConfig|rawGlobalConfig)\??\.configParams\b/.test(source)) {
    violations.push(`${file}: configParams must come from the explicit resolution context`);
  }
}

if (violations.length) {
  console.error(`[agent-config-protocol-boundary] failed\n${violations.join("\n")}`);
  process.exitCode = 1;
} else {
  console.log(
    `[agent-config-protocol-boundary] ok (${protocolFiles.length + protocolConsumerFiles.length} files)`,
  );
}
