#!/usr/bin/env node
/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import fs from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { init, parse } from "es-module-lexer";
import { clientFilePath as path } from "../../shared/path-resolver.js";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDir, "..");
const repoRoot = path.resolve(projectRoot, "../..");
const clientSourceRoot = path.resolve(projectRoot, "src");
const pluginRoot = path.resolve(repoRoot, "plugin");
const targetExtensions = new Set([".js", ".mjs", ".cjs", ".jsx", ".ts", ".tsx", ".vue"]);
const ignoredDirectories = new Set(["build", "coverage", "dist", "node_modules"]);
export const allowedPluginApiSpecifiers = new Set([
  "noobot-chat/plugin-api",
  "noobot-chat/plugin-api/ui",
  "noobot-chat/plugin-api/chat-ui",
  "noobot-chat/plugin-api/locale",
  "noobot-chat/plugin-api/attachment-domain",
  "noobot-chat/plugin-api/session-domain",
]);

function isInside(parent, candidate) {
  const relative = path.relative(parent, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function stripResourceSuffix(specifier) {
  const suffixAt = specifier.search(/[?#]/);
  return suffixAt < 0 ? specifier : specifier.slice(0, suffixAt);
}

export function classifyFrontendImport(importer, specifier) {
  if (typeof specifier !== "string" || !specifier) return null;
  if (specifier.startsWith("./") || specifier.startsWith("../")) {
    const target = path.resolve(path.dirname(importer), stripResourceSuffix(specifier));
    if (isInside(clientSourceRoot, target)) {
      return "plugin frontend must not import client source by relative file path";
    }
    return null;
  }
  if (specifier === "noobot-chat" || specifier.startsWith("noobot-chat/")) {
    if (!allowedPluginApiSpecifiers.has(specifier)) {
      return "plugin frontend must use an exported noobot-chat/plugin-api subpath";
    }
  }
  return null;
}

function scriptRegions(filePath, content) {
  if (!filePath.endsWith(".vue")) return [content];
  const scripts = [];
  for (const match of content.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script\s*>/gi)) scripts.push(match[1]);
  return scripts;
}

export async function inspectFrontendSource(filePath, content) {
  await init;
  const violations = [];
  for (const script of scriptRegions(filePath, content)) {
    let imports;
    try {
      [imports] = parse(script, filePath);
    } catch (error) {
      violations.push({ specifier: "", reason: `module parse failed: ${error.message}` });
      continue;
    }
    for (const moduleImport of imports) {
      const specifier = moduleImport.n;
      const reason = classifyFrontendImport(filePath, specifier);
      if (reason) violations.push({ specifier, reason });
    }
  }
  return violations;
}

async function walkFiles(rootDir) {
  const output = [];
  let entries = [];
  try {
    entries = await fs.readdir(rootDir, { withFileTypes: true });
  } catch {
    return output;
  }
  for (const entry of entries) {
    if (entry.isDirectory() && ignoredDirectories.has(entry.name)) continue;
    const absolute = path.resolve(rootDir, entry.name);
    if (entry.isDirectory()) output.push(...(await walkFiles(absolute)));
    else if (entry.isFile() && targetExtensions.has(path.extname(entry.name).toLowerCase())) output.push(absolute);
  }
  return output;
}

export async function checkPluginFrontendBoundaries() {
  let pluginDirs = [];
  try {
    pluginDirs = await fs.readdir(pluginRoot, { withFileTypes: true });
  } catch {
    return [];
  }
  const violations = [];
  for (const dirent of pluginDirs) {
    if (!dirent.isDirectory()) continue;
    const frontendDir = path.resolve(pluginRoot, dirent.name, "frontend");
    for (const filePath of await walkFiles(frontendDir)) {
      const content = await fs.readFile(filePath, "utf8");
      for (const violation of await inspectFrontendSource(filePath, content)) {
        violations.push({ filePath, ...violation });
      }
    }
  }
  return violations;
}

async function main() {
  const violations = await checkPluginFrontendBoundaries();
  if (!violations.length) {
    console.log("[plugin-frontend-boundary] ok: package exports are the only client API boundary");
    return;
  }
  console.error("[plugin-frontend-boundary] found forbidden imports:");
  for (const { filePath, specifier, reason } of violations) {
    const relativeFile = path.relative(repoRoot, filePath).replaceAll("\\", "/");
    console.error(`- ${relativeFile}: ${reason}: ${JSON.stringify(specifier)}`);
  }
  process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error("[plugin-frontend-boundary] failed:", error?.message || error);
    process.exitCode = 1;
  });
}

