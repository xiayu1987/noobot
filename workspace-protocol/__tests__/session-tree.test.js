/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import { SESSION_CALLER } from "@noobot/shared/session-caller";
import {
  SESSION_TREE_ERROR,
  WORKSPACE_LAYOUT,
  collectSessionTreeBranch,
  createSessionTreeNode,
  normalizeSessionTree,
  requireSessionTreeNode,
  resolveSessionDirSegments,
  resolveSessionTreeChain,
  resolveSessionTreeDepth,
  resolveSessionTreePlacement,
} from "../src/index.js";

function node(sessionId, parentSessionId, caller = SESSION_CALLER.USER) {
  return { sessionId, parentSessionId, caller };
}

function treeOf(...nodes) {
  return normalizeSessionTree({ nodes: Object.fromEntries(nodes.map((n) => [n.sessionId, n])) });
}

const tree = treeOf(
  node("rootA", ""),
  node("branchB", "rootA", SESSION_CALLER.BOT),
  node("leafC", "branchB"),
  node("siblingD", "rootA"),
);

const isShapeError = (error) =>
  error instanceof TypeError && error.code === SESSION_TREE_ERROR.INVALID_SHAPE;

test("normalizeSessionTree keeps exactly sessionId, parentSessionId and caller", () => {
  assert.deepEqual(tree.nodes.branchB, {
    sessionId: "branchB",
    parentSessionId: "rootA",
    caller: SESSION_CALLER.BOT,
  });
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
    { nodes: {}, extra: true },
  ]) {
    assert.throws(() => normalizeSessionTree(invalid), isShapeError);
  }
});

test("normalizeSessionTree rejects incomplete, extra or mismatched node fields", () => {
  for (const invalidNode of [
    { sessionId: "s1", parentSessionId: "" },
    { ...node("s1", ""), extra: 1 },
    node("other", ""),
  ]) {
    assert.throws(() => normalizeSessionTree({ nodes: { s1: invalidNode } }), isShapeError);
  }
});

test("normalizeSessionTree rejects invalid caller and never rewrites ids", () => {
  assert.throws(
    () => normalizeSessionTree({ nodes: { s1: node("s1", "", "admin") } }),
    (error) => error.code === "SESSION_CALLER_INVALID",
  );
  assert.throws(
    () => normalizeSessionTree({ nodes: { " s1 ": node(" s1 ", "") } }),
    (error) => error.code === SESSION_TREE_ERROR.INVALID_SESSION_ID,
  );
  assert.throws(
    () => normalizeSessionTree({ nodes: { s1: node("s1", " p ") } }),
    (error) => error.code === SESSION_TREE_ERROR.INVALID_SESSION_ID,
  );
  assert.throws(
    () => normalizeSessionTree({ nodes: { s1: node("s1", null) } }),
    (error) => error.code === SESSION_TREE_ERROR.SESSION_ID_REQUIRED,
  );
});

test("createSessionTreeNode is the single node constructor", () => {
  assert.deepEqual(createSessionTreeNode(node("s1", "p1", SESSION_CALLER.BOT)), {
    sessionId: "s1",
    parentSessionId: "p1",
    caller: SESSION_CALLER.BOT,
  });
  assert.throws(
    () => createSessionTreeNode({ sessionId: "s1", parentSessionId: "" }),
    (error) => error.code === "SESSION_CALLER_INVALID",
  );
});

test("normalizeSessionTree rejects legacy schema fields", () => {
  for (const legacy of [
    { nodes: {}, roots: [] },
    { nodes: {}, updatedAt: "t" },
    { nodes: { s1: { ...node("s1", ""), children: [] } } },
    { nodes: { s1: { ...node("s1", ""), createdAt: "t" } } },
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
    () => resolveSessionTreeChain(tree, ""),
    (error) => error.code === SESSION_TREE_ERROR.SESSION_ID_REQUIRED,
  );
  assert.throws(
    () => resolveSessionTreeChain(tree, "ghost"),
    (error) =>
      error.code === SESSION_TREE_ERROR.NODE_MISSING && error.details.missingSessionId === "ghost",
  );
  const orphan = treeOf(node("child", "gone"));
  assert.throws(
    () => resolveSessionTreeChain(orphan, "child"),
    (error) =>
      error.code === SESSION_TREE_ERROR.NODE_MISSING && error.details.missingSessionId === "gone",
  );
  const cyclic = treeOf(node("a", "b"), node("b", "a"));
  assert.throws(
    () => resolveSessionTreeChain(cyclic, "a"),
    (error) => error.code === SESSION_TREE_ERROR.CYCLE,
  );
});

test("requireSessionTreeNode returns the registered node and rejects missing ones", () => {
  assert.equal(requireSessionTreeNode(tree, "branchB"), tree.nodes.branchB);
  assert.throws(
    () => requireSessionTreeNode(tree, "ghost"),
    (error) =>
      error.code === SESSION_TREE_ERROR.NODE_MISSING && error.details.missingSessionId === "ghost",
  );
  assert.throws(
    () => requireSessionTreeNode(tree, ""),
    (error) => error.code === SESSION_TREE_ERROR.SESSION_ID_REQUIRED,
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
  assert.throws(
    () => collectSessionTreeBranch(tree, ""),
    (error) => error.code === SESSION_TREE_ERROR.SESSION_ID_REQUIRED,
  );
});

test("resolveSessionTreePlacement places registered and unregistered sessions", () => {
  assert.deepEqual(resolveSessionTreePlacement(tree, "leafC", ""), ["rootA", "branchB", "leafC"]);
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
  assert.deepEqual(resolveSessionTreePlacement(tree, "draft", ""), ["draft"]);
  assert.throws(
    () => resolveSessionTreePlacement(tree, "draft"),
    (error) => error.code === SESSION_TREE_ERROR.SESSION_ID_REQUIRED,
  );
  assert.throws(
    () => resolveSessionTreePlacement(tree, "leafC", "rootA"),
    (error) => error.code === SESSION_TREE_ERROR.PARENT_MISMATCH,
  );
  assert.throws(
    () => resolveSessionTreePlacement(tree, "newE", "ghost"),
    (error) => error.code === SESSION_TREE_ERROR.PARENT_MISSING,
  );
});

test("session ids must be workspace path segments and are never rewritten", () => {
  for (const invalid of ["s:1", "../escape", "a/b", ".hidden"]) {
    assert.throws(
      () => resolveSessionTreePlacement(tree, invalid, ""),
      (error) => error.code === SESSION_TREE_ERROR.INVALID_SESSION_ID,
    );
  }
  assert.throws(
    () => resolveSessionTreePlacement(tree, "newE", "../rootA"),
    (error) => error.code === SESSION_TREE_ERROR.INVALID_SESSION_ID,
  );
  assert.throws(
    () => treeOf(node("leaf", "../up")),
    (error) => error.code === SESSION_TREE_ERROR.INVALID_SESSION_ID,
  );
});
