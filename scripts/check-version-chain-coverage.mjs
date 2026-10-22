#!/usr/bin/env node
/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  WORKSPACE_LAYOUT_UNMARKED_VERSION,
  WORKSPACE_LAYOUT_UPGRADE_OWNER,
  WORKSPACE_LAYOUT_UPGRADES,
} from "../workspace-protocol/src/layout-migration.js";
import { WORKSPACE_LAYOUT_VERSION } from "../workspace-protocol/src/layout.js";
import {
  addHit,
  defineCheck,
  emptyRuleMeasurements,
  runCheckWhenMain,
} from "./quality/check-protocol.mjs";
import { readRepositoryText, repositoryRoot } from "./quality/repository-files.mjs";
import { getFirstPartyCodeFiles, isTestFilePath } from "./quality/source-inventory.mjs";

const LAYOUT_HANDLER_FILE = "agent/src/workspace-lifecycle/sections.js";
const CHAIN_EXPORT = /export\s+const\s+([A-Z][A-Z0-9_]*)\s*=\s*defineVersionChain\(/g;

function packageRootOf(file) {
  const parts = file.split("/");
  const sourceIndex = parts.indexOf("src");
  return sourceIndex > 0 ? parts.slice(0, sourceIndex).join("/") : parts[0];
}

function testsImporting(tests, file) {
  const moduleStem = path.posix.basename(file, path.posix.extname(file));
  const importsModule = new RegExp(String.raw`["'][^"']*/${moduleStem}(?:\.js)?["']`);
  const root = `${packageRootOf(file)}/`;
  return tests.filter(
    ({ file: testFile, source }) => testFile.startsWith(root) && importsModule.test(source),
  );
}

async function loadChain(file, name) {
  return (await import(pathToFileURL(path.join(repositoryRoot, file))))[name];
}

export async function measureVersionChains(measured, { sources, tests, load = loadChain }) {
  for (const { file, source } of sources) {
    for (const match of source.matchAll(CHAIN_EXPORT)) {
      const chain = await load(file, match[1]);
      const covering = testsImporting(tests, file);
      for (const from of chain.byFrom.keys()) {
        const sample = new RegExp(String.raw`\bversion:\s*${from}\b`);
        if (!covering.some(({ source: testSource }) => sample.test(testSource))) {
          addHit(measured.uncoveredChainStep, {
            file,
            message: `${chain.kind} v${from}->v${from + 1} has no version: ${from} sample in a test importing ${path.posix.basename(file)}`,
          });
        }
      }
    }
  }
}

export function measureLayoutSequence(
  measured,
  { upgrades = WORKSPACE_LAYOUT_UPGRADES, layoutVersion = WORKSPACE_LAYOUT_VERSION } = {},
) {
  const file = "workspace-protocol/src/layout-migration.js";
  let expected = WORKSPACE_LAYOUT_UNMARKED_VERSION + 1;
  for (const upgrade of upgrades) {
    if (upgrade.toVersion !== expected) {
      addHit(measured.layoutUpgradeGap, {
        file,
        message: `${upgrade.id} targets v${upgrade.toVersion}, expected v${expected}`,
      });
    }
    expected = upgrade.toVersion + 1;
  }
  if (expected - 1 !== layoutVersion) {
    addHit(measured.layoutUpgradeGap, {
      file,
      message: `upgrades end at v${expected - 1} but WORKSPACE_LAYOUT_VERSION is ${layoutVersion}`,
    });
  }
}

export function measureLayoutHandlers(
  measured,
  { handlers, tests, owners = WORKSPACE_LAYOUT_UPGRADE_OWNER },
) {
  for (const [key, owner] of Object.entries(owners)) {
    const binding = handlers.match(
      new RegExp(String.raw`\[WORKSPACE_LAYOUT_UPGRADE_OWNER\.${key}\]:\s*([\w$]+)`),
    );
    if (!binding) {
      addHit(measured.uncoveredLayoutUpgrade, {
        file: LAYOUT_HANDLER_FILE,
        message: `owner ${owner} has no handler`,
      });
      continue;
    }
    const call = new RegExp(String.raw`\b${binding[1]}\(`);
    if (!tests.some(({ file, source }) => file.startsWith("agent/") && call.test(source))) {
      addHit(measured.uncoveredLayoutUpgrade, {
        file: LAYOUT_HANDLER_FILE,
        message: `handler ${binding[1]} for ${owner} is not exercised by an agent test`,
      });
    }
  }
}

async function measure() {
  const measured = emptyRuleMeasurements(CHECK);
  const files = await getFirstPartyCodeFiles({ repositoryRoot });
  const sources = [];
  const tests = [];
  for (const file of files) {
    const entry = { file, source: await readRepositoryText(file) };
    (isTestFilePath(file) ? tests : sources).push(entry);
  }
  await measureVersionChains(measured, { sources, tests });
  measureLayoutSequence(measured);
  measureLayoutHandlers(measured, {
    handlers: await readRepositoryText(LAYOUT_HANDLER_FILE),
    tests,
  });
  return measured;
}

export const CHECK = defineCheck({
  id: "version-chain-coverage",
  description: "Every stored version bump is registered as a migration step with a tested sample",
  rules: {
    uncoveredChainStep: {
      description: "A defineVersionChain step has no test sample of its source version",
      hint: "add a test importing the chain module with a version: N input document",
    },
    layoutUpgradeGap: {
      description: "WORKSPACE_LAYOUT_UPGRADES is not contiguous up to WORKSPACE_LAYOUT_VERSION",
      hint: "register one upgrade per layout version in workspace-protocol layout-migration",
    },
    uncoveredLayoutUpgrade: {
      description: "A layout upgrade owner has no handler or its handler is untested",
      hint: "bind the owner in LAYOUT_UPGRADE_HANDLERS and exercise the handler in agent tests",
    },
  },
  exemptions: [],
  baseline: {
    uncoveredChainStep: 0,
    layoutUpgradeGap: 0,
    uncoveredLayoutUpgrade: 0,
    exemptions: 0,
  },
  measure,
});

await runCheckWhenMain(CHECK, import.meta.url);
