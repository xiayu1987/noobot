#!/usr/bin/env node
/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { spawnSync } from "node:child_process";
import { parse as parseSfc } from "@vue/compiler-sfc";
import { RUNTIME_PARAM_CATALOG } from "@noobot/shared/runtime-params";
import { DEVELOPMENT_THRESHOLDS } from "./lib/development-thresholds.mjs";
import {
  addHit,
  defineCheck,
  emptyRuleMeasurements,
  runCheckWhenMain,
} from "./quality/check-protocol.mjs";
import {
  readRepositoryJson,
  readRepositoryText,
  repositoryRoot,
} from "./quality/repository-files.mjs";
import { parseSource, SKIP_SUBTREE, walk } from "./quality/source-ast.mjs";
import { getFirstPartyCodeFiles, readRootWorkspacePaths } from "./quality/source-inventory.mjs";

const THRESHOLD_ROOTS = Object.freeze({
  LENGTH_THRESHOLDS: "length",
  QUANTITY_THRESHOLDS: "quantity",
  TIME_THRESHOLDS: "time",
  TURN_THRESHOLDS: "turn",
});
const EDITABLE_PARAM_KEYS = new Set(
  RUNTIME_PARAM_CATALOG.filter((entry) => entry.editable).map((entry) => entry.key),
);
const THRESHOLD_DECLARATION_FILES = /^shared\/(?:time|turn|quantity|length)-thresholds\.js$/;
const DEFERRED_SCOPES = new Set([
  "FunctionDeclaration",
  "FunctionExpression",
  "ArrowFunctionExpression",
]);
const ENTRY_WORKSPACES = new Set(["service", "agent-proxy", "model-proxy"]);
const SNAPSHOT_MISSING_MESSAGE = "runtime parameters must be initialized";

function isDeferredScope(node) {
  if (DEFERRED_SCOPES.has(node.type)) return true;
  return ["MethodDefinition", "PropertyDefinition"].includes(node.type) && !node.static;
}

function thresholdPath(node) {
  const path = [];
  let target = node;
  while (target.type === "MemberExpression") {
    if (target.computed) return null;
    path.unshift(target.property.name);
    target = target.object;
  }
  if (target.type !== "Identifier" || !Object.hasOwn(THRESHOLD_ROOTS, target.name)) return null;
  return { root: target.name, path };
}

function readsConfigurableLeaf({ root, path }) {
  return EDITABLE_PARAM_KEYS.has(`${THRESHOLD_ROOTS[root]}.${path.join(".")}`);
}

function moduleScopeRegions(file, text) {
  if (!file.endsWith(".vue")) return [{ source: text, lineOffset: 0 }];
  const { script } = parseSfc(text, { filename: file }).descriptor;
  return script ? [{ source: script.content, lineOffset: script.loc.start.line - 1 }] : [];
}

export function findModuleScopeThresholdReads(file, text) {
  const reads = [];
  for (const { source, lineOffset } of moduleScopeRegions(file, text)) {
    walk(parseSource(source, file.replace(/\.vue$/, ".js")), null, (node) => {
      if (isDeferredScope(node)) return SKIP_SUBTREE;
      if (node.type !== "MemberExpression") return undefined;
      const read = thresholdPath(node);
      if (!read) return undefined;
      if (readsConfigurableLeaf(read)) {
        reads.push({
          line: lineOffset + node.loc.start.line,
          key: `${read.root}.${read.path.join(".")}`,
        });
      }
      return SKIP_SUBTREE;
    });
  }
  return reads;
}

async function measureModuleScopeReads(measurement) {
  const files = await getFirstPartyCodeFiles({ repositoryRoot, includeTests: false });
  for (const file of files) {
    if (THRESHOLD_DECLARATION_FILES.test(file)) continue;
    const text = await readRepositoryText(file);
    if (!text.includes("_THRESHOLDS")) continue;
    for (const { line, key } of findModuleScopeThresholdReads(file, text)) {
      addHit(measurement, { file, line, message: `${key} is read at module scope` });
    }
  }
}

function workspaceExportFiles(workspace, declared) {
  const entries = typeof declared === "string" ? { ".": declared } : declared;
  return Object.entries(entries).flatMap(([subpath, target]) => {
    if (typeof target !== "string") {
      throw new TypeError(`${workspace} exports ${subpath} must map to a file path string`);
    }
    return /\.m?js$/.test(target) ? [`${workspace}/${target.replace(/^\.\//, "")}`] : [];
  });
}

async function libraryExportFiles() {
  const files = [];
  for (const workspace of await readRootWorkspacePaths(repositoryRoot)) {
    if (ENTRY_WORKSPACES.has(workspace) || workspace.startsWith("client/")) continue;
    const { exports: declared } = await readRepositoryJson(`${workspace}/package.json`);
    if (declared) files.push(...workspaceExportFiles(workspace, declared));
  }
  return files;
}

const IMPORT_PROBE = `
try { await import(process.argv[1]); process.stdout.write("null"); }
catch (error) { process.stdout.write(JSON.stringify(String(error?.message ?? error))); }
process.exit(0);
`;

function importFailureInFreshProcess(file) {
  const child = spawnSync(
    process.execPath,
    ["--input-type=module", "-e", IMPORT_PROBE, `file://${repositoryRoot}/${file}`],
    {
      cwd: repositoryRoot,
      encoding: "utf8",
      maxBuffer: DEVELOPMENT_THRESHOLDS.length.sourceInventoryOutputBytes,
    },
  );
  if (child.status !== 0) throw new Error(`import probe failed for ${file}: ${child.stderr}`);
  return JSON.parse(child.stdout);
}

async function measureImportsWithoutSnapshot(measurement) {
  for (const file of await libraryExportFiles()) {
    const message = importFailureInFreshProcess(file);
    if (message === null) continue;
    if (!message.startsWith(SNAPSHOT_MISSING_MESSAGE)) {
      throw new Error(`${file} failed to import for an unrelated reason: ${message}`);
    }
    addHit(measurement, { file, message });
  }
}

export const CHECK = defineCheck({
  id: "runtime-threshold-reads",
  description:
    "Configurable runtime thresholds are read when the code runs, never while a module loads",
  rules: {
    moduleScopeRead: {
      description: "a configurable threshold leaf is read at module scope",
      hint: "read *_THRESHOLDS.group.key inside the function that uses it; do not copy it into constants or config objects",
    },
    importWithoutSnapshot: {
      description:
        "a library export cannot be imported before the runtime parameter snapshot is installed",
      hint: "create threshold-dependent singletons in the entry composition, or read the threshold at call time",
    },
  },
  exemptions: [],
  baseline: { moduleScopeRead: 0, importWithoutSnapshot: 0, exemptions: 0 },
  measure: async () => {
    const measured = emptyRuleMeasurements(CHECK);
    await measureModuleScopeReads(measured.moduleScopeRead);
    await measureImportsWithoutSnapshot(measured.importWithoutSnapshot);
    return measured;
  },
});

await runCheckWhenMain(CHECK, import.meta.url);
