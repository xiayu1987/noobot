/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { init, parse } from "es-module-lexer";
import { clientFilePath as path } from "@noobot/client-shared/path-resolver";
import { vueScriptRegions } from "../../../scripts/lib/vue-script-regions.mjs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(projectRoot, "../..");
const sourceRoot = path.join(projectRoot, "src");
const unitTestRoot = path.join(projectRoot, "tests/unit");
const agentProxyTestRoot = path.join(repoRoot, "agent-proxy/__tests__");
const pluginTestRoots = [
  path.join(repoRoot, "plugin/noobot-plugin-harness/__tests__"),
  path.join(repoRoot, "plugin/noobot-plugin-workflow/__tests__"),
];
const inspectedSourceRoots = [
  sourceRoot,
  path.join(repoRoot, "client/startup/src"),
  path.join(repoRoot, "plugin/noobot-plugin-harness/frontend"),
  path.join(repoRoot, "plugin/noobot-plugin-workflow/frontend"),
];
const moduleRoot = path.join(sourceRoot, "modules");
const appRoot = path.join(sourceRoot, "app");
const sharedRoot = path.join(sourceRoot, "shared");
const infrastructureRoot = path.join(sourceRoot, "infrastructure");
const inspectedExtensions = new Set([".js", ".mjs", ".vue"]);

const retiredDirectories = [
  "composables",
  "services",
  "modules/message",
  "shared/execution",
  "shared/message",
  "shared/models",
  "shared/process",
  "shared/stores",
];
const retiredTestDirectories = [
  "chatEngine",
  "composables",
  "plugin",
  "services",
  "modules/chat/chatEngine",
  "modules/chat/chatList",
  "modules/chat/debug",
  "modules/chat/sessionRunStateMachine",
];

const violations = [];

function isInside(parent, candidate) {
  const relative = path.relative(parent, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function inspectDirectory(directory) {
  if (!fs.existsSync(directory)) return;
  const entries = fs.readdirSync(directory, { withFileTypes: true });
  const extensions = new Set(
    entries.filter((entry) => entry.isFile()).map((entry) => path.extname(entry.name)),
  );
  if (extensions.has(".vue") && (extensions.has(".js") || extensions.has(".mjs"))) {
    violations.push(`${path.relative(projectRoot, directory)} mixes Vue and JavaScript files`);
  }
  for (const entry of entries) {
    if (entry.isDirectory()) inspectDirectory(path.join(directory, entry.name));
  }
}

function dependencyViolation(importer, target) {
  if (
    isInside(sharedRoot, importer) &&
    (isInside(appRoot, target) || isInside(moduleRoot, target))
  ) {
    return "shared code must not depend on app or business modules";
  }
  if (isInside(moduleRoot, importer) && isInside(appRoot, target)) {
    return "business modules must not depend on the app composition layer";
  }
  if (
    isInside(infrastructureRoot, importer) &&
    (isInside(appRoot, target) || path.extname(target).toLowerCase() === ".vue")
  ) {
    return "infrastructure must not depend on the app layer or Vue components";
  }
  return "";
}

async function inspectDependencies(directory) {
  if (!fs.existsSync(directory)) return;
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const filePath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      await inspectDependencies(filePath);
      continue;
    }
    if (!entry.isFile() || !inspectedExtensions.has(path.extname(entry.name).toLowerCase()))
      continue;
    let regions;
    try {
      regions = vueScriptRegions(filePath, fs.readFileSync(filePath, "utf8"));
    } catch (error) {
      violations.push(`${path.relative(repoRoot, filePath)} cannot be parsed: ${error.message}`);
      continue;
    }
    for (const { source: script } of regions) {
      let imports;
      try {
        [imports] = parse(script, filePath);
      } catch (error) {
        violations.push(`${path.relative(repoRoot, filePath)} cannot be parsed: ${error.message}`);
        continue;
      }
      for (const moduleImport of imports) {
        const specifier = moduleImport.n;
        if (!specifier?.startsWith(".")) continue;
        const target = path.resolve(path.dirname(filePath), specifier.replace(/[?#].*$/, ""));
        const reason = dependencyViolation(filePath, target);
        if (reason) {
          violations.push(`${path.relative(repoRoot, filePath)}: ${reason} (${specifier})`);
        }
      }
    }
  }
}

for (const relativeDirectory of retiredDirectories) {
  if (fs.existsSync(path.join(sourceRoot, relativeDirectory))) {
    violations.push(
      `src/${relativeDirectory} is retired; use an owning module or infrastructure layer`,
    );
  }
}
for (const relativeDirectory of retiredTestDirectories) {
  if (fs.existsSync(path.join(unitTestRoot, relativeDirectory))) {
    violations.push(`tests/unit/${relativeDirectory} is retired; mirror the owning source layer`);
  }
}
if (fs.existsSync(agentProxyTestRoot)) {
  for (const entry of fs.readdirSync(agentProxyTestRoot, { withFileTypes: true })) {
    if (entry.isFile() && /\.(?:test|spec)\.js$/.test(entry.name)) {
      violations.push(`agent-proxy/__tests__/${entry.name} must belong to an owning source layer`);
    }
  }
}
for (const pluginTestRoot of pluginTestRoots) {
  if (!fs.existsSync(pluginTestRoot)) continue;
  for (const entry of fs.readdirSync(pluginTestRoot, { withFileTypes: true })) {
    if (entry.isFile() && /\.(?:test|spec)\.js$/.test(entry.name)) {
      violations.push(
        `${path.relative(repoRoot, path.join(pluginTestRoot, entry.name))} must belong to a test domain`,
      );
    }
  }
}

await init;
for (const directory of inspectedSourceRoots) inspectDirectory(directory);
await inspectDependencies(sourceRoot);

if (violations.length) {
  console.error(`[frontend-structure] ${violations.length} violation(s):`);
  for (const violation of violations) console.error(`- ${violation}`);
  process.exitCode = 1;
} else {
  console.log(
    "[frontend-structure] ok: client/plugin semantic layers are clean and Vue/JavaScript files are separated",
  );
}
