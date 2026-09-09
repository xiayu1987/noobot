#!/usr/bin/env node
/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { existsSync, readFileSync, statSync } from "node:fs";
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
  "client/noobot-chat/src",
  "semantic-transfer-protocol/src",
  "service",
  "shared",
  "plugin-protocol/src",
  "plugin-runtime/src",
  "plugin/noobot-plugin-harness/src",
  "plugin/noobot-plugin-workflow/src",
  "plugin/noobot-plugin-workflow/frontend",
];
const CODE_EXT = new Set([".js", ".mjs", ".cjs", ".ts", ".tsx", ".vue"]);
const IGNORE_PATH_PARTS = ignorePathParts(["vendor", "generated", "__tests__", "tests"]);

const LEGACY_ATTACHMENT_FIELD_PATTERNS = [
  { field: "attachment_id", regex: /\battachment_id\b/ },
  { field: "file_id", regex: /\bfile_id\b/ },
  { field: "client_attachment_id", regex: /\bclient_attachment_id\b/ },
  { field: "content_sha256", regex: /\bcontent_sha256\b/ },
  { field: "attachment_source", regex: /\battachment_source\b/ },
  { field: "generation_source", regex: /\bgeneration_source\b/ },
  { field: "relative_path", regex: /\brelative_path\b/ },
  { field: "sandbox_path", regex: /\bsandbox_path\b/ },
  { field: "sandbox_view_path", regex: /\bsandbox_view_path\b/ },
  { field: "sandboxViewPath", regex: /\bsandboxViewPath\b/ },
  { field: "parsed_from_attachment_ids", regex: /\bparsed_from_attachment_ids\b/ },
];

const ATTACHMENT_SOURCE_LITERAL_PATTERNS = [
  {
    field: "attachmentSource_literal_assignment",
    regex: /\battachmentSource\b\s*:\s*(["'`])(?:model|user|subtask|email)\1/,
  },
  {
    field: "attachmentSource_literal_comparison",
    regex: /\battachmentSource\b[^\n]*?[=!]==?\s*(["'`])(?:model|user|subtask|email)\1/,
  },
  {
    field: "attachmentSource_literal_comparison_reversed",
    regex: /(["'`])(?:model|user|subtask|email)\1\s*[=!]==?\s*[^\n]*?\battachmentSource\b/,
  },
];

function toPosix(filePath) {
  return filePath.split(path.sep).join("/");
}

const violations = [];
const FORBIDDEN_PROTOCOL_FILES = ["attachment-protocol/src/attachment-model.js"];
for (const relativePath of FORBIDDEN_PROTOCOL_FILES) {
  if (existsSync(path.join(ROOT, relativePath))) {
    violations.push({
      field: "duplicate_attachment_model_entry",
      file: relativePath,
      line: 1,
      text: "attachment model must be owned by attachment-protocol/src/model.js",
    });
  }
}
const FORBIDDEN_LINE_PATTERNS = [
  ...LEGACY_ATTACHMENT_FIELD_PATTERNS,
  ...ATTACHMENT_SOURCE_LITERAL_PATTERNS,
];
const scannedFiles = collectSourceFiles(
  TARGET_DIRS.map((relDir) => path.join(ROOT, relDir)),
  { extensions: CODE_EXT, ignoredPathParts: IGNORE_PATH_PARTS },
);
if (!scannedFiles.length) {
  console.error("[check-attachment-protocol-fields] failed");
  console.error("no source files matched the scan targets; check TARGET_DIRS");
  process.exit(1);
}
for (const file of scannedFiles) {
  const rel = toPosix(path.relative(ROOT, file));
  const lines = readFileSync(file, "utf8").split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    for (const item of FORBIDDEN_LINE_PATTERNS) {
      if (!item.regex.test(line)) continue;
      violations.push({ field: item.field, file: rel, line: index + 1, text: line.trim() });
    }
  }
}

if (violations.length) {
  console.error("[check-attachment-protocol-fields] failed");
  console.error(
    "Attachment metadata aliases are forbidden outside the versioned attachment protocol.",
  );
  console.error("All producers and consumers must use canonical attachment fields.");
  for (const violation of violations.slice(0, 80)) {
    console.error(`- ${violation.file}:${violation.line} ${violation.field}: ${violation.text}`);
  }
  if (violations.length > 80) {
    console.error(`... and ${violations.length - 80} more violation(s)`);
  }
  process.exit(1);
}

console.log("[check-attachment-protocol-fields] ok");
