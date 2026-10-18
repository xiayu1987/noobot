/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { init, parse } from "es-module-lexer";
import {
  addHit,
  defineCheck,
  emptyRuleMeasurements,
  runCheckWhenMain,
} from "./quality/check-protocol.mjs";
import { repositoryRoot } from "./quality/repository-files.mjs";
import { getFirstPartyProductionFiles } from "./quality/source-inventory.mjs";

const MODULE_EXTENSIONS = Object.freeze([".js", ".mjs"]);

function resolveRelativeImport(fromModule, specifier) {
  return path.posix.normalize(path.posix.join(path.posix.dirname(fromModule), specifier));
}

async function buildImportGraph(root, modules) {
  await init;
  const graph = new Map();
  for (const modulePath of modules) {
    const [imports] = parse(await readFile(path.join(root, modulePath), "utf8"), modulePath);
    const dependencies = imports
      .map(({ specifier }) => specifier)
      .filter((specifier) => typeof specifier === "string" && specifier.startsWith("."))
      .map((specifier) => resolveRelativeImport(modulePath, specifier))
      .filter((dependency) => modules.has(dependency));
    graph.set(modulePath, dependencies);
  }
  return graph;
}

function canonicalCycle(ring) {
  const rotations = ring.map((_, index) => [...ring.slice(index), ...ring.slice(0, index)]);
  rotations.sort((left, right) => left.join("\n").localeCompare(right.join("\n")));
  return rotations[0];
}

function findCycles(graph) {
  const visited = new Set();
  const active = new Set();
  const stack = [];
  const cycles = new Map();
  const visit = (modulePath) => {
    if (active.has(modulePath)) {
      const ring = canonicalCycle(stack.slice(stack.indexOf(modulePath)));
      cycles.set(ring.join("\n"), ring);
      return;
    }
    if (visited.has(modulePath)) return;
    active.add(modulePath);
    stack.push(modulePath);
    for (const dependency of graph.get(modulePath)) visit(dependency);
    stack.pop();
    active.delete(modulePath);
    visited.add(modulePath);
  };
  for (const modulePath of graph.keys()) visit(modulePath);
  return [...cycles.values()].sort((left, right) =>
    left.join("\n").localeCompare(right.join("\n")),
  );
}

export async function measureSourceCycles(root, files) {
  const measured = emptyRuleMeasurements(CHECK);
  const graph = await buildImportGraph(root, new Set(files));
  for (const ring of findCycles(graph)) {
    addHit(measured.importCycle, { file: ring[0], message: [...ring, ring[0]].join(" -> ") });
  }
  return measured;
}

async function measure() {
  const files = await getFirstPartyProductionFiles({
    repositoryRoot,
    extensions: MODULE_EXTENSIONS,
  });
  return measureSourceCycles(repositoryRoot, files);
}

export const CHECK = defineCheck({
  id: "source-cycles",
  description: "First-party production modules have no relative import cycles",
  rules: {
    importCycle: {
      description: "Production modules import each other through a relative import cycle",
      hint: "move the shared fact into a leaf module that both sides import",
    },
  },
  exemptions: [],
  baseline: { importCycle: 0, exemptions: 0 },
  measure,
});

await runCheckWhenMain(CHECK, import.meta.url);
