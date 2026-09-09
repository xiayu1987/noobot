#!/usr/bin/env node
/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import {
  collectSourceFiles,
  ignorePathParts,
  MISSING_DIRECTORY_POLICY,
} from "./lib/guard-scan.mjs";

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
  if (exists(path.join(parent, "package.json")) && exists(path.join(parent, "scripts")))
    return parent;
  return cwd;
}

const ROOT = resolveRepoRoot();
const TARGET_DIRS = [
  "platform-compatibility",
  "agent",
  "service",
  "agent-proxy",
  "model-proxy",
  "client",
  "plugin",
  "workflow",
];
const CODE_EXT = new Set([".js", ".mjs", ".cjs", ".ts", ".tsx", ".vue"]);
const IGNORE_PATH_PARTS = ignorePathParts(["vendor", "out", "docs", "__tests__", "tests"]);
const IGNORE_BASENAMES = new Set(["package.json", "package-lock.json"]);

const RULES = [
  {
    id: "unix-temp-path",
    message:
      "Avoid hardcoded Unix temp paths in production code; use os.tmpdir() or an explicit platform-gated allow.",
    pattern: /(["'`])\/(?:tmp|var\/tmp)(?:\/)?\1/,
  },
  {
    id: "posix-command-v",
    message:
      "Avoid POSIX-only `command -v`; use a cross-platform command lookup or an explicit platform-gated allow.",
    pattern: /command\s+-v/,
  },
  {
    id: "bash-shell",
    message:
      "Avoid assuming bash exists on all platforms; gate Linux/container sandboxes or add an explicit allow.",
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
    message:
      "Avoid POSIX shell parameter expansion in npm scripts; use a Node launcher or cross-env style wrapper.",
    pattern: /\$\{[A-Za-z_][A-Za-z0-9_]*:-[^}]+}/,
  },
];
const SOURCE_ALLOWLIST = new Map([
  ["platform-compatibility/src/platform.js", new Map([["bash-shell", [/^BASH: "bash",$/]]])],
  [
    "agent/src/tools/execution/script-tool/process-exec.js",
    new Map([
      [
        "shell-spawn",
        [/^return \{ executable: String\(command \|\| ""\), args: \[\], shell: true \};$/],
      ],
    ]),
  ],
  [
    "client/noobot-chat/src/modules/chat/composables/message/useMessagePreview/constants.js",
    new Map([["bash-shell", [/^"bash",$/]]]),
  ],
]);

function toPosix(filePath) {
  return filePath.split(path.sep).join("/");
}

function rel(filePath) {
  return toPosix(path.relative(ROOT, filePath));
}

function stripBlockComments(line = "") {
  return line.replace(/\/\*.*?\*\//g, " ");
}

function isAllowlisted(file, rule, source) {
  const patterns = SOURCE_ALLOWLIST.get(file)?.get(rule) || [];
  return patterns.some((pattern) => pattern.test(source));
}

function scanFile(filePath) {
  const text = readFileSync(filePath, "utf8");
  const lines = text.split(/\r?\n/);
  const violations = [];
  const relativePath = rel(filePath);
  for (let index = 0; index < lines.length; index += 1) {
    const rawLine = lines[index];
    const line = stripBlockComments(rawLine);
    if (/^\s*\/\//.test(line)) continue;
    for (const rule of RULES) {
      if (!rule.pattern.test(line)) continue;
      if (isAllowlisted(relativePath, rule.id, rawLine.trim())) continue;
      violations.push({
        file: relativePath,
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
  const scripts = parsed?.scripts && typeof parsed.scripts === "object" ? parsed.scripts : {};
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

const packageFiles = [path.join(ROOT, "package.json")];
for (const dir of TARGET_DIRS) {
  const full = path.join(ROOT, dir);
  if (!exists(full)) continue;
  const packageFile = path.join(full, "package.json");
  if (exists(packageFile)) packageFiles.push(packageFile);
}
const files = collectSourceFiles(
  TARGET_DIRS.map((dir) => path.join(ROOT, dir)),
  {
    extensions: CODE_EXT,
    ignoredPathParts: IGNORE_PATH_PARTS,
    ignoredBasenames: IGNORE_BASENAMES,
    missingDirectory: MISSING_DIRECTORY_POLICY.SKIP_UNREADABLE,
  },
);
if (!files.length) {
  console.error("[check-cross-platform-compat] failed");
  console.error("no source files matched the scan targets; check TARGET_DIRS");
  process.exit(1);
}

const violations = [...files.flatMap(scanFile), ...packageFiles.flatMap(scanPackageScripts)];

if (violations.length) {
  console.error("[check-cross-platform-compat] possible Windows/macOS/Linux compatibility issues:");
  for (const item of violations) {
    console.error(`- ${item.file}:${item.line} [${item.rule}] ${item.message}`);
    console.error(`  ${item.source}`);
  }
  console.error(
    "\nFix the code or add a narrowly matched entry to SOURCE_ALLOWLIST for intentional platform-specific code.",
  );
  process.exit(1);
}

console.log("[check-cross-platform-compat] ok");
