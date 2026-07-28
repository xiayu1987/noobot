/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const pluginRoot = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const projectRoot = path.resolve(pluginRoot, "../..");

const SCAN_ROOTS = [
  path.join(pluginRoot, "src"),
  path.join(pluginRoot, "frontend"),
];

const SCAN_EXTENSIONS = new Set([".js", ".vue"]);

const LEGACY_FIELD_PATTERN = /\b(?:dialogId|nodeDialogId)\b/;
const OLD_ENTRYPOINT_PATTERN = /\b(?:workflowDialogId|selectedDialogId|selectedGraphDialogId|stepDialogIds|_stepDialogIds|nodeRunByDialogId)\b|selected-dialog-id|selected-graph-dialog-id/;

const ALLOWED_LEGACY_FIELD_FILES = new Set([
  path.normalize("src/core/dialog-process-compat.js"),
  path.normalize("frontend/components/workflow-message-card/workflowDialogProcessIdCompat.js"),
]);

const AGENT_COMPAT_FILES = [
  path.join(projectRoot, "agent/src/system-core/session/session-summary-builders.js"),
  path.join(projectRoot, "agent/src/system-core/session/services/session-message-service.js"),
];

const AGENT_COMPAT_ALLOWED_LINES = [
  /legacy plugin payloads|historical plugin payloads|historical payload snapshots|historical callers|New anchors must pass/,
  /\[.*"(?:nodeDialogId|dialogId)"/,
  /"(?:nodeDialogId|dialogId)"/,
  /dialogProcessId:\s*anchor\?\.dialogProcessId\s*\|\|\s*anchor\?\.dialogId/,
  /delete\s+targetMessage\.dialogId;/,
];

async function listSourceFiles(root) {
  const entries = await readdir(root, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const absolutePath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...await listSourceFiles(absolutePath));
      continue;
    }
    if (entry.isFile() && SCAN_EXTENSIONS.has(path.extname(entry.name))) {
      files.push(absolutePath);
    }
  }
  return files;
}

function matchingLines(content, pattern) {
  return content
    .split("\n")
    .map((line, index) => ({ line, lineNumber: index + 1 }))
    .filter(({ line }) => pattern.test(line));
}

function formatHit(filePath, hit) {
  return `${path.relative(projectRoot, filePath)}:${hit.lineNumber}: ${hit.line.trim()}`;
}

test("workflow dialog process legacy field usage stays inside compatibility boundaries", async () => {
  const files = (await Promise.all(SCAN_ROOTS.map((root) => listSourceFiles(root)))).flat();
  const legacyFieldViolations = [];
  const oldEntrypointViolations = [];

  for (const filePath of files) {
    const relativeToPlugin = path.normalize(path.relative(pluginRoot, filePath));
    const content = await readFile(filePath, "utf8");
    if (!ALLOWED_LEGACY_FIELD_FILES.has(relativeToPlugin)) {
      legacyFieldViolations.push(...matchingLines(content, LEGACY_FIELD_PATTERN).map((hit) => formatHit(filePath, hit)));
    }
    oldEntrypointViolations.push(...matchingLines(content, OLD_ENTRYPOINT_PATTERN).map((hit) => formatHit(filePath, hit)));
  }

  assert.deepEqual(legacyFieldViolations, [], "dialogId/nodeDialogId may only appear in workflow compatibility helpers");
  assert.deepEqual(oldEntrypointViolations, [], "old workflow dialog entrypoint names must not reappear");
});

test("agent dialog process legacy fields remain documented read-only compatibility", async () => {
  const violations = [];
  for (const filePath of AGENT_COMPAT_FILES) {
    const content = await readFile(filePath, "utf8");
    const hits = matchingLines(content, LEGACY_FIELD_PATTERN);
    for (const hit of hits) {
      if (!AGENT_COMPAT_ALLOWED_LINES.some((pattern) => pattern.test(hit.line))) {
        violations.push(formatHit(filePath, hit));
      }
    }
  }
  assert.deepEqual(violations, [], "agent dialogId/nodeDialogId mentions must stay in documented read-only history compatibility code");
});
