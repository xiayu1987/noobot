#!/usr/bin/env node
/*
 * Agent concrete-plugin coupling guard
 *
 * Goal:
 * - Agent core must not add new direct knowledge of concrete plugins such as
 *   harness/workflow in main paths.
 * - No compatibility allowlist is maintained for concrete plugin terms in
 *   agent core. Remove the coupling instead of adding exceptions.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

function resolveRepoRoot() {
  const cwd = process.cwd();
  if (statExists(path.join(cwd, "agent", "src", "system-core"))) return cwd;
  if (path.basename(cwd) === "agent" && statExists(path.join(cwd, "src", "system-core"))) {
    return path.dirname(cwd);
  }
  const parent = path.dirname(cwd);
  if (statExists(path.join(parent, "agent", "src", "system-core"))) return parent;
  return cwd;
}

function statExists(filePath) {
  try {
    statSync(filePath);
    return true;
  } catch {
    return false;
  }
}

const ROOT = resolveRepoRoot();
const TARGET_ROOT = path.join(ROOT, "agent", "src", "system-core");
const CODE_EXT = new Set([".js", ".mjs", ".cjs", ".ts", ".tsx"]);
const IGNORE_PATH_PARTS = [
  `${path.sep}node_modules${path.sep}`,
  `${path.sep}.git${path.sep}`,
  `${path.sep}dist${path.sep}`,
  `${path.sep}build${path.sep}`,
  `${path.sep}coverage${path.sep}`,
  `${path.sep}__tests__${path.sep}`,
];

// Concrete plugin terms that must not appear in agent core.
// Keep this broad: it catches identifiers, strings, legacy relay labels, and
// plugin-specific header names.
const COUPLING_REGEX = /harness|workflow|Harness|Workflow|HARNESS|WORKFLOW|来自harness外部模型输出|Relay from harness/g;

function toPosix(filePath) {
  return filePath.split(path.sep).join("/");
}

function walk(dir, out = []) {
  const entries = readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (IGNORE_PATH_PARTS.some((part) => full.includes(part))) continue;
    if (entry.isDirectory()) {
      walk(full, out);
      continue;
    }
    if (!entry.isFile()) continue;
    if (!CODE_EXT.has(path.extname(entry.name).toLowerCase())) continue;
    out.push(full);
  }
  return out;
}

function collectMatches(text = "") {
  const matches = [];
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const found = [...line.matchAll(COUPLING_REGEX)].map((item) => item[0]);
    if (!found.length) continue;
    matches.push({ line: i + 1, terms: found, text: line.trim() });
  }
  return matches;
}

const violations = [];

for (const file of walk(TARGET_ROOT)) {
  const relPath = toPosix(path.relative(ROOT, file));
  const text = readFileSync(file, "utf8");
  const matches = collectMatches(text);
  const count = matches.reduce((sum, item) => sum + item.terms.length, 0);
  if (!count) continue;
  violations.push({ relPath, count, matches });
}

if (violations.length) {
  console.error("[check-agent-plugin-decoupling] concrete plugin coupling violations found:");
  for (const item of violations) {
    console.error(`- ${item.relPath}: ${item.count}`);
    for (const match of item.matches.slice(0, 8)) {
      console.error(`  ${match.line}: ${match.text}`);
    }
    if (item.matches.length > 8) console.error(`  ... ${item.matches.length - 8} more matching lines`);
  }
  console.error("\nAgent core has no concrete-plugin compatibility allowlist; remove the coupling.");
  process.exit(1);
}

console.log("[check-agent-plugin-decoupling] ok");
