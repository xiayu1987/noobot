#!/usr/bin/env node
/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { existsSync } from "node:fs";
import path from "node:path";
import { resolveRepoRoot } from "./lib/repo-root.mjs";
import { ignorePathParts, runForbiddenLineGuard } from "./lib/guard-scan.mjs";

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
runForbiddenLineGuard({
  label: "check-attachment-protocol-fields",
  root: ROOT,
  directories: TARGET_DIRS,
  scan: { extensions: CODE_EXT, ignoredPathParts: IGNORE_PATH_PARTS },
  rulesFor: () => FORBIDDEN_LINE_PATTERNS,
  guidance: [
    "Attachment metadata aliases are forbidden outside the versioned attachment protocol.",
    "All producers and consumers must use canonical attachment fields.",
  ],
  violations,
});
