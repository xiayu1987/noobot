#!/usr/bin/env node
/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
/*
 * Cross-platform compatibility guard.
 *
 * This catches high-risk production-code patterns that commonly break on one
 * of Windows, macOS, or Linux. If a match is intentionally platform-specific,
 * add a nearby comment containing:
 *
 *   cross-platform-allow: <short reason>
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
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
const TARGET_DIRS = ["agent", "service", "agent-proxy", "model-proxy", "client", "plugin", "workflow"];
const CODE_EXT = new Set([".js", ".mjs", ".cjs", ".ts", ".tsx", ".vue"]);
const IGNORE_PATH_PARTS = [
  `${path.sep}node_modules${path.sep}`,
  `${path.sep}.git${path.sep}`,
  `${path.sep}dist${path.sep}`,
  `${path.sep}build${path.sep}`,
  `${path.sep}coverage${path.sep}`,
  `${path.sep}vendor${path.sep}`,
  `${path.sep}out${path.sep}`,
  `${path.sep}docs${path.sep}`,
  `${path.sep}__tests__${path.sep}`,
  `${path.sep}tests${path.sep}`,
];
const IGNORE_BASENAMES = new Set([
  "package.json",
  "package-lock.json",
]);

const RULES = [
  {
    id: "unix-temp-path",
    message: "Avoid hardcoded Unix temp paths in production code; use os.tmpdir() or an explicit platform-gated allow.",
    pattern: /(["'`])\/(?:tmp|var\/tmp)(?:\/)?\1/,
  },
  {
    id: "posix-command-v",
    message: "Avoid POSIX-only `command -v`; use a cross-platform command lookup or an explicit platform-gated allow.",
    pattern: /command\s+-v/,
  },
  {
    id: "bash-shell",
    message: "Avoid assuming bash exists on all platforms; gate Linux/container sandboxes or add an explicit allow.",
    pattern: /(["'`])bash\1|(["'`])-lc\2/,
  },
  {
    id: "signal-kill",
    message: "Signal-based process termination needs a Windows strategy or an explicit allow.",
    pattern: /\.kill\([^)]*["']SIG(?:TERM|KILL)["']/,
  },
  {
    id: "shell-spawn",
    message: "shell:true is platform-sensitive; prefer argv arrays or add an explicit allow.",
    pattern: /\bshell\s*:\s*true\b/,
  },
];
const PACKAGE_SCRIPT_RULES = [
  {
    id: "posix-parameter-expansion",
    message: "Avoid POSIX shell parameter expansion in npm scripts; use a Node launcher or cross-env style wrapper.",
    pattern: /\$\{[A-Za-z_][A-Za-z0-9_]*:-[^}]+}/,
  },
];

function toPosix(filePath) {
  return filePath.split(path.sep).join("/");
}

function rel(filePath) {
  return toPosix(path.relative(ROOT, filePath));
}

function walk(dir, out = []) {
  let entries = [];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (IGNORE_PATH_PARTS.some((part) => full.includes(part))) continue;
    if (entry.isDirectory()) {
      walk(full, out);
      continue;
    }
    if (!entry.isFile()) continue;
    if (IGNORE_BASENAMES.has(entry.name)) continue;
    if (!CODE_EXT.has(path.extname(entry.name).toLowerCase())) continue;
    out.push(full);
  }
  return out;
}

function stripBlockComments(line = "") {
  return line.replace(/\/\*.*?\*\//g, " ");
}

function hasAllowComment(lines, index) {
  const start = Math.max(0, index - 3);
  const end = Math.min(lines.length - 1, index + 1);
  for (let current = start; current <= end; current += 1) {
    if (/cross-platform-allow:\s+\S/i.test(lines[current] || "")) return true;
  }
  return false;
}

function scanFile(filePath) {
  const text = readFileSync(filePath, "utf8");
  const lines = text.split(/\r?\n/);
  const violations = [];
  for (let index = 0; index < lines.length; index += 1) {
    const rawLine = lines[index];
    const line = stripBlockComments(rawLine);
    if (/^\s*\/\//.test(line)) continue;
    if (hasAllowComment(lines, index)) continue;
    for (const rule of RULES) {
      if (!rule.pattern.test(line)) continue;
      violations.push({
        file: rel(filePath),
        line: index + 1,
        rule: rule.id,
        message: rule.message,
        source: rawLine.trim(),
      });
    }
  }
  return violations;
}

function scanPackageScripts(filePath) {
  let parsed = null;
  try {
    parsed = JSON.parse(readFileSync(filePath, "utf8"));
  } catch {
    return [];
  }
  const scripts = parsed?.scripts && typeof parsed.scripts === "object"
    ? parsed.scripts
    : {};
  const violations = [];
  for (const [scriptName, scriptCommand] of Object.entries(scripts)) {
    const command = String(scriptCommand || "");
    for (const rule of PACKAGE_SCRIPT_RULES) {
      if (!rule.pattern.test(command)) continue;
      violations.push({
        file: rel(filePath),
        line: 1,
        rule: rule.id,
        message: rule.message,
        source: `"${scriptName}": ${JSON.stringify(command)}`,
      });
    }
  }
  return violations;
}

const files = [];
const packageFiles = [path.join(ROOT, "package.json")];
for (const dir of TARGET_DIRS) {
  const full = path.join(ROOT, dir);
  if (!exists(full)) continue;
  walk(full, files);
  const packageFile = path.join(full, "package.json");
  if (exists(packageFile)) packageFiles.push(packageFile);
}

const violations = [
  ...files.flatMap(scanFile),
  ...packageFiles.flatMap(scanPackageScripts),
];

if (violations.length) {
  console.error("[check-cross-platform-compat] possible Windows/macOS/Linux compatibility issues:");
  for (const item of violations) {
    console.error(`- ${item.file}:${item.line} [${item.rule}] ${item.message}`);
    console.error(`  ${item.source}`);
  }
  console.error("\nFix the code or add a nearby `cross-platform-allow: <reason>` comment for intentional platform-specific code.");
  process.exit(1);
}

console.log("[check-cross-platform-compat] ok");
