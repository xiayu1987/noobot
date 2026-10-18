/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import { readdir } from "node:fs/promises";
import test from "node:test";
import { readRepositoryJson, repositoryPathExists } from "./repository-files.mjs";

const QUALITY_ENTRY = "check:quality";
const HOOK_ENTRIES = Object.freeze({
  "check-commit-message.mjs": {
    hook: "hooks/commit-msg",
    reason: "validates a commit message file passed by git, not repository sources",
  },
});

async function rootScripts() {
  return (await readRepositoryJson("package.json")).scripts;
}

function qualitySteps(scripts) {
  return scripts[QUALITY_ENTRY].split(" && ").map((step) => {
    const match = /^npm run -s ([\w:-]+)$/.exec(step);
    assert.ok(match, `${QUALITY_ENTRY} step must be "npm run -s <script>": ${step}`);
    return match[1];
  });
}

async function checkScriptFiles() {
  const entries = await readdir(new URL("..", import.meta.url));
  return entries.filter((name) => /^check-[\w-]+\.mjs$/.test(name) && !name.endsWith(".test.mjs"));
}

test("every check script runs from check:quality exactly once", async () => {
  const scripts = await rootScripts();
  const steps = qualitySteps(scripts);
  assert.deepEqual(
    steps.filter((step, index) => steps.indexOf(step) !== index),
    [],
  );
  const reached = [];
  for (const step of steps) {
    assert.ok(scripts[step], `${QUALITY_ENTRY} references missing script ${step}`);
    const match = /^node \.\/scripts\/(check-[\w-]+\.mjs)$/.exec(scripts[step]);
    if (match) reached.push(match[1]);
  }
  const missing = [];
  for (const file of await checkScriptFiles()) {
    if (HOOK_ENTRIES[file]) {
      assert.equal(reached.includes(file), false, `${file} is a hook entry, not a quality step`);
      continue;
    }
    if (reached.filter((name) => name === file).length !== 1) missing.push(file);
  }
  assert.deepEqual(missing, []);
});

test("hook entry exemptions name an existing hook and a reason", async () => {
  const files = await checkScriptFiles();
  for (const [file, entry] of Object.entries(HOOK_ENTRIES)) {
    assert.ok(files.includes(file), `${file} no longer exists; drop its exemption`);
    assert.ok(entry.reason.trim());
    assert.equal(await repositoryPathExists(entry.hook), true, `${entry.hook} is missing`);
  }
});

test("test:all runs tests only and leaves repository checks to check:quality", async () => {
  const scripts = await rootScripts();
  assert.doesNotMatch(scripts["test:all"], /\bcheck:|scripts\/check-/);
});
