#!/usr/bin/env node
/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
/*
 * Legacy time-key guard:
 * - Disallow direct legacy key reads like source.run_timeout_ms / source["run_timeout_ms"].
 * - Allow compatibility declarations via resolveTimeMs({ legacyKeys / legacyKey }) and
 *   explicit presence checks via hasOwnProperty.call(source, "run_timeout_ms").
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const TARGET_DIRS = ["agent", "service", "agent-proxy", "client", "plugin"];
const CODE_EXT = new Set([".js", ".mjs", ".cjs", ".ts", ".tsx"]);
const LEGACY_KEYS = [
  "run_timeout_ms",
  "wait_timeout_ms",
  "script_timeout_ms",
  "docker_lock_wait_timeout_ms",
  "start_timeout_ms",
  "idle_timeout_ms",
  "cleanup_interval_ms",
  "shutdown_grace_ms",
  "poll_interval_ms",
  "summarize_timeout_ms",
  "execution_bundle_timeout_ms",
  "timeout_ms",
];

const ALLOW_PATH_PARTS = [
  `${path.sep}__tests__${path.sep}`,
  `${path.sep}docs${path.sep}`,
  `${path.sep}config${path.sep}`,
  `${path.sep}node_modules${path.sep}`,
  `${path.sep}.git${path.sep}`,
  `${path.sep}dist${path.sep}`,
  `${path.sep}coverage${path.sep}`,
];

function walk(dir, out = []) {
  const entries = readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (ALLOW_PATH_PARTS.some((part) => full.includes(part))) continue;
      walk(full, out);
      continue;
    }
    if (!entry.isFile()) continue;
    const ext = path.extname(entry.name).toLowerCase();
    if (!CODE_EXT.has(ext)) continue;
    out.push(full);
  }
  return out;
}

function isAllowedLine(line = "") {
  const text = String(line || "");
  return (
    text.includes("legacyKeys") ||
    text.includes("legacyKey") ||
    text.includes("hasOwnProperty.call")
  );
}

function detectViolations(filePath) {
  const raw = readFileSync(filePath, "utf8");
  const lines = raw.split(/\r?\n/);
  const violations = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    for (const legacyKey of LEGACY_KEYS) {
      const directDot = new RegExp(`\\.${legacyKey}\\b`);
      const directBracket = new RegExp(`\\[\\s*["']${legacyKey}["']\\s*\\]`);
      if (!directDot.test(line) && !directBracket.test(line)) continue;
      if (isAllowedLine(line)) continue;
      violations.push({
        line: index + 1,
        key: legacyKey,
        text: line.trim(),
      });
    }
  }
  return violations;
}

function run() {
  const files = [];
  for (const dir of TARGET_DIRS) {
    const full = path.join(ROOT, dir);
    try {
      if (!statSync(full).isDirectory()) continue;
    } catch {
      continue;
    }
    walk(full, files);
  }

  const allViolations = [];
  for (const file of files) {
    const hits = detectViolations(file);
    if (!hits.length) continue;
    for (const hit of hits) {
      allViolations.push({
        file: path.relative(ROOT, file),
        ...hit,
      });
    }
  }

  if (!allViolations.length) {
    console.log("[check-legacy-time-keys] OK");
    return;
  }

  console.error("[check-legacy-time-keys] Found direct legacy time-key reads:");
  for (const item of allViolations) {
    console.error(`- ${item.file}:${item.line} [${item.key}] ${item.text}`);
  }
  process.exitCode = 1;
}

run();
