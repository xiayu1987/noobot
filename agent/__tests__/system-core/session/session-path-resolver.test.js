import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";

import { SessionPathResolver } from "../../../src/system-core/session/session-path-resolver.js";

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
    loopSession(sessionId, inputTree, chain = []) {
      const normalized = String(sessionId || "").trim();
      if (!normalized) return chain;
      const parent = String(inputTree?.nodes?.[normalized]?.parentSessionId || "").trim();
      const next = chain.concat(normalized);
      if (!parent) return next;
      return this.loopSession(parent, inputTree, next);
    },
  };

  return new SessionPathResolver({ pathResolver, treeRepository });
}

test("resolveParentSessionId should throw when hinted parent is missing", async () => {
  const resolver = createResolverWithTree({
    nodes: { s1: { sessionId: "s1", parentSessionId: "", children: [] } },
  });

  await assert.rejects(
    () => resolver.resolveParentSessionId("u1", "s2", "missing-parent"),
    (error) => error?.code === "FATAL_PARENT_SESSION_MISSING",
  );
});

test("resolveParentSessionId should fallback to tree when hint not provided", async () => {
  const resolver = createResolverWithTree({
    nodes: {
      s1: { sessionId: "s1", parentSessionId: "", children: ["s2"] },
      s2: { sessionId: "s2", parentSessionId: "s1", children: [] },
    },
  });

  const parentSessionId = await resolver.resolveParentSessionId("u1", "s2");
  assert.equal(parentSessionId, "s1");
});

test("resolveSessionDir should resolve multi-level chain path", async () => {
  const resolver = createResolverWithTree({
    nodes: {
      rootA: { sessionId: "rootA", parentSessionId: "", children: ["branchB"] },
      branchB: { sessionId: "branchB", parentSessionId: "rootA", children: ["leafC"] },
      leafC: { sessionId: "leafC", parentSessionId: "branchB", children: [] },
    },
  });

  const dir = await resolver.resolveSessionDir("u1", "leafC");
  assert.equal(
    dir,
    path.join("/tmp", "workspace", "u1", "runtime/session", "rootA", "branchB", "leafC"),
  );
});
