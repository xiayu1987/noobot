/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const toolsRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../src/tools");

async function listJavaScriptFiles(directory) {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const absolutePath = path.join(directory, entry.name);
      if (entry.isDirectory()) return listJavaScriptFiles(absolutePath);
      return entry.isFile() && entry.name.endsWith(".js") ? [absolutePath] : [];
    }),
  );
  return nested.flat();
}

test("tools cannot bypass the authoritative detached sub-session protocol", async () => {
  const violations = [];
  for (const file of await listJavaScriptFiles(toolsRoot)) {
    const source = await fs.readFile(file, "utf8");
    if (/botManager\s*\.\s*runSession\s*\(/u.test(source)) {
      violations.push(path.relative(toolsRoot, file));
    }
  }
  assert.deepEqual(violations, []);
});
