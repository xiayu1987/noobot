/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { normalizeSessionTreeEntity } from "../agent/src/session/entities/session-entity.js";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const migrationScript = path.join(repositoryRoot, "scripts/migrate-session-tree-parent-only.mjs");

function createWorkspace(tree) {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "session-tree-migration-"));
  const treeFile = path.join(workspaceRoot, "u1", "runtime", "session", "session-tree.json");
  fs.mkdirSync(path.dirname(treeFile), { recursive: true });
  fs.writeFileSync(treeFile, JSON.stringify(tree));
  return { workspaceRoot, treeFile };
}

const legacyTree = {
  roots: ["root"],
  nodes: {
    root: {
      sessionId: "root",
      parentSessionId: "",
      children: ["leaf"],
      createdAt: "c1",
      updatedAt: "u1",
    },
    leaf: {
      sessionId: "leaf",
      parentSessionId: "root",
      children: [],
      createdAt: "c2",
      updatedAt: "u2",
    },
  },
  updatedAt: "t",
};

test("rewrites legacy trees to parentSessionId only with backup", (t) => {
  const { workspaceRoot, treeFile } = createWorkspace(legacyTree);
  const backupRoot = fs.mkdtempSync(path.join(os.tmpdir(), "session-tree-backup-"));
  t.after(() => {
    fs.rmSync(workspaceRoot, { recursive: true, force: true });
    fs.rmSync(backupRoot, { recursive: true, force: true });
  });

  const dryRun = JSON.parse(
    execFileSync(process.execPath, [migrationScript, `--workspace=${workspaceRoot}`], {
      encoding: "utf8",
    }),
  );
  assert.equal(dryRun.legacyTrees, 1);
  assert.deepEqual(JSON.parse(fs.readFileSync(treeFile, "utf8")), legacyTree);

  execFileSync(process.execPath, [
    migrationScript,
    `--workspace=${workspaceRoot}`,
    `--backup=${backupRoot}`,
    "--write",
  ]);
  const migrated = JSON.parse(fs.readFileSync(treeFile, "utf8"));
  assert.deepEqual(migrated, {
    nodes: {
      root: { sessionId: "root", parentSessionId: "", createdAt: "c1", updatedAt: "u1" },
      leaf: { sessionId: "leaf", parentSessionId: "root", createdAt: "c2", updatedAt: "u2" },
    },
    updatedAt: "t",
  });
  assert.deepEqual(normalizeSessionTreeEntity(migrated).nodes, migrated.nodes);
  const backup = path.join(backupRoot, "u1", "runtime", "session", "session-tree.json");
  assert.deepEqual(JSON.parse(fs.readFileSync(backup, "utf8")), legacyTree);
});

test("refuses trees whose children disagree with parentSessionId", (t) => {
  const conflicting = structuredClone(legacyTree);
  conflicting.nodes.root.children = [];
  const { workspaceRoot, treeFile } = createWorkspace(conflicting);
  t.after(() => fs.rmSync(workspaceRoot, { recursive: true, force: true }));

  const result = spawnSync(process.execPath, [migrationScript, `--workspace=${workspaceRoot}`], {
    encoding: "utf8",
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /disagree with parentSessionId/);
  assert.deepEqual(JSON.parse(fs.readFileSync(treeFile, "utf8")), conflicting);
});

test("session tree entity rejects legacy roots/children", () => {
  assert.throws(() => normalizeSessionTreeEntity(legacyTree), /legacy session tree fields/);
});
