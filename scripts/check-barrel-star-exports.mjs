/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

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
const starExportPattern = /^export\s+\*\s+from\s+"(\.[^"]+)"/gm;

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

async function loadNamespace(absolute) {
  try {
    return await import(pathToFileURL(absolute).href);
  } catch {
    return null;
  }
}

export async function inspectBarrel({ root, barrel }) {
  const absolute = path.join(root, barrel.relative);
  const barrelNamespace = await loadNamespace(absolute);
  if (!barrelNamespace) return { relative: barrel.relative, skipped: true, dropped: [] };
  const exported = new Set(Object.keys(barrelNamespace));
  const origins = new Map();
  for (const source of barrel.sources) {
    const namespace = await loadNamespace(path.resolve(path.dirname(absolute), source));
    if (!namespace) return { relative: barrel.relative, skipped: true, dropped: [] };
    for (const name of Object.keys(namespace)) {
      if (name === "default") continue;
      if (!origins.has(name)) origins.set(name, []);
      origins.get(name).push(source);
    }
  }
  const dropped = [...origins]
    .filter(([name, sources]) => sources.length > 1 && !exported.has(name))
    .map(([name, sources]) => ({ name, sources }));
  return { relative: barrel.relative, skipped: false, dropped };
}

export async function checkRepository({ root, ignoredDirectories } = {}) {
  const barrels = collectBarrels({ root, ignoredDirectories });
  const violations = [];
  let skipped = 0;
  for (const barrel of barrels) {
    const result = await inspectBarrel({ root, barrel });
    if (result.skipped) skipped += 1;
    else if (result.dropped.length) violations.push(result);
  }
  return { barrels: barrels.length, skipped, violations };
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

const invokedDirectly =
  process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;

if (invokedDirectly) {
  const { barrels, skipped, violations } = await checkRepository({ root: repositoryRoot });
  if (violations.length) {
    console.error(formatViolations(violations));
    process.exit(1);
  }
  const suffix = skipped ? `, ${skipped} skipped` : "";
  console.log(`Barrel star exports passed (${barrels} barrels${suffix})`);
}
