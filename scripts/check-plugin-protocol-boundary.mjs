#!/usr/bin/env node
/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { init, parse } from "es-module-lexer";
import { parsePluginManifest } from "@noobot/plugin-protocol/manifest";
import {
  addHit,
  defineCheck,
  emptyRuleMeasurements,
  runCheckWhenMain,
} from "./quality/check-protocol.mjs";
import {
  offsetLine,
  readRepositoryJson,
  readRepositoryText,
  repositoryRoot,
} from "./quality/repository-files.mjs";
import { addPatternLineHits } from "./quality/boundary-hits.mjs";
import { getFirstPartyFilesUnder } from "./quality/source-inventory.mjs";

const SCAN = Object.freeze({ extensions: [".js", ".mjs", ".vue", ".json"], includeTests: false });
const PRODUCTION_ROOTS = Object.freeze([
  "agent/src",
  "service/services",
  "client/noobot-chat/src",
  "client/noobot-chat/scripts",
  "plugin",
]);
const HOST_RUNTIME_ROOTS = Object.freeze([
  "agent/src",
  "service/services",
  "client/noobot-chat/src",
]);
const PLUGINS = Object.freeze([
  "noobot-plugin-character",
  "noobot-plugin-harness",
  "noobot-plugin-workflow",
]);
const LEGACY_TERMS = Object.freeze([
  ["legacy backend activation", /\bregisterNoobotPlugin\b/],
  ["legacy frontend activation", /\bregisterFrontendPlugin\b/],
  ["legacy service route activation", /\bregisterNoobotServiceRoutes\b/],
  ["capability plugin selection", /\bPLUGIN_CAPABILITY\b/],
  ["legacy runtime surface option", /\bruntimeSurface\b/],
  ["legacy API version option", /\brequiredApiVersion\b/],
  ["legacy snake-case policy", /\bdeny_tool_names\b/],
  ["legacy fixed plugin slot", /["'](?:agentPlugin|botPlugin)["']/],
  ["plugin identity alias", /(?:\.|["'])pluginKey\b/],
]);
const HOST_RUNTIME_FORBIDDEN = Object.freeze([
  ["direct plugin activation", /\bentry\.activate\s*\(/],
  ["direct activation result validation", /\bvalidatePluginActivationResult\s*\(/],
  ["host-owned lifecycle record construction", /\bcreatePluginLifecycleRecord\s*\(/],
  [
    "raw lifecycle event literal",
    /["']plugin\.(?:activating|activated|contribution_committed|deactivating|deactivated|failed|rolled_back)["']/,
  ],
  ["unscoped service port facade", /\bcontext\??\.ports\s*\|\|/],
]);

const filesUnder = (directories) =>
  getFirstPartyFilesUnder(directories, { ...SCAN, repositoryRoot });

function declaredFrontendModules(manifest) {
  const frontend = manifest.contributes.frontend;
  if (!frontend?.extensions) return new Set();
  return new Set(
    frontend.extensions.flatMap((extension) =>
      extension.component ? [extension.component.module] : [],
    ),
  );
}

async function measureEntries(measured, pluginName) {
  const pluginRoot = `plugin/${pluginName}`;
  const manifest = parsePluginManifest(await readRepositoryJson(`${pluginRoot}/manifest.json`));
  for (const [surface, entry] of Object.entries(manifest.entries)) {
    const file = `${pluginRoot}/${entry}`;
    const source = await readRepositoryText(file);
    const [imports, exports] = parse(source);
    const exportedNames = exports.map((item) => item.name);
    if (exportedNames.length !== 1 || exportedNames[0] !== "activate") {
      addHit(measured.entryExports, {
        file,
        message: `${surface} entry must export only activate`,
      });
    }
    if (surface !== "frontend") continue;
    const declared = declaredFrontendModules(manifest);
    for (const imported of imports) {
      if (declared.has(imported.specifier)) {
        addHit(measured.frontendComponentLoading, {
          file,
          line: offsetLine(source, imported.start),
          message: `component ${imported.specifier} must load from its manifest declaration`,
        });
      }
      if (imported.type === "static" && imported.specifier.endsWith(".vue")) {
        addHit(measured.frontendComponentLoading, {
          file,
          line: offsetLine(source, imported.start),
          message: `static Vue import ${imported.specifier}`,
        });
      }
    }
  }
}

async function measure() {
  const measured = emptyRuleMeasurements(CHECK);
  const hostRuntimeFiles = new Set(await filesUnder(HOST_RUNTIME_ROOTS));
  for (const file of await filesUnder(PRODUCTION_ROOTS)) {
    const source = await readRepositoryText(file);
    for (const [message, pattern] of LEGACY_TERMS) {
      addPatternLineHits({ measurement: measured.legacyTerm, file, source, pattern, message });
    }
    if (hostRuntimeFiles.has(file)) {
      for (const [message, pattern] of HOST_RUNTIME_FORBIDDEN) {
        addPatternLineHits({ measurement: measured.hostLifecycle, file, source, pattern, message });
      }
    }
  }
  await init;
  for (const pluginName of PLUGINS) await measureEntries(measured, pluginName);
  return measured;
}

export const CHECK = defineCheck({
  id: "plugin-protocol-boundary",
  description: "Plugins activate through the plugin protocol host and declare their contributions",
  rules: {
    legacyTerm: {
      description: "Obsolete plugin activation, slot and identity terms stay removed",
      hint: "use the manifest entries and activate(context) from @noobot/plugin-protocol",
    },
    hostLifecycle: {
      description: "Host runtimes delegate activation and lifecycle records to the plugin host",
      hint: "call the plugin host from @noobot/plugin-protocol instead of activating entries directly",
    },
    entryExports: {
      description: "Each manifest entry exports only activate",
      hint: "move other exports into internal modules and export only activate",
    },
    frontendComponentLoading: {
      description: "Frontend components load from their manifest declaration",
      hint: "declare the component in contributes.frontend.extensions and let the host load it",
    },
  },
  exemptions: [],
  baseline: {
    legacyTerm: 0,
    hostLifecycle: 0,
    entryExports: 0,
    frontendComponentLoading: 0,
    exemptions: 0,
  },
  measure,
});

await runCheckWhenMain(CHECK, import.meta.url);
