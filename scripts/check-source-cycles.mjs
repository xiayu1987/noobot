/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { init, parse } from "es-module-lexer";

const root = path.resolve(import.meta.dirname, "..");
const sourceRoots = [
  "agent/src",
  "plugin/noobot-plugin-harness/src",
  "plugin/noobot-plugin-workflow/src",
];
const ignoredDirectories = new Set([
  "node_modules",
  "vendor",
  "dist",
  "build",
  "__tests__",
  "tests",
]);

async function collectModules(relativeDirectory, modules) {
  const absoluteDirectory = path.join(root, relativeDirectory);
  for (const entry of await readdir(absoluteDirectory, { withFileTypes: true })) {
    if (ignoredDirectories.has(entry.name)) continue;
    const relativePath = path.join(relativeDirectory, entry.name);
    if (entry.isDirectory()) {
      await collectModules(relativePath, modules);
    } else if (/\.(?:js|mjs)$/.test(entry.name)) {
      modules.add(path.normalize(relativePath));
    }
  }
}

function resolveLocalImport(fromModule, specifier, modules) {
  if (!specifier.startsWith(".")) return "";
  const resolved = path.normalize(path.join(path.dirname(fromModule), specifier));
  const candidates = [
    resolved,
    `${resolved}.js`,
    `${resolved}.mjs`,
    path.join(resolved, "index.js"),
  ];
  return candidates.find((candidate) => modules.has(candidate)) || "";
}

await init;
const modules = new Set();
for (const sourceRoot of sourceRoots) await collectModules(sourceRoot, modules);
const graph = new Map();
for (const modulePath of modules) {
  const source = await readFile(path.join(root, modulePath), "utf8");
  const [imports] = parse(source);
  const dependencies = [];
  for (const imported of imports) {
    const specifier = source.slice(imported.s, imported.e);
    const dependency = resolveLocalImport(modulePath, specifier, modules);
    if (dependency) dependencies.push(dependency);
  }
  graph.set(modulePath, dependencies);
}

const visited = new Set();
const active = new Set();
const stack = [];
const cycles = new Set();

function canonicalCycle(nodes) {
  const ring = nodes.slice(0, -1);
  const rotations = ring.map((_, index) => [...ring.slice(index), ...ring.slice(0, index)]);
  rotations.sort((left, right) => left.join("\n").localeCompare(right.join("\n")));
  const canonical = rotations[0] || [];
  return [...canonical, canonical[0]].join(" -> ");
}

function visit(modulePath) {
  if (active.has(modulePath)) {
    const start = stack.indexOf(modulePath);
    cycles.add(canonicalCycle([...stack.slice(start), modulePath]));
    return;
  }
  if (visited.has(modulePath)) return;
  active.add(modulePath);
  stack.push(modulePath);
  for (const dependency of graph.get(modulePath) || []) visit(dependency);
  stack.pop();
  active.delete(modulePath);
  visited.add(modulePath);
}

for (const modulePath of modules) visit(modulePath);
if (cycles.size) {
  console.error([...cycles].sort().join("\n"));
  process.exitCode = 1;
} else {
  console.log(`Source dependency cycles passed (${modules.size} modules)`);
}
