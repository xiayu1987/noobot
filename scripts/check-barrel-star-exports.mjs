/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { init, parse } from "es-module-lexer";
import { parse as parseJavaScript } from "espree";

const repositoryRoot = path.resolve(import.meta.dirname, "..");
const defaultIgnoredDirectories = [
  ".git",
  "assets",
  "build",
  "coverage",
  "dist",
  "node_modules",
  "report",
  "test-results",
  "vendor",
  "workspace",
];
const starExportPattern = /^export\s+\*\s+from\s+["'](\.[^"']+)["']/gm;

export function collectBarrels({ root, ignoredDirectories = defaultIgnoredDirectories }) {
  const ignored = new Set(ignoredDirectories);
  const barrels = [];
  const visit = (relative) => {
    for (const entry of fs.readdirSync(path.join(root, relative), { withFileTypes: true })) {
      if (ignored.has(entry.name)) continue;
      const child = path.join(relative, entry.name);
      if (entry.isDirectory()) {
        visit(child);
        continue;
      }
      if (!entry.name.endsWith(".js")) continue;
      const source = fs.readFileSync(path.join(root, child), "utf8");
      const sources = [...source.matchAll(starExportPattern)].map((match) => match[1]);
      if (sources.length >= 2) barrels.push({ relative: child, sources });
    }
  };
  visit(".");
  return barrels;
}

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

function exportedNames(records = []) {
  return new Set(
    records
      .map((record) => String(record?.n || "").trim())
      .filter((name) => name && name !== "default"),
  );
}

function starSpecifiers(source, imports = []) {
  return imports
    .filter((record) => {
      if (!record?.n || !String(record.n).startsWith(".")) return false;
      return /^\s*export\s*\*/.test(source.slice(record.ss, record.se));
    })
    .map((record) => record.n);
}

async function loadStaticNamespace(absolute, state = {}) {
  const cache = state.cache || (state.cache = new Map());
  const resolving = state.resolving || (state.resolving = new Set());
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
    const source = fs.readFileSync(absolute, "utf8");
    let imports;
    let exports;
    try {
      parseJavaScript(source, { ecmaVersion: "latest", sourceType: "module" });
      [imports, exports] = parse(source, absolute);
    } catch (error) {
      throw new Error(`unable to analyze ${absolute}: ${error?.message || error}`, {
        cause: error,
      });
    }
    const explicit = exportedNames(exports);
    const origins = new Map();
    for (const specifier of starSpecifiers(source, imports)) {
      const target = resolveRelativeModule(absolute, specifier);
      const namespace = await loadStaticNamespace(target, state);
      for (const name of namespace) {
        if (!origins.has(name)) origins.set(name, 0);
        origins.set(name, origins.get(name) + 1);
      }
    }
    const namespace = new Set(explicit);
    for (const [name, count] of origins) {
      if (explicit.has(name) || count === 1) namespace.add(name);
    }
    cache.set(absolute, namespace);
    return namespace;
  } finally {
    resolving.delete(absolute);
  }
}

async function loadNamespaceNames(absolute, state = {}) {
  try {
    const namespace = await import(pathToFileURL(absolute).href);
    return new Set(Object.keys(namespace).filter((name) => name !== "default"));
  } catch {
    return loadStaticNamespace(absolute, state);
  }
}

export async function inspectBarrel({ root, barrel }) {
  const absolute = path.join(root, barrel.relative);
  const state = { cache: new Map(), resolving: new Set() };
  const exported = await loadNamespaceNames(absolute, state);
  const origins = new Map();
  for (const source of barrel.sources) {
    const sourceFile = resolveRelativeModule(absolute, source);
    const namespace = await loadNamespaceNames(sourceFile, state);
    for (const name of namespace) {
      if (!origins.has(name)) origins.set(name, []);
      origins.get(name).push(source);
    }
  }
  const dropped = [...origins]
    .filter(([name, sources]) => sources.length > 1 && !exported.has(name))
    .map(([name, sources]) => ({ name, sources }));
  return { relative: barrel.relative, dropped };
}

export async function checkRepository({ root, ignoredDirectories } = {}) {
  const barrels = collectBarrels({ root, ignoredDirectories });
  const violations = [];
  for (const barrel of barrels) {
    const result = await inspectBarrel({ root, barrel });
    if (result.dropped.length) violations.push(result);
  }
  return { barrels: barrels.length, violations };
}

export function formatViolations(violations) {
  const lines = ["Barrel star export collisions detected (symbols silently dropped by ESM):"];
  for (const violation of violations) {
    lines.push(`  ${violation.relative}`);
    for (const entry of violation.dropped) {
      lines.push(`    ${entry.name} exported by ${entry.sources.join(" and ")}`);
    }
  }
  lines.push(
    "Re-export the colliding symbol explicitly, or rename it so a single module owns the name.",
  );
  return lines.join("\n");
}

const invokedDirectly = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;

if (invokedDirectly) {
  const { barrels, violations } = await checkRepository({ root: repositoryRoot });
  if (violations.length) {
    console.error(formatViolations(violations));
    process.exit(1);
  }
  console.log(`Barrel star exports passed (${barrels} barrels)`);
}
