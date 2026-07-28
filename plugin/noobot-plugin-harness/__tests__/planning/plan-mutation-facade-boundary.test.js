/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");
const srcRoot = path.join(projectRoot, "src");
const allowedImporter = path.join(
  srcRoot,
  "capabilities/handlers/shared/plan/mutation-facade.js",
);

async function collectJsFiles(rootDir) {
  const entries = await fs.readdir(rootDir, { withFileTypes: true });
  const files = await Promise.all(entries.map(async (entry) => {
    const fullPath = path.join(rootDir, entry.name);
    if (entry.isDirectory()) return collectJsFiles(fullPath);
    if (!entry.isFile()) return [];
    return fullPath.endsWith(".js") ? [fullPath] : [];
  }));
  return files.flat();
}

test("only mutation facade imports mutation-engine", async () => {
  const files = await collectJsFiles(srcRoot);
  const offenders = [];
  for (const file of files) {
    if (path.normalize(file) === path.normalize(allowedImporter)) continue;
    const content = await fs.readFile(file, "utf8");
    if (/from\s+["'][^"']*mutation-engine\.js["']/.test(content)) {
      offenders.push(path.relative(projectRoot, file));
    }
  }
  assert.deepEqual(offenders, []);
});
