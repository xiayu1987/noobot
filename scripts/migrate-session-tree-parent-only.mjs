#!/usr/bin/env node
/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import fs from "node:fs";
import path from "node:path";
import { WORKSPACE_LAYOUT } from "@noobot/workspace-protocol/layout";
import { parseMigrationArgs } from "./lib/migration-cli.mjs";

const TREE_FILE = "session-tree.json";
const { workspaceRoot, write, backupRoot } = parseMigrationArgs();

function listTreeFiles() {
  if (!fs.existsSync(workspaceRoot)) return [];
  return fs
    .readdirSync(workspaceRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(workspaceRoot, entry.name, WORKSPACE_LAYOUT.SESSION_DIR, TREE_FILE))
    .filter((file) => fs.existsSync(file));
}

function assertChildrenMatchParents(file, nodes) {
  for (const [sessionId, node] of Object.entries(nodes)) {
    const declared = [...(node.children || [])].map(String).sort();
    const derived = Object.entries(nodes)
      .filter(([, candidate]) => candidate.parentSessionId === sessionId)
      .map(([childId]) => childId)
      .sort();
    if (JSON.stringify(declared) !== JSON.stringify(derived)) {
      throw new Error(`${file}: children of ${sessionId} disagree with parentSessionId`);
    }
    const parentSessionId = String(node.parentSessionId || "").trim();
    if (parentSessionId && !nodes[parentSessionId]) {
      throw new Error(`${file}: ${sessionId} points to missing parent ${parentSessionId}`);
    }
  }
}

function migrateTree(file) {
  const tree = JSON.parse(fs.readFileSync(file, "utf8"));
  const nodes = tree.nodes || {};
  const legacy = "roots" in tree || Object.values(nodes).some((node) => "children" in node);
  if (!legacy) return null;
  assertChildrenMatchParents(file, nodes);
  const next = {
    nodes: Object.fromEntries(
      Object.entries(nodes).map(([sessionId, node]) => [
        sessionId,
        {
          sessionId,
          parentSessionId: String(node.parentSessionId || "").trim(),
          createdAt: node.createdAt,
          updatedAt: node.updatedAt,
        },
      ]),
    ),
    updatedAt: tree.updatedAt,
  };
  if (write) {
    const backupFile = path.join(backupRoot, path.relative(workspaceRoot, file));
    fs.mkdirSync(path.dirname(backupFile), { recursive: true });
    fs.copyFileSync(file, backupFile);
    const stagingFile = `${file}.parent-only.tmp`;
    fs.writeFileSync(stagingFile, `${JSON.stringify(next, null, 2)}\n`);
    fs.renameSync(stagingFile, file);
  }
  return { file: path.relative(workspaceRoot, file), nodes: Object.keys(next.nodes).length };
}

const migrated = listTreeFiles().map(migrateTree).filter(Boolean);
console.log(
  JSON.stringify({ workspaceRoot, write, legacyTrees: migrated.length, migrated }, null, 2),
);
