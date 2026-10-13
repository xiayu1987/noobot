/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";

import { SessionPathResolver } from "../../src/session/session-path-resolver.js";

function createResolverWithTree(tree = {}) {
  const pathResolver = {
    resolveBasePath(userId = "") {
      return path.join("/tmp", "workspace", String(userId || "").trim());
    },
    sessionRoot(basePath = "") {
      return path.join(basePath, "runtime/session");
    },
  };
  const treeRepository = {
    async getTree() {
      return tree;
    },
  };

  return new SessionPathResolver({ pathResolver, treeRepository });
}

test("resolveParentSessionId should throw when hinted parent is missing", async () => {
  const resolver = createResolverWithTree({
    nodes: { s1: { sessionId: "s1", parentSessionId: "" } },
  });

  await assert.rejects(
    () => resolver.resolveParentSessionId("u1", "s2", "missing-parent"),
    (error) => error?.code === "FATAL_PARENT_SESSION_MISSING",
  );
});

test("resolveParentSessionId should fallback to tree when hint not provided", async () => {
  const resolver = createResolverWithTree({
    nodes: {
      s1: { sessionId: "s1", parentSessionId: "" },
      s2: { sessionId: "s2", parentSessionId: "s1" },
    },
  });

  const parentSessionId = await resolver.resolveParentSessionId("u1", "s2");
  assert.equal(parentSessionId, "s1");
});

test("resolveSessionDir should resolve multi-level chain path", async () => {
  const resolver = createResolverWithTree({
    nodes: {
      rootA: { sessionId: "rootA", parentSessionId: "" },
      branchB: { sessionId: "branchB", parentSessionId: "rootA" },
      leafC: { sessionId: "leafC", parentSessionId: "branchB" },
    },
  });

  const dir = await resolver.resolveSessionDir("u1", "leafC");
  assert.equal(
    dir,
    path.join("/tmp", "workspace", "u1", "runtime/session", "rootA", "branchB", "leafC"),
  );
});

test("resolveSessionDir places an unregistered child under its parent chain", async () => {
  const resolver = createResolverWithTree({
    nodes: {
      rootA: { sessionId: "rootA", parentSessionId: "" },
      branchB: { sessionId: "branchB", parentSessionId: "rootA" },
    },
  });
  const dir = await resolver.resolveSessionDir("u1", "newC", "branchB");
  assert.equal(
    dir,
    path.join("/tmp", "workspace", "u1", "runtime/session", "rootA", "branchB", "newC"),
  );
});

test("resolveSessionDir rejects a parent hint that contradicts the tree", async () => {
  const resolver = createResolverWithTree({
    nodes: {
      rootA: { sessionId: "rootA", parentSessionId: "" },
      branchB: { sessionId: "branchB", parentSessionId: "rootA" },
      otherD: { sessionId: "otherD", parentSessionId: "" },
    },
  });
  await assert.rejects(
    () => resolver.resolveSessionDir("u1", "branchB", "otherD"),
    (error) => error?.code === "FATAL_PARENT_SESSION_MISSING",
  );
});
