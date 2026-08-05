/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const agentRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const sourceRoot = path.join(agentRoot, "src");
const authorityFile = path.join(sourceRoot, "models/invoke/observed-chat-model.js");

async function listJavaScriptFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) return listJavaScriptFiles(target);
    return entry.isFile() && entry.name.endsWith(".js") ? [target] : [];
  }));
  return nested.flat();
}

test("model invocation observation has one production authority", async () => {
  const files = await listJavaScriptFiles(sourceRoot);
  const owners = [];
  for (const file of files) {
    const source = await readFile(file, "utf8");
    if (source.includes("llm_invoke_messages")) owners.push(file);
  }

  assert.deepEqual(owners, [authorityFile]);
  const authoritySource = await readFile(authorityFile, "utf8");
  assert.match(authoritySource, /authority:\s*"model_invoke_port"/);
  assert.match(authoritySource, /return target\.invoke\(\.\.\.args\)/);
});
