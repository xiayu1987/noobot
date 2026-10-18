/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  SESSION_TREE_ERROR,
  WORKSPACE_LAYOUT,
  collectSessionTreeBranch,
  normalizeSessionTree,
  resolveSessionDirSegments,
  resolveSessionTreeChain,
  resolveSessionTreeDepth,
  resolveSessionTreePlacement,
} from "../src/index.js";

const tree = normalizeSessionTree({
  nodes: {
    rootA: { parentSessionId: "" },
    branchB: { parentSessionId: "rootA" },
    leafC: { parentSessionId: " branchB " },
    siblingD: { parentSessionId: "rootA" },
  },
});

test("normalizeSessionTree keeps only sessionId and parentSessionId", () => {
  const normalized = normalizeSessionTree({
    nodes: { " s1 ": { parentSessionId: " p ", extra: 1 }, "": { parentSessionId: "" } },
  });
  assert.deepEqual(normalized, { nodes: { s1: { sessionId: "s1", parentSessionId: "p" } } });
});

test("normalizeSessionTree rejects non-object tree, nodes or node", () => {
  for (const invalid of [
    undefined,
    null,
    [],
    {},
    { nodes: null },
    { nodes: [] },
    { nodes: { s1: null } },
  ]) {
    assert.throws(
      () => normalizeSessionTree(invalid),
      (error) => error instanceof TypeError && error.code === SESSION_TREE_ERROR.INVALID_SHAPE,
    );
  }
});

test("normalizeSessionTree rejects legacy schema fields", () => {
  for (const legacy of [
    { nodes: {}, roots: [] },
    { nodes: {}, updatedAt: "t" },
    { nodes: { s1: { parentSessionId: "", children: [] } } },
    { nodes: { s1: { parentSessionId: "", createdAt: "t" } } },
  ]) {
    assert.throws(
      () => normalizeSessionTree(legacy),
      (error) => error instanceof TypeError && error.code === SESSION_TREE_ERROR.LEGACY_SCHEMA,
    );
  }
});

test("resolveSessionTreeChain returns the root-first chain", () => {
  assert.deepEqual(resolveSessionTreeChain(tree, "leafC"), ["rootA", "branchB", "leafC"]);
  assert.deepEqual(resolveSessionTreeChain(tree, "rootA"), ["rootA"]);
  assert.equal(resolveSessionTreeDepth(tree, "leafC"), 3);
});

test("resolveSessionDirSegments nests every level under SESSION_DIR", () => {
  assert.deepEqual(resolveSessionDirSegments(tree, "leafC"), [
    WORKSPACE_LAYOUT.SESSION_DIR,
    "rootA",
    "branchB",
    "leafC",
  ]);
});

test("resolveSessionTreeChain rejects missing sessionId, missing nodes and cycles", () => {
  assert.throws(
    () => resolveSessionTreeChain(tree, " "),
    (error) => error.code === SESSION_TREE_ERROR.SESSION_ID_REQUIRED,
  );
  assert.throws(
    () => resolveSessionTreeChain(tree, "ghost"),
    (error) =>
      error.code === SESSION_TREE_ERROR.NODE_MISSING && error.details.missingSessionId === "ghost",
  );
  const orphan = normalizeSessionTree({ nodes: { child: { parentSessionId: "gone" } } });
  assert.throws(
    () => resolveSessionTreeChain(orphan, "child"),
    (error) =>
      error.code === SESSION_TREE_ERROR.NODE_MISSING && error.details.missingSessionId === "gone",
  );
  const cyclic = normalizeSessionTree({
    nodes: { a: { parentSessionId: "b" }, b: { parentSessionId: "a" } },
  });
  assert.throws(
    () => resolveSessionTreeChain(cyclic, "a"),
    (error) => error.code === SESSION_TREE_ERROR.CYCLE,
  );
});

test("collectSessionTreeBranch returns the session and all descendants breadth-first", () => {
  assert.deepEqual(collectSessionTreeBranch(tree, "rootA"), [
    "rootA",
    "branchB",
    "siblingD",
    "leafC",
  ]);
  assert.deepEqual(collectSessionTreeBranch(tree, "leafC"), ["leafC"]);
  assert.deepEqual(collectSessionTreeBranch(tree, ""), []);
});

test("resolveSessionTreePlacement places registered and unregistered sessions", () => {
  assert.deepEqual(resolveSessionTreePlacement(tree, "leafC"), ["rootA", "branchB", "leafC"]);
  assert.deepEqual(resolveSessionTreePlacement(tree, "leafC", "branchB"), [
    "rootA",
    "branchB",
    "leafC",
  ]);
  assert.deepEqual(resolveSessionTreePlacement(tree, "newE", "leafC"), [
    "rootA",
    "branchB",
    "leafC",
    "newE",
  ]);
  assert.deepEqual(resolveSessionTreePlacement(tree, "draft"), ["draft"]);
  assert.throws(
    () => resolveSessionTreePlacement(tree, "leafC", "rootA"),
    (error) => error.code === SESSION_TREE_ERROR.PARENT_MISMATCH,
  );
  assert.throws(
    () => resolveSessionTreePlacement(tree, "newE", "ghost"),
    (error) => error.code === SESSION_TREE_ERROR.NODE_MISSING,
  );
});

test("session ids must be workspace path segments and are never rewritten", () => {
  for (const invalid of ["s:1", "../escape", "a/b", ".hidden"]) {
    assert.throws(
      () => resolveSessionTreePlacement(tree, invalid),
      (error) => error.code === SESSION_TREE_ERROR.INVALID_SESSION_ID,
    );
  }
  assert.throws(
    () => resolveSessionTreePlacement(tree, "newE", "../rootA"),
    (error) => error.code === SESSION_TREE_ERROR.INVALID_SESSION_ID,
  );
  const poisoned = normalizeSessionTree({ nodes: { leaf: { parentSessionId: "../up" } } });
  assert.throws(
    () => resolveSessionTreeChain(poisoned, "leaf"),
    (error) => error.code === SESSION_TREE_ERROR.INVALID_SESSION_ID,
  );
});
