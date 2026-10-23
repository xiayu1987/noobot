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

const pluginRoot = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
const projectRoot = path.resolve(pluginRoot, "../..");

const SCAN_ROOTS = [path.join(pluginRoot, "src"), path.join(pluginRoot, "frontend")];

const SCAN_EXTENSIONS = new Set([".js", ".vue"]);

const LEGACY_FIELD_PATTERN = /\b(?:dialogId|nodeDialogId)\b/;
const OLD_ENTRYPOINT_PATTERN =
  /\b(?:workflowDialogId|selectedDialogId|selectedGraphDialogId|stepDialogIds|_stepDialogIds|nodeRunByDialogId)\b|selected-dialog-id|selected-graph-dialog-id/;

const AGENT_SCAN_ROOT = path.join(projectRoot, "agent/src");

async function listSourceFiles(root) {
  const entries = await readdir(root, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const absolutePath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listSourceFiles(absolutePath)));
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

test("workflow dialog process identity uses only canonical fields", async () => {
  const files = (await Promise.all(SCAN_ROOTS.map((root) => listSourceFiles(root)))).flat();
  const legacyFieldViolations = [];
  const oldEntrypointViolations = [];

  for (const filePath of files) {
    const content = await readFile(filePath, "utf8");
    legacyFieldViolations.push(
      ...matchingLines(content, LEGACY_FIELD_PATTERN).map((hit) => formatHit(filePath, hit)),
    );
    oldEntrypointViolations.push(
      ...matchingLines(content, OLD_ENTRYPOINT_PATTERN).map((hit) => formatHit(filePath, hit)),
    );
  }

  assert.deepEqual(
    legacyFieldViolations,
    [],
    "workflow source must use canonical dialog process identity fields",
  );
  assert.deepEqual(
    oldEntrypointViolations,
    [],
    "old workflow dialog entrypoint names must not reappear",
  );
});

test("agent source does not read or write legacy dialog process fields", async () => {
  const violations = [];
  for (const filePath of await listSourceFiles(AGENT_SCAN_ROOT)) {
    const content = await readFile(filePath, "utf8");
    violations.push(
      ...matchingLines(content, LEGACY_FIELD_PATTERN).map((hit) => formatHit(filePath, hit)),
    );
  }
  assert.deepEqual(
    violations,
    [],
    "agent source must use canonical dialog process identity fields",
  );
});
