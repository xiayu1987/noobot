#!/usr/bin/env node
/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { init, parse } from "es-module-lexer";
import { parsePluginManifest } from "@noobot/plugin-protocol/manifest";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const productionRoots = ["agent/src", "service/services", "client/noobot-chat/src", "client/noobot-chat/scripts", "plugin"];
const forbidden = [
  ["legacy backend activation", /\bregisterNoobotPlugin\b/],
  ["legacy frontend activation", /\bregisterFrontendPlugin\b/],
  ["legacy service route activation", /\bregisterNoobotServiceRoutes\b/],
  ["capability plugin selection", /\bPLUGIN_CAPABILITY\b/],
  ["legacy runtime surface option", /\bruntimeSurface\b/],
  ["legacy API version option", /\brequiredApiVersion\b/],
  ["legacy snake-case policy", /\bdeny_tool_names\b/],
  ["legacy collaboration policy", /\bdisableAgentCollabTools\b/],
  ["legacy snake-case collaboration policy", /\bdisable_agent_collab_tools\b/],
  ["legacy fixed plugin slot", /["'](?:agentPlugin|botPlugin)["']/],
  ["plugin identity alias", /(?:\.|["'])pluginKey\b/],
];
const hostRuntimeForbidden = [
  ["direct plugin activation", /\bentry\.activate\s*\(/],
  ["direct activation result validation", /\bvalidatePluginActivationResult\s*\(/],
  ["host-owned lifecycle record construction", /\bcreatePluginLifecycleRecord\s*\(/],
  ["raw lifecycle event literal", /["']plugin\.(?:activating|activated|contribution_committed|deactivating|deactivated|failed|rolled_back)["']/],
  ["unscoped service port facade", /\bcontext\??\.ports\s*\|\|/],
];
const hostRuntimeRoots = ["agent/src", "service/services", "client/noobot-chat/src"];

async function filesUnder(relativeRoot) {
  const output = [];
  async function visit(directory) {
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      if (["node_modules", "build", "dist", "__tests__", "docs"].includes(entry.name)) continue;
      const target = path.join(directory, entry.name);
      if (entry.isDirectory()) await visit(target);
      else if (/\.(?:js|mjs|vue|json)$/.test(entry.name)) output.push(target);
    }
  }
  await visit(path.join(root, relativeRoot));
  return output;
}

await init;
const violations = [];
const files = (await Promise.all(productionRoots.map(filesUnder))).flat();
const hostRuntimeFiles = new Set((await Promise.all(hostRuntimeRoots.map(filesUnder))).flat());
for (const file of files) {
  const source = await fs.readFile(file, "utf8");
  for (const [label, pattern] of forbidden) {
    if (pattern.test(source)) violations.push(`${path.relative(root, file)}: ${label}`);
  }
  if (hostRuntimeFiles.has(file)) {
    for (const [label, pattern] of hostRuntimeForbidden) {
      if (pattern.test(source)) violations.push(`${path.relative(root, file)}: ${label}`);
    }
  }
}

for (const pluginName of ["noobot-plugin-harness", "noobot-plugin-workflow"]) {
  const pluginRoot = path.join(root, "plugin", pluginName);
  const manifest = parsePluginManifest(JSON.parse(await fs.readFile(path.join(pluginRoot, "manifest.json"), "utf8")));
  for (const [surface, entry] of Object.entries(manifest.entries)) {
    const entryFile = path.join(pluginRoot, entry);
    const source = await fs.readFile(entryFile, "utf8");
    const [, exports] = parse(source);
    const exportedNames = exports.map((item) => item.n).sort();
    if (exportedNames.length !== 1 || exportedNames[0] !== "activate") {
      violations.push(`${path.relative(root, entryFile)}: ${surface} entry must export only activate`);
    }
  }
}

if (violations.length) {
  console.error(`plugin protocol boundary violations:\n${violations.map((item) => `- ${item}`).join("\n")}`);
  process.exitCode = 1;
} else {
  console.log(`plugin protocol boundary check passed (${files.length} production files)`);
}
