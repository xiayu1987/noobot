#!/usr/bin/env node
/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import { collectSourceFiles, ignorePathParts } from "./lib/guard-scan.mjs";

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
  "agent/src",
  "service",
  "agent-proxy",
  "client/noobot-chat/src",
  "plugin/noobot-plugin-harness/src",
  "plugin/noobot-plugin-workflow/src",
  "plugin/noobot-plugin-workflow/frontend",
];
const CODE_EXT = new Set([".js", ".mjs", ".cjs", ".ts", ".tsx", ".vue"]);
const IGNORE_PATH_PARTS = ignorePathParts(["vendor", "generated", "__tests__", "tests"]);
const FORBIDDEN_FIELDS = [
  { field: "transferResult", regex: /\btransferResult\b/ },
  { field: "nodeResultTransferResult", regex: /\bnodeResultTransferResult\b/ },
];
const ATTACHMENT_LEGACY_FIELDS = [
  { field: "attachmentMetas", regex: /\battachmentMetas\b/ },
  { field: "inputAttachmentMetas", regex: /\binputAttachmentMetas\b/ },
  { field: "attachment_metas", regex: /\battachment_metas\b/ },
  { field: "AttachmentMetas", regex: /\bAttachmentMetas\b/ },
];
const ATTACHMENT_LEGACY_ALLOWED_PREFIXES = ["agent/src/artifacts/"];
const ATTACHMENT_LEGACY_ALLOWED_FILES = new Set([
  "agent/src/artifacts/runtime/artifact-service.js",
]);

function isAttachmentLegacyAllowed(relPath = "") {
  return (
    ATTACHMENT_LEGACY_ALLOWED_FILES.has(relPath) ||
    ATTACHMENT_LEGACY_ALLOWED_PREFIXES.some((prefix) => relPath.startsWith(prefix))
  );
}

function toPosix(filePath) {
  return filePath.split(path.sep).join("/");
}

function collectLineViolations(line, items, file, lineNumber, violations) {
  for (const item of items) {
    if (item.regex.test(line)) {
      violations.push({
        field: item.field,
        file,
        line: lineNumber,
        text: line.trim(),
      });
    }
  }
}

const violations = [];
const scannedFiles = collectSourceFiles(
  TARGET_DIRS.map((relDir) => path.join(ROOT, relDir)),
  { extensions: CODE_EXT, ignoredPathParts: IGNORE_PATH_PARTS },
);
if (!scannedFiles.length) {
  console.error("[check-semantic-transfer-protocol-fields] failed");
  console.error("no source files matched the scan targets; check TARGET_DIRS");
  process.exit(1);
}
for (const file of scannedFiles) {
  const rel = toPosix(path.relative(ROOT, file));
  const lines = readFileSync(file, "utf8").split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    collectLineViolations(line, FORBIDDEN_FIELDS, rel, index + 1, violations);
    if (!isAttachmentLegacyAllowed(rel)) {
      collectLineViolations(line, ATTACHMENT_LEGACY_FIELDS, rel, index + 1, violations);
    }
  }
}

if (violations.length) {
  console.error("[check-semantic-transfer-protocol-fields] failed");
  console.error("semantic-transfer protocol fields must use transferEnvelopes only.");
  console.error(
    "Remove legacy transferResult/nodeResultTransferResult and attachmentMetas compatibility from source chains.",
  );
  console.error(
    "attachmentMetas/inputAttachmentMetas may only exist inside attach/semantic-transfer adapter boundaries.",
  );
  for (const violation of violations.slice(0, 80)) {
    console.error(`- ${violation.file}:${violation.line} ${violation.field}: ${violation.text}`);
  }
  if (violations.length > 80) {
    console.error(`... and ${violations.length - 80} more violation(s)`);
  }
  process.exit(1);
}

console.log("[check-semantic-transfer-protocol-fields] ok");
