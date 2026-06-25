#!/usr/bin/env node
/*
 * semantic-transfer protocol field guard.
 *
 * The runtime protocol field for semantic-transfer payloads is transferEnvelopes.
 * Legacy compatibility fields must not re-enter frontend/backend source chains.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

function exists(filePath) {
  try {
    statSync(filePath);
    return true;
  } catch {
    return false;
  }
}

function resolveRepoRoot() {
  const cwd = process.cwd();
  if (exists(path.join(cwd, "package.json")) && exists(path.join(cwd, "scripts"))) return cwd;
  const parent = path.dirname(cwd);
  if (exists(path.join(parent, "package.json")) && exists(path.join(parent, "scripts"))) return parent;
  return cwd;
}

const ROOT = resolveRepoRoot();
const TARGET_DIRS = [
  "agent/src",
  "service",
  "agent-proxy",
  "client/noobot-chat/src",
  "plugin/noobot-plugin-harness/src",
  "plugin/noobot-plugin-workflow/src",
  "plugin/noobot-plugin-workflow/frontend",
];
const CODE_EXT = new Set([".js", ".mjs", ".cjs", ".ts", ".tsx", ".vue"]);
const IGNORE_PATH_PARTS = [
  `${path.sep}node_modules${path.sep}`,
  `${path.sep}.git${path.sep}`,
  `${path.sep}dist${path.sep}`,
  `${path.sep}build${path.sep}`,
  `${path.sep}coverage${path.sep}`,
  `${path.sep}vendor${path.sep}`,
  `${path.sep}generated${path.sep}`,
  `${path.sep}__tests__${path.sep}`,
  `${path.sep}tests${path.sep}`,
];
const FORBIDDEN_FIELDS = [
  { field: "transferResult", regex: /\btransferResult\b/ },
  { field: "nodeResultTransferResult", regex: /\bnodeResultTransferResult\b/ },
];

function toPosix(filePath) {
  return filePath.split(path.sep).join("/");
}

function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
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

const violations = [];
for (const relDir of TARGET_DIRS) {
  const dir = path.join(ROOT, relDir);
  for (const file of walk(dir)) {
    const rel = toPosix(path.relative(ROOT, file));
    const lines = readFileSync(file, "utf8").split(/\r?\n/);
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];
      for (const item of FORBIDDEN_FIELDS) {
        if (!item.regex.test(line)) continue;
        violations.push({
          field: item.field,
          file: rel,
          line: index + 1,
          text: line.trim(),
        });
      }
    }
  }
}

if (violations.length) {
  console.error("[check-semantic-transfer-protocol-fields] failed");
  console.error("semantic-transfer protocol fields must use transferEnvelopes only.");
  console.error("Remove legacy transferResult/nodeResultTransferResult compatibility from source chains.");
  for (const violation of violations.slice(0, 80)) {
    console.error(`- ${violation.file}:${violation.line} ${violation.field}: ${violation.text}`);
  }
  if (violations.length > 80) {
    console.error(`... and ${violations.length - 80} more violation(s)`);
  }
  process.exit(1);
}

console.log("[check-semantic-transfer-protocol-fields] ok");
