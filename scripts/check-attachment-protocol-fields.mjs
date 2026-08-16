#!/usr/bin/env node
/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
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
for (const relDir of TARGET_DIRS) {
  const dir = path.join(ROOT, relDir);
  for (const file of walk(dir)) {
    const rel = toPosix(path.relative(ROOT, file));
    const lines = readFileSync(file, "utf8").split(/\r?\n/);
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];
      for (const item of LEGACY_ATTACHMENT_FIELD_PATTERNS) {
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
