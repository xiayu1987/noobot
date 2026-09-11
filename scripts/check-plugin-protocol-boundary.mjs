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
import { createRelativeSourceCollector } from "./lib/guard-scan.mjs";
import { createGuardViolations } from "./lib/guard-violations.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const guard = createGuardViolations({ root, label: "plugin-protocol-boundary" });
const { violations } = guard;
const productionRoots = [
  "agent/src",
  "service/services",
  "client/noobot-chat/src",
  "client/noobot-chat/scripts",
  "plugin",
];
const forbidden = [
  ["legacy backend activation", /\bregisterNoobotPlugin\b/],
  ["legacy frontend activation", /\bregisterFrontendPlugin\b/],
  ["legacy service route activation", /\bregisterNoobotServiceRoutes\b/],
  ["capability plugin selection", /\bPLUGIN_CAPABILITY\b/],
  ["legacy runtime surface option", /\bruntimeSurface\b/],
  ["legacy API version option", /\brequiredApiVersion\b/],
  ["legacy snake-case policy", /\bdeny_tool_names\b/],
  ["legacy fixed plugin slot", /["'](?:agentPlugin|botPlugin)["']/],
  ["plugin identity alias", /(?:\.|["'])pluginKey\b/],
];
const hostRuntimeForbidden = [
  ["direct plugin activation", /\bentry\.activate\s*\(/],
  ["direct activation result validation", /\bvalidatePluginActivationResult\s*\(/],
  ["host-owned lifecycle record construction", /\bcreatePluginLifecycleRecord\s*\(/],
  [
    "raw lifecycle event literal",
    /["']plugin\.(?:activating|activated|contribution_committed|deactivating|deactivated|failed|rolled_back)["']/,
  ],
  ["unscoped service port facade", /\bcontext\??\.ports\s*\|\|/],
];
const hostRuntimeRoots = ["agent/src", "service/services", "client/noobot-chat/src"];

const filesUnder = createRelativeSourceCollector({
  root,
  extensions: new Set([".js", ".mjs", ".vue", ".json"]),
  ignoredDirectories: new Set(["node_modules", "build", "dist", "__tests__", "docs"]),
});

await init;
const files = (await Promise.all(productionRoots.map(filesUnder))).flat();
const hostRuntimeFiles = new Set((await Promise.all(hostRuntimeRoots.map(filesUnder))).flat());
for (const file of files) {
  const source = await fs.readFile(path.join(root, file), "utf8");
  for (const [label, pattern] of forbidden) {
    if (pattern.test(source)) violations.push(`${file}: ${label}`);
  }
  if (hostRuntimeFiles.has(file)) {
    for (const [label, pattern] of hostRuntimeForbidden) {
      if (pattern.test(source)) violations.push(`${file}: ${label}`);
    }
  }
}

for (const pluginName of ["noobot-plugin-harness", "noobot-plugin-workflow"]) {
  const pluginRoot = path.join(root, "plugin", pluginName);
  const manifest = parsePluginManifest(
    JSON.parse(await fs.readFile(path.join(pluginRoot, "manifest.json"), "utf8")),
  );
  for (const [surface, entry] of Object.entries(manifest.entries)) {
    const entryFile = path.join(pluginRoot, entry);
    const source = await fs.readFile(entryFile, "utf8");
    const [, exports] = parse(source);
    const exportedNames = exports.map((item) => item.n).sort();
    if (exportedNames.length !== 1 || exportedNames[0] !== "activate") {
      violations.push(
        `${path.relative(root, entryFile)}: ${surface} entry must export only activate`,
      );
    }
  }
}

guard.report(`${files.length} production files`);
