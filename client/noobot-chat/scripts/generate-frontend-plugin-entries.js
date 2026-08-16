#!/usr/bin/env node
/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { clientFilePath as path } from "@noobot/client-shared/path-resolver";
import { parsePluginManifest } from "@noobot/plugin-protocol/manifest";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDir, "..");
const repoRoot = path.resolve(projectRoot, "../..");
const pluginRoot = path.resolve(repoRoot, "plugin");
const outputFile = path.resolve(
  projectRoot,
  "src/plugins/generated/external-entries.js",
);

async function readJsonSafe(filePath = "") {
  try {
    const content = await fs.readFile(filePath, "utf8");
    return JSON.parse(content);
  } catch {
    return null;
  }
}

function normalizeEntryImportPath(fromDir = "", targetFile = "") {
  let relativePath = path.relative(fromDir, targetFile).replaceAll("\\", "/");
  if (!relativePath.startsWith(".")) relativePath = `./${relativePath}`;
  return relativePath;
}

function toEntryModuleItem(item = {}, outputDir = "") {
  const entryImportPath = normalizeEntryImportPath(outputDir, item.entryPath);
  return {
    pluginId: item.pluginId,
    name: item.name,
    version: item.version,
    manifest: item.manifest,
    entryImportPath,
  };
}

function buildOutputSource(entries = []) {
  const objectLines = entries.map(
    (item) => `  {
    pluginId: ${JSON.stringify(item.pluginId)},
    name: ${JSON.stringify(item.name)},
    version: ${JSON.stringify(item.version)},
    manifest: Object.freeze(${JSON.stringify(item.manifest)}),
    loadModule: () => import(${JSON.stringify(item.entryImportPath)}),
  }`,
  );
  return `/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
export const externalFrontendPluginEntries = [
${objectLines.join(",\n")}
];
`;
}

async function discoverFrontendPluginEntries() {
  let dirEntries = [];
  try {
    dirEntries = await fs.readdir(pluginRoot, { withFileTypes: true });
  } catch {
    return [];
  }
  const output = [];
  for (const dirent of dirEntries) {
    if (!dirent?.isDirectory?.()) continue;
    const pluginDir = path.resolve(pluginRoot, dirent.name);
    const manifestPath = path.resolve(pluginDir, "manifest.json");
    const sourceManifest = await readJsonSafe(manifestPath);
    if (!sourceManifest || typeof sourceManifest !== "object") continue;
    const manifest = parsePluginManifest(sourceManifest);
    if (!manifest.contributes.frontend) continue;
    const frontendEntry = String(manifest?.entries?.frontend || "").trim();
    if (!frontendEntry) continue;
    const entryPath = path.resolve(pluginDir, frontendEntry);
    try {
      await fs.access(entryPath);
    } catch {
      console.warn(
        `[frontend-plugin-entries] skip ${String(manifest.id || dirent.name)}: missing entry ${frontendEntry}`,
      );
      continue;
    }
    output.push({
      pluginId: String(manifest.id || dirent.name).trim(),
      name: String(manifest.name || "").trim(),
      version: String(manifest.version || "").trim(),
      manifest,
      entryPath,
    });
  }
  return output.sort((a, b) => a.pluginId.localeCompare(b.pluginId));
}

async function main() {
  const entries = await discoverFrontendPluginEntries();
  const outputDir = path.dirname(outputFile);
  await fs.mkdir(outputDir, { recursive: true });
  const normalized = entries.map((item) => toEntryModuleItem(item, outputDir));
  const content = buildOutputSource(normalized);
  await fs.writeFile(outputFile, content, "utf8");
  console.log(
    `[frontend-plugin-entries] generated ${path.relative(projectRoot, outputFile)} (${entries.length} entries)`,
  );
}

main().catch((error) => {
  console.error("[frontend-plugin-entries] failed:", error?.message || error);
  process.exitCode = 1;
});
