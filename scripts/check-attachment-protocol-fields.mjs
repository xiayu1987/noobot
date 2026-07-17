#!/usr/bin/env node
/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
/*
 * Attachment protocol field guard.
 *
 * Canonical attachment metadata should be emitted as camelCase fields:
 * attachmentId, clientAttachmentId, contentSha256, attachmentSource,
 * generationSource, relativePath, sandboxPath, isSandbox, updatedAt, etc.
 *
 * Legacy/snake_case aliases may be consumed only in explicit normalizer or
 * compatibility bridge files. If a new bridge is intentional, add it here with
 * a short reason.
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
];

const LEGACY_ATTACHMENT_FIELD_ALLOWED_FILES = new Map(Object.entries({
  "agent/src/system-core/attach/meta-ops.js":
    "central attachment metadata normalizer accepts legacy aliases and emits canonical fields",
  "agent/src/system-core/context/providers/attachment-resolver.js":
    "context user attachment resolver accepts legacy aliases before delegating to attachment mapper",
  "agent/src/system-core/session/transfer-attachment-refs.js":
    "session summary/detail compact bridge accepts legacy refs from historical messages",
  "agent/src/system-core/session/services/session-message-service.js":
    "session message compatibility strips/reads legacy snake_case fields from stored messages",
  "agent/src/system-core/session/session-summary-builders.js":
    "session summary compatibility reads historical parsed attachment refs",
  "agent/src/system-core/semantic-transfer/core/compact.js":
    "semantic-transfer model compact view accepts legacy attachment refs from envelope files",
  "agent/src/system-core/semantic-transfer/storage/transfer-path-view.js":
    "semantic-transfer path bridge consumes legacy attachment meta sandbox aliases",
  "agent/src/system-core/semantic-transfer/storage/attachment-adapter.js":
    "semantic-transfer attachment persistence bridge consumes legacy sandbox flag aliases",
  "client/noobot-chat/src/services/api/chatApi.js":
    "frontend upload API accepts backend/client legacy attachment field aliases",
  "client/noobot-chat/src/services/api/attachmentAccess.js":
    "frontend attachment access normalizer accepts legacy aliases and emits canonical access metadata",
  "client/noobot-chat/src/composables/infra/transferEnvelopes.js":
    "frontend semantic-transfer adapter consumes legacy envelope attachment meta aliases",
  "client/noobot-chat/src/composables/message/useMessageFiles.js":
    "frontend message file list keeps legacy attachment fallback for historical sessions",
  "plugin/noobot-plugin-workflow/src/core/hooks/attachments.js":
    "workflow central attachment/transfer bridge consumes legacy attachment aliases",
}));

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

function isAllowed(relPath = "") {
  return LEGACY_ATTACHMENT_FIELD_ALLOWED_FILES.has(relPath);
}

const violations = [];
for (const relDir of TARGET_DIRS) {
  const dir = path.join(ROOT, relDir);
  for (const file of walk(dir)) {
    const rel = toPosix(path.relative(ROOT, file));
    if (isAllowed(rel)) continue;
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
  console.error("Attachment metadata aliases must stay inside explicit compatibility/normalizer boundaries.");
  console.error("Emit canonical attachment fields outside those boundaries.");
  for (const violation of violations.slice(0, 80)) {
    console.error(`- ${violation.file}:${violation.line} ${violation.field}: ${violation.text}`);
  }
  if (violations.length > 80) {
    console.error(`... and ${violations.length - 80} more violation(s)`);
  }
  process.exit(1);
}

console.log("[check-attachment-protocol-fields] ok");
