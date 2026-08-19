/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import {
  getFirstPartyCodeFiles,
  getFirstPartyProductionFiles,
  getFirstPartySourceRoots,
  isFirstPartyCodePath,
  isFirstPartyProductionPath,
} from "./source-inventory.mjs";

const repositoryRoot = path.resolve(import.meta.dirname, "../..");

test("source inventory is derived from root workspaces and includes protocol packages", async () => {
  const roots = await getFirstPartySourceRoots({ repositoryRoot });
  assert.ok(roots.includes("authoritative-state"));
  assert.ok(roots.includes("client/noobot-chat"));
  assert.ok(roots.includes("plugin/noobot-plugin-harness"));
  assert.ok(roots.includes("scripts"));
});

test("source inventory excludes tests, generated sources, dependencies, vendor, and runtime data", () => {
  assert.equal(isFirstPartyProductionPath("agent/src/runtime/turn/orchestrator.js"), true);
  assert.equal(isFirstPartyProductionPath("agent/__tests__/orchestrator.test.js"), false);
  assert.equal(
    isFirstPartyProductionPath("client/noobot-chat/src/plugins/generated/entries.js"),
    false,
  );
  assert.equal(isFirstPartyProductionPath("service/vendor/runtime.js"), false);
  assert.equal(isFirstPartyProductionPath("agent/node_modules/package/index.js"), false);
  assert.equal(isFirstPartyProductionPath("workspace/admin/runtime.js"), false);
});

test("production file collection includes authoritative state and excludes its tests", async () => {
  const files = await getFirstPartyProductionFiles({ repositoryRoot, extensions: [".js"] });
  assert.ok(files.includes("authoritative-state/src/domain/turn-lifecycle-entity.js"));
  assert.equal(
    files.some((file) => file.includes("/__tests__/")),
    false,
  );
  assert.equal(
    files.some((file) => file.includes("/node_modules/")),
    false,
  );
});

test("complete code inventory includes tests but still excludes generated and external files", async () => {
  assert.equal(isFirstPartyCodePath("agent/__tests__/orchestrator.test.js"), true);
  assert.equal(isFirstPartyCodePath("client/noobot-chat/tests/unit/example.spec.js"), true);
  assert.equal(isFirstPartyCodePath("agent/node_modules/package/index.js"), false);
  assert.equal(isFirstPartyCodePath("client/noobot-chat/src/plugins/generated/entries.js"), false);
  const files = await getFirstPartyCodeFiles({ repositoryRoot, extensions: [".js"] });
  assert.ok(files.includes("agent/__tests__/runtime/core/tool-runner.test.js"));
  assert.equal(
    files.some((file) => file.includes("/node_modules/")),
    false,
  );
});
