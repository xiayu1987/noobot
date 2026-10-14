#!/usr/bin/env node
/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveRepoRoot } from "./lib/repo-root.mjs";

const CJK_RE = /[\u4e00-\u9fff]/;
const SOURCE_EXT_RE = /\.(?:js|mjs|cjs|ts|tsx|vue)$/;

export const EXEMPT_PATH_RULES = Object.freeze([
  { pattern: /(^|\/)(?:__tests__|tests?|e2e)\//, reason: "test fixtures" },
  { pattern: /\.(?:test|spec)\.[cm]?[jt]sx?$/, reason: "test files" },
  { pattern: /^i18n\//, reason: "shared i18n catalog package" },
  { pattern: /(^|\/)(?:i18n|locales)\//, reason: "package-local i18n catalogs" },
  { pattern: /(^|\/)i18n\.js$/, reason: "package-local i18n catalogs" },
  { pattern: /^(?:agent\/|service\/)?scripts\//, reason: "developer scripts and guard markers" },
  { pattern: /^workflow\/examples\//, reason: "runnable examples" },
]);

export const ALLOWED_FILES = Object.freeze({
  "agent/src/shared/utils/text-cleaner.js": "matches Chinese web page boilerplate",
  "agent/src/shared/utils/web/text-cleaner.js": "matches Chinese web page boilerplate",
  "agent/src/tools/collaboration/user-interaction-tool.js": "matches Chinese secret field names",
  "client/shared/electron/dependencies/detect.js": "parses localized Windows registry output",
  "client/shared/electron/dependencies/installer.js": "parses localized installer output",
  "client/startup/src/components/SuperAdminSetupForm.vue": "language endonym",
  "memory-protocol/src/experience/fields.js": "default user experience field model",
  "memory-protocol/src/experience/schema.js": "persisted memory document labels",
  "memory-protocol/src/long-memory.js": "default long memory field model",
  "memory-repair/src/document-migration.js": "legacy memory document title for migration",
  "model-runtime/src/diagnostics/model-access.js": "bilingual diagnostic errors",
  "sanitize/src/index.js": "matches Chinese PII field names",
  "service/cli/interaction-prompt.js": "accepts Chinese yes/no replies",
  "user-template/default-user/services/web-search-service-handler.js":
    "self-contained bilingual service template",
});

export function isExemptPath(filePath) {
  return EXEMPT_PATH_RULES.some(({ pattern }) => pattern.test(filePath));
}

export function findCjkLines(text = "") {
  const hits = [];
  String(text)
    .split(/\r?\n/)
    .forEach((line, index) => {
      if (CJK_RE.test(line)) hits.push({ line: index + 1, text: line.trim() });
    });
  return hits;
}

export function evaluateCjkLiterals(files = [], readText, { allowedFiles = ALLOWED_FILES } = {}) {
  const violations = [];
  const usedEntries = new Set();
  for (const filePath of files) {
    if (!SOURCE_EXT_RE.test(filePath) || isExemptPath(filePath)) continue;
    const hits = findCjkLines(readText(filePath));
    if (!hits.length) continue;
    if (Object.hasOwn(allowedFiles, filePath)) {
      usedEntries.add(filePath);
      continue;
    }
    violations.push({ file: filePath, hits });
  }
  const staleEntries = Object.keys(allowedFiles).filter((entry) => !usedEntries.has(entry));
  return { violations, staleEntries };
}

function listTrackedFiles(root) {
  return execFileSync("git", ["ls-files", "-co", "--exclude-standard"], {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 1 << 28,
  })
    .split("\n")
    .filter(Boolean);
}

function readExistingText(root, filePath) {
  try {
    return readFileSync(path.join(root, filePath), "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") return "";
    throw error;
  }
}

function main() {
  const root = resolveRepoRoot();
  const { violations, staleEntries } = evaluateCjkLiterals(listTrackedFiles(root), (filePath) =>
    readExistingText(root, filePath),
  );
  for (const { file, hits } of violations) {
    console.error(`\n- ${file}`);
    for (const hit of hits.slice(0, 10)) console.error(`  ${hit.line}: ${hit.text}`);
    if (hits.length > 10) console.error(`  ... and ${hits.length - 10} more`);
  }
  for (const entry of staleEntries) console.error(`- stale CJK allowlist entry: ${entry}`);
  if (violations.length || staleEntries.length) {
    console.error("❌ Source CJK literal check failed: move user-facing text into i18n catalogs.");
    process.exit(1);
  }
  console.log("✅ source CJK literal check passed.");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
