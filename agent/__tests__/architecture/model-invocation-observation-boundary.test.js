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

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const authorityFile = path.join(
  projectRoot,
  "model-runtime/src/executor/model-request-executor.js",
);
const protocolConstantsFile = path.join(projectRoot, "model-protocol/src/protocol/constants.js");
const productionRoots = [
  path.join(projectRoot, "agent/src"),
  path.join(projectRoot, "model-runtime/src"),
  path.join(projectRoot, "plugin/noobot-plugin-harness/src"),
  path.join(projectRoot, "plugin/noobot-plugin-workflow/src"),
];

async function listJavaScriptFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const target = path.join(directory, entry.name);
      if (entry.isDirectory()) return listJavaScriptFiles(target);
      return entry.isFile() && entry.name.endsWith(".js") ? [target] : [];
    }),
  );
  return nested.flat();
}

test("model invocation observation has one provider-attempt authority", async () => {
  const files = (await Promise.all(productionRoots.map(listJavaScriptFiles))).flat();
  const stageEmitters = [];
  const stageLiterals = [];
  for (const file of files) {
    const source = await readFile(file, "utf8");
    if (source.includes("MODEL_CONTEXT_TRACE.INVOKE_STAGE")) stageEmitters.push(file);
    if (source.includes('"llm_invoke_messages"')) stageLiterals.push(file);
  }

  assert.deepEqual(stageEmitters, [authorityFile]);
  assert.deepEqual(stageLiterals, []);
  const protocolSource = await readFile(protocolConstantsFile, "utf8");
  assert.match(protocolSource, /INVOKE_STAGE:\s*"llm_invoke_messages"/);
  assert.match(protocolSource, /INVOKE_AUTHORITY:\s*"model_invoke_port"/);
  const authoritySource = await readFile(authorityFile, "utf8");
  assert.match(authoritySource, /authority:\s*MODEL_CONTEXT_TRACE\.INVOKE_AUTHORITY/);
  assert.match(authoritySource, /runModelAttempt\(/);
});
