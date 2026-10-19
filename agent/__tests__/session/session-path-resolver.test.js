/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";

import { SESSION_CALLER } from "@noobot/shared/session-caller";
import { SessionPathResolver } from "../../src/session/session-path-resolver.js";

const SESSION_ROOT = path.join("/tmp", "workspace", "u1", "runtime/session");

function node(sessionId, parentSessionId) {
  return { sessionId, parentSessionId, caller: SESSION_CALLER.USER };
}

function createResolverWithTree(nodes) {
  const pathResolver = {
    resolveBasePath(userId) {
      return path.join("/tmp", "workspace", userId);
    },
    sessionRoot(basePath) {
      return path.join(basePath, "runtime/session");
    },
  };
  const treeRepository = {
    async getTree() {
      return { nodes };
    },
  };
  return new SessionPathResolver({ pathResolver, treeRepository });
}

const chainTree = {
  rootA: node("rootA", ""),
  branchB: node("branchB", "rootA"),
  leafC: node("leafC", "branchB"),
};

test("resolveSessionScope rejects a parent that is not registered in the tree", async () => {
  const resolver = createResolverWithTree({ s1: node("s1", "") });
  await assert.rejects(
    () => resolver.resolveSessionScope("u1", "s2", "missing-parent"),
    (error) => error?.code === "FATAL_PARENT_SESSION_MISSING",
  );
});

test("resolveSessionScope reads the parent of a registered node from its tree chain", async () => {
  const resolver = createResolverWithTree(chainTree);
  const scope = await resolver.resolveSessionScope("u1", "leafC", "");
  assert.equal(scope.resolvedParentSessionId, "branchB");
  assert.equal(scope.sessionDir, path.join(SESSION_ROOT, "rootA", "branchB", "leafC"));
});

test("resolveSessionScope places an unregistered root session at the session root", async () => {
  const resolver = createResolverWithTree(chainTree);
  const scope = await resolver.resolveSessionScope("u1", "draft", "");
  assert.equal(scope.resolvedParentSessionId, "");
  assert.equal(scope.sessionDir, path.join(SESSION_ROOT, "draft"));
});

test("resolveSessionScope places an unregistered child under its parent chain", async () => {
  const resolver = createResolverWithTree(chainTree);
  const scope = await resolver.resolveSessionScope("u1", "newD", "branchB");
  assert.equal(scope.resolvedParentSessionId, "branchB");
  assert.equal(scope.sessionDir, path.join(SESSION_ROOT, "rootA", "branchB", "newD"));
});

test("resolveSessionScope rejects a parent hint that contradicts the tree", async () => {
  const resolver = createResolverWithTree({ ...chainTree, otherD: node("otherD", "") });
  await assert.rejects(
    () => resolver.resolveSessionScope("u1", "branchB", "otherD"),
    (error) => error?.code === "FATAL_PARENT_SESSION_MISSING",
  );
});

test("resolveSessionScope requires an explicit sessionId and parent coordinate", async () => {
  const resolver = createResolverWithTree(chainTree);
  await assert.rejects(
    () => resolver.resolveSessionScope("u1", "", ""),
    (error) => error?.code === "SESSION_TREE_SESSION_ID_REQUIRED",
  );
  await assert.rejects(
    () => resolver.resolveSessionScope("u1", "leafC"),
    (error) => error?.code === "SESSION_TREE_SESSION_ID_REQUIRED",
  );
});
