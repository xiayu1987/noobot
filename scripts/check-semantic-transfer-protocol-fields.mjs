#!/usr/bin/env node
/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { resolveRepoRoot } from "./lib/repo-root.mjs";
import { ignorePathParts, runForbiddenLineGuard } from "./lib/guard-scan.mjs";

const ROOT = resolveRepoRoot();
const TARGET_DIRS = [
  "agent/src",
  "semantic-transfer-protocol/src",
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
  { field: "allowCustom", regex: /\ballowCustom\b/ },
  { field: "defaultGenerationSource", regex: /\bdefaultGenerationSource\b/ },
];
const ATTACHMENT_LEGACY_FIELDS = [
  { field: "attachmentMetas", regex: /\battachmentMetas\b/ },
  { field: "inputAttachmentMetas", regex: /\binputAttachmentMetas\b/ },
  { field: "attachment_metas", regex: /\battachment_metas\b/ },
  { field: "AttachmentMetas", regex: /\bAttachmentMetas\b/ },
];
const ATTACHMENT_LEGACY_ALLOWED_PREFIXES = ["agent/src/artifacts/"];

function isAttachmentLegacyAllowed(relPath) {
  return ATTACHMENT_LEGACY_ALLOWED_PREFIXES.some((prefix) => relPath.startsWith(prefix));
}

runForbiddenLineGuard({
  label: "check-semantic-transfer-protocol-fields",
  root: ROOT,
  directories: TARGET_DIRS,
  scan: { extensions: CODE_EXT, ignoredPathParts: IGNORE_PATH_PARTS },
  rulesFor: (relPath) =>
    isAttachmentLegacyAllowed(relPath)
      ? FORBIDDEN_FIELDS
      : [...FORBIDDEN_FIELDS, ...ATTACHMENT_LEGACY_FIELDS],
  guidance: [
    "semantic-transfer protocol fields must use transferEnvelopes only.",
    "Remove legacy transferResult/nodeResultTransferResult and attachmentMetas compatibility from source chains.",
    "attachmentMetas/inputAttachmentMetas may only exist inside attach/semantic-transfer adapter boundaries.",
  ],
});
