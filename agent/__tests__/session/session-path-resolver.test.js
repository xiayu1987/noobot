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

test("placeSessionScope rejects a parent that is not registered in the tree", async () => {
  const resolver = createResolverWithTree({ s1: node("s1", "") });
  await assert.rejects(
    () => resolver.placeSessionScope("u1", { sessionId: "s2", parentSessionId: "missing-parent" }),
    (error) => error?.code === "FATAL_PARENT_SESSION_MISSING",
  );
});

test("locateSessionScope reads the parent of a registered node from its tree chain", async () => {
  const resolver = createResolverWithTree(chainTree);
  const scope = await resolver.locateSessionScope("u1", "leafC");
  assert.equal(scope.resolvedParentSessionId, "branchB");
  assert.equal(scope.registered, true);
  assert.equal(scope.indexed, true);
  assert.equal(scope.sessionDir, path.join(SESSION_ROOT, "rootA", "branchB", "leafC"));
});

test("locateSessionScope returns null for a session that is not registered", async () => {
  const resolver = createResolverWithTree(chainTree);
  assert.equal(await resolver.locateSessionScope("u1", "draft"), null);
});

test("placeSessionScope places an unregistered root session at the session root", async () => {
  const resolver = createResolverWithTree(chainTree);
  const scope = await resolver.placeSessionScope("u1", { sessionId: "draft", parentSessionId: "" });
  assert.equal(scope.resolvedParentSessionId, "");
  assert.equal(scope.registered, false);
  assert.equal(scope.sessionDir, path.join(SESSION_ROOT, "draft"));
});

test("placeSessionScope places an unregistered child under its parent chain", async () => {
  const resolver = createResolverWithTree(chainTree);
  const scope = await resolver.placeSessionScope("u1", {
    sessionId: "newD",
    parentSessionId: "branchB",
  });
  assert.equal(scope.resolvedParentSessionId, "branchB");
  assert.equal(scope.registered, false);
  assert.equal(scope.sessionDir, path.join(SESSION_ROOT, "rootA", "branchB", "newD"));
});

test("placeSessionScope accepts a registered session only under its tree parent", async () => {
  const resolver = createResolverWithTree({ ...chainTree, otherD: node("otherD", "") });
  const scope = await resolver.placeSessionScope("u1", {
    sessionId: "branchB",
    parentSessionId: "rootA",
  });
  assert.equal(scope.registered, true);
  await assert.rejects(
    () => resolver.placeSessionScope("u1", { sessionId: "branchB", parentSessionId: "otherD" }),
    (error) =>
      error?.code === "FATAL_PARENT_SESSION_MISSING" &&
      error?.details?.protocolCode === "SESSION_TREE_PARENT_MISMATCH",
  );
  await assert.rejects(
    () => resolver.placeSessionScope("u1", { sessionId: "branchB", parentSessionId: "" }),
    (error) => error?.details?.protocolCode === "SESSION_TREE_PARENT_MISMATCH",
  );
});

test("placeSessionScope requires an explicit sessionId and parent coordinate", async () => {
  const resolver = createResolverWithTree(chainTree);
  await assert.rejects(
    () => resolver.placeSessionScope("u1", { sessionId: "", parentSessionId: "" }),
    (error) => error?.code === "SESSION_TREE_SESSION_ID_REQUIRED",
  );
  await assert.rejects(
    () => resolver.placeSessionScope("u1", { sessionId: "leafC" }),
    (error) => error?.code === "SESSION_TREE_SESSION_ID_REQUIRED",
  );
});
