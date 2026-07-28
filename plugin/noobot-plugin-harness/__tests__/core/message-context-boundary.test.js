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

const allowedFiles = new Set([
  path.normalize(path.join(srcRoot, "core/context.js")),
  path.normalize(path.join(srcRoot, "core/message-store.js")),
  path.normalize(path.join(srcRoot, "capabilities/takeover/message-takeover.js")),
]);

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

test("message context writes stay behind the message store boundary", async () => {
  const files = await collectJsFiles(srcRoot);
  const offenders = [];
  const forbiddenPatterns = [
    /\bctx\.messages\.(push|splice|unshift|shift|pop)\s*\(/,
    /\bctx\.messages\s*=/,
    /\bctx\.messageBlocks\.(system|history|incremental)\s*=/,
    /\bmessageBlocks\.(system|history|incremental)\s*=/,
  ];

  for (const file of files) {
    if (allowedFiles.has(path.normalize(file))) continue;
    const content = await fs.readFile(file, "utf8");
    if (forbiddenPatterns.some((pattern) => pattern.test(content))) {
      offenders.push(path.relative(projectRoot, file));
    }
  }

  assert.deepEqual(offenders, []);
});
