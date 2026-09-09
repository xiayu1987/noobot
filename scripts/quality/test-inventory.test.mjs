/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const repositoryRoot = path.resolve(import.meta.dirname, "../..");
const ignoredDirectories = new Set([
  ".git",
  "build",
  "coverage",
  "dist",
  "node_modules",
  "report",
  "test-results",
  "vendor",
  "workspace",
]);
const testFilePattern = /(?:\.test\.(?:js|mjs)|\.spec\.(?:js|ts))$/;

function collectTestFiles(root) {
  const files = [];
  const visit = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (entry.isDirectory() && ignoredDirectories.has(entry.name)) continue;
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(absolute);
      else if (entry.isFile() && testFilePattern.test(entry.name)) files.push(absolute);
    }
  };
  visit(root);
  return files;
}

function hasQuotedRecursiveGlob(command) {
  return /(["'])[^"']*\*\*[^"']*\1/.test(command);
}

test("every workspace with tests has a test script", () => {
  const rootPackage = JSON.parse(
    fs.readFileSync(path.join(repositoryRoot, "package.json"), "utf8"),
  );
  const missing = [];
  for (const relative of rootPackage.workspaces || []) {
    const packageRoot = path.join(repositoryRoot, relative);
    const packageFile = path.join(packageRoot, "package.json");
    if (!fs.existsSync(packageFile) || collectTestFiles(packageRoot).length === 0) continue;
    const workspacePackage = JSON.parse(fs.readFileSync(packageFile, "utf8"));
    if (!String(workspacePackage?.scripts?.test || "").trim()) missing.push(relative);
  }
  assert.deepEqual(missing, []);
});

test("recursive Node test globs are quoted for cross-shell discovery", () => {
  const rootPackage = JSON.parse(
    fs.readFileSync(path.join(repositoryRoot, "package.json"), "utf8"),
  );
  const unsafe = [];
  for (const relative of rootPackage.workspaces || []) {
    const packageFile = path.join(repositoryRoot, relative, "package.json");
    if (!fs.existsSync(packageFile)) continue;
    const workspacePackage = JSON.parse(fs.readFileSync(packageFile, "utf8"));
    const command = String(workspacePackage?.scripts?.test || "");
    if (
      command.includes("node --test") &&
      command.includes("**") &&
      !hasQuotedRecursiveGlob(command)
    ) {
      unsafe.push(relative);
    }
  }
  assert.deepEqual(unsafe, []);
});
