/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import fs from "node:fs";
import path from "node:path";
import { init, parse } from "es-module-lexer";
import { parse as parseJavaScript } from "espree";
import {
  addHit,
  defineCheck,
  emptyRuleMeasurements,
  runCheckWhenMain,
} from "./quality/check-protocol.mjs";
import { repositoryRoot } from "./quality/repository-files.mjs";
import { getFirstPartyCodeFiles } from "./quality/source-inventory.mjs";

const STAR_EXPORT_PATTERN = /^export\s+\*\s+from\s+["'](\.[^"']+)["']/gm;
const MIN_BARREL_STAR_SOURCES = 2;

function resolveRelativeModule(fromFile, specifier) {
  const resolved = path.resolve(path.dirname(fromFile), specifier);
  const candidates = path.extname(resolved)
    ? [resolved]
    : [resolved, `${resolved}.js`, path.join(resolved, "index.js")];
  const target = candidates.find((candidate) => fs.existsSync(candidate));
  if (!target) {
    throw new Error(`unable to resolve ${specifier} from ${fromFile}`);
  }
  return target;
}

function exportedNames(records) {
  return new Set(
    records
      .filter((record) => record.type !== "reexport-all" && record.name !== "default")
      .map((record) => record.name),
  );
}

function starSpecifiers(imports) {
  return imports
    .filter((record) => record.type === "reexport-star" && record.specifier.startsWith("."))
    .map((record) => record.specifier);
}

function parseModuleSource(absolute) {
  const source = fs.readFileSync(absolute, "utf8");
  try {
    parseJavaScript(source, { ecmaVersion: "latest", sourceType: "module" });
    return parse(source, absolute);
  } catch (error) {
    throw new Error(`unable to analyze ${absolute}: ${error.message}`, { cause: error });
  }
}

function addNamespaceOrigins(origins, namespace, source) {
  for (const name of namespace) {
    if (!origins.has(name)) origins.set(name, []);
    origins.get(name).push(source);
  }
}

async function collectStarOrigins(absolute, sources, state) {
  const origins = new Map();
  for (const source of sources) {
    const namespace = await loadStaticNamespace(resolveRelativeModule(absolute, source), state);
    addNamespaceOrigins(origins, namespace, source);
  }
  return origins;
}

function mergeNamespace(explicit, origins) {
  const namespace = new Set(explicit);
  for (const [name, owners] of origins) {
    if (explicit.has(name) || owners.length === 1) namespace.add(name);
  }
  return namespace;
}

async function loadStaticNamespace(absolute, state) {
  const { cache, resolving } = state;
  if (cache.has(absolute)) return cache.get(absolute);
  if (resolving.has(absolute)) {
    throw new Error(`circular star export cannot be analyzed: ${absolute}`);
  }
  if (path.extname(absolute) !== ".js" && path.extname(absolute) !== ".mjs") {
    throw new Error(`unsupported star export source: ${absolute}`);
  }
  resolving.add(absolute);
  try {
    await init;
    const [imports, exports] = parseModuleSource(absolute);
    const origins = await collectStarOrigins(absolute, starSpecifiers(imports), state);
    const namespace = mergeNamespace(exportedNames(exports), origins);
    cache.set(absolute, namespace);
    return namespace;
  } finally {
    resolving.delete(absolute);
  }
}

async function inspectBarrel(root, relative, sources) {
  const absolute = path.join(root, relative);
  const state = { cache: new Map(), resolving: new Set() };
  const exported = await loadStaticNamespace(absolute, state);
  const origins = await collectStarOrigins(absolute, sources, state);
  return [...origins].filter(([name, owners]) => owners.length > 1 && !exported.has(name));
}

export async function measureBarrelStarExports(root, files) {
  const measured = emptyRuleMeasurements(CHECK);
  for (const file of files) {
    const source = fs.readFileSync(path.join(root, file), "utf8");
    const sources = [...source.matchAll(STAR_EXPORT_PATTERN)].map((match) => match[1]);
    if (sources.length < MIN_BARREL_STAR_SOURCES) continue;
    for (const [name, owners] of await inspectBarrel(root, file, sources)) {
      addHit(measured.droppedStarExport, {
        file,
        message: `${name} exported by ${owners.join(" and ")}`,
      });
    }
  }
  return measured;
}

export const CHECK = defineCheck({
  id: "barrel-star-exports",
  description: "Barrels never lose a symbol to an ambiguous ESM star re-export",
  rules: {
    droppedStarExport: {
      description: "Two star sources of a barrel export the same name, so ESM drops it",
      hint: "re-export the colliding symbol explicitly, or rename it so one module owns the name",
    },
  },
  exemptions: [],
  baseline: { droppedStarExport: 0, exemptions: 0 },
  measure: async () =>
    measureBarrelStarExports(
      repositoryRoot,
      await getFirstPartyCodeFiles({ repositoryRoot, extensions: [".js"], includeTests: true }),
    ),
});

await runCheckWhenMain(CHECK, import.meta.url);
