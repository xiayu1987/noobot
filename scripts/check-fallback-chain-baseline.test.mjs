/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  compareWithBaseline,
  findFallbackChains,
  renderModuleSection,
  replaceModuleSection,
} from "./check-fallback-chain-baseline.mjs";

test("detects cross-field and cross-source fallback chains in value position", () => {
  assert.equal(
    findFallbackChains("const id = ctx.runConfig.executionId || ctx.executionId;").length,
    1,
  );
  assert.equal(findFallbackChains("const id = a?.sessionId ?? b?.sessionId ?? '';").length, 1);
  assert.equal(findFallbackChains("call(x.name || x.id || 'node');").length, 1);
  assert.equal(findFallbackChains("const v = (a.x || b.x) || c.x;").length, 1);
});

test("ignores single-field defaults, constant tables and condition positions", () => {
  assert.equal(findFallbackChains("const v = item.label || '';").length, 0);
  assert.equal(findFallbackChains("const v = error?.message || ERROR_CODES.FAILED;").length, 0);
  assert.equal(findFallbackChains("if (a.x || b.x) run();").length, 0);
  assert.equal(findFallbackChains("const v = a.x || b.x ? 1 : 2;").length, 0);
  assert.equal(findFallbackChains("const v = !(a.x || b.x);").length, 0);
  assert.equal(findFallbackChains("const v = ready && (a.x || b.x);").length, 0);
});

test("scans vue script blocks", () => {
  const source =
    "<template><div /></template>\n<script>\nexport const v = a.x || b.x;\n</script>\n";
  assert.equal(findFallbackChains(source, "Component.vue").length, 1);
});

test("baseline only allows decreases and flags stale entries", () => {
  const { increases, decreases } = compareWithBaseline(
    { "a.js": 3, "c.js": 1 },
    { "a.js": 2, "b.js": 4 },
  );
  assert.deepEqual(increases, ["a.js: 3 exceeds baseline 2", "c.js: 1 exceeds baseline 0"]);
  assert.deepEqual(decreases, ["b.js: 0 below baseline 4"]);
});

test("module table is generated from the baseline", () => {
  const baseline = { "agent/src/a.js": 2, "plugin/noobot-plugin-workflow/src/b.js": 1 };
  const section = renderModuleSection(baseline);
  assert.match(section, /总计：3 条，2 个文件。/);
  assert.match(section, /\| `agent` \| 1 \| 2 \|/);
  assert.match(section, /\| `plugin\/noobot-plugin-workflow` \| 1 \| 1 \|/);
  const doc =
    "head\n<!-- fallback-chain-modules:start -->\nold\n<!-- fallback-chain-modules:end -->\ntail";
  assert.equal(replaceModuleSection(doc, baseline), `head\n${section}\ntail`);
  assert.throws(() => replaceModuleSection("no markers", baseline), /missing module markers/);
});
