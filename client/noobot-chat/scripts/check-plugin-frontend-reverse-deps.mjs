#!/usr/bin/env node
/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import fs from "node:fs/promises";
import { clientFilePath as path } from "../../shared/path-resolver.js";

const projectRoot = path.resolve(process.cwd());
const repoRoot = path.resolve(projectRoot, "../..");
const pluginRoot = path.resolve(repoRoot, "plugin");

const TARGET_EXTENSIONS = new Set([".js", ".mjs", ".cjs", ".vue", ".ts"]);
const FORBIDDEN_PATTERNS = [
  "client/noobot-chat/src/modules/",
];

async function walkFiles(rootDir = "") {
  const output = [];
  let entries = [];
  try {
    entries = await fs.readdir(rootDir, { withFileTypes: true });
  } catch {
    return output;
  }
  for (const entry of entries) {
    const absPath = path.resolve(rootDir, entry.name);
    if (entry.isDirectory()) {
      output.push(...(await walkFiles(absPath)));
      continue;
    }
    if (!entry.isFile()) continue;
    const ext = path.extname(entry.name).toLowerCase();
    if (!TARGET_EXTENSIONS.has(ext)) continue;
    output.push(absPath);
  }
  return output;
}

function findForbiddenHits(content = "") {
  const hits = [];
  for (const pattern of FORBIDDEN_PATTERNS) {
    if (content.includes(pattern)) hits.push(pattern);
  }
  return hits;
}

async function main() {
  let pluginDirs = [];
  try {
    pluginDirs = await fs.readdir(pluginRoot, { withFileTypes: true });
  } catch {
    console.log("[plugin-frontend-reverse-deps] skip: plugin root not found");
    return;
  }
  const violations = [];
  for (const dirent of pluginDirs) {
    if (!dirent?.isDirectory?.()) continue;
    const frontendDir = path.resolve(pluginRoot, dirent.name, "frontend");
    let stat;
    try {
      stat = await fs.stat(frontendDir);
    } catch {
      continue;
    }
    if (!stat.isDirectory()) continue;
    const files = await walkFiles(frontendDir);
    for (const filePath of files) {
      const content = await fs.readFile(filePath, "utf8");
      const hits = findForbiddenHits(content);
      if (!hits.length) continue;
      violations.push({
        filePath,
        hits,
      });
    }
  }
  if (!violations.length) {
    console.log("[plugin-frontend-reverse-deps] ok: no forbidden reverse imports");
    return;
  }
  console.error("[plugin-frontend-reverse-deps] found forbidden reverse imports:");
  for (const item of violations) {
    const relativeFile = path.relative(repoRoot, item.filePath).replaceAll("\\", "/");
    console.error(`- ${relativeFile}`);
    for (const hit of item.hits) {
      console.error(`  hit: ${hit}`);
    }
  }
  process.exitCode = 1;
}

main().catch((error) => {
  console.error("[plugin-frontend-reverse-deps] failed:", error?.message || error);
  process.exitCode = 1;
});

