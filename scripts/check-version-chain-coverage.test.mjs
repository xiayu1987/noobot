/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  CHECK,
  measureLayoutHandlers,
  measureLayoutSequence,
  measureVersionChains,
} from "./check-version-chain-coverage.mjs";
import { emptyRuleMeasurements } from "./quality/check-protocol.mjs";

const CHAIN_FILE = "demo-protocol/src/demo-migration.js";
const CHAIN_SOURCE = "export const DEMO_CHAIN = defineVersionChain({});";
const chain = { kind: "demo", byFrom: new Map([[1], [2]]) };
const load = async () => chain;

function chainTest(source) {
  return { file: "demo-protocol/__tests__/demo.test.js", source };
}

test("chain steps without a version sample in an importing test are reported", async () => {
  const measured = emptyRuleMeasurements(CHECK);
  await measureVersionChains(measured, {
    sources: [{ file: CHAIN_FILE, source: CHAIN_SOURCE }],
    tests: [
      chainTest('import { x } from "@noobot/demo-protocol/demo-migration";\n({ version: 1 });'),
    ],
    load,
  });
  assert.equal(measured.uncoveredChainStep.total, 1);
  assert.match(measured.uncoveredChainStep.samples[0], /v2->v3/);
});

test("version samples in tests that do not import the chain module do not count", async () => {
  const measured = emptyRuleMeasurements(CHECK);
  await measureVersionChains(measured, {
    sources: [{ file: CHAIN_FILE, source: CHAIN_SOURCE }],
    tests: [chainTest("({ version: 1 }); ({ version: 2 });")],
    load,
  });
  assert.equal(measured.uncoveredChainStep.total, 2);
});

test("relative imports with a .js suffix cover chain steps", async () => {
  const measured = emptyRuleMeasurements(CHECK);
  await measureVersionChains(measured, {
    sources: [{ file: CHAIN_FILE, source: CHAIN_SOURCE }],
    tests: [chainTest('import "../src/demo-migration.js";\n({ version: 1 }); ({ version: 2 });')],
    load,
  });
  assert.equal(measured.uncoveredChainStep.total, 0);
});

test("layout upgrades must be contiguous up to the layout version", () => {
  const measured = emptyRuleMeasurements(CHECK);
  measureLayoutSequence(measured, {
    upgrades: [
      { id: "a-v2", toVersion: 2 },
      { id: "b-v4", toVersion: 4 },
    ],
    layoutVersion: 5,
  });
  assert.equal(measured.layoutUpgradeGap.total, 2);
});

test("layout owners need a bound handler that an agent test calls", () => {
  const measured = emptyRuleMeasurements(CHECK);
  measureLayoutHandlers(measured, {
    handlers: "[WORKSPACE_LAYOUT_UPGRADE_OWNER.BOUND]: upgradeBound,",
    tests: [{ file: "agent/__tests__/other.test.js", source: "upgradeOther();" }],
    owners: { BOUND: "bound", MISSING: "missing" },
  });
  assert.equal(measured.uncoveredLayoutUpgrade.total, 2);
  assert.match(measured.uncoveredLayoutUpgrade.samples.join("\n"), /upgradeBound.*not exercised/);
  assert.match(measured.uncoveredLayoutUpgrade.samples.join("\n"), /missing has no handler/);
});
