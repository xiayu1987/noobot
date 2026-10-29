/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";

import {
  ScopedSessionLocationResolver,
  SessionTreeLocationContext,
  buildSessionLocationScope,
  createPersistenceContext,
  createSessionTreePersistenceContext,
} from "../../src/session/session-location-resolver.js";

const pathResolver = {
  resolveBasePath: (userId) => path.join("/workspace", userId),
  sessionRoot: (basePath) => path.join(basePath, "runtime/session"),
};

const scopedOptions = Object.freeze({
  pathResolver,
  userId: "alice",
  sessionId: "child",
  parentSessionId: "parent",
  scopeId: "agent:child",
  allowedRoot: "runtime/plugin-data/workflow/session",
  relativeDir: "runtime/plugin-data/workflow/session/run/node",
});

test("buildSessionLocationScope uses the canonical artifact map", () => {
  const scope = buildSessionLocationScope("/tmp/session", "parent", {
    indexed: true,
    registered: true,
  });
  assert.deepEqual(scope, {
    resolvedParentSessionId: "parent",
    indexed: true,
    registered: true,
    sessionDir: "/tmp/session",
    sessionFile: "/tmp/session/session.json",
    sessionSummaryFile: "/tmp/session/session-summary.json",
    executionEventsDir: "/tmp/session/execution-events",
    turnsDir: "/tmp/session/turns",
    turnSnapshotsDir: "/tmp/session/turn-snapshots",
    metadataFile: "/tmp/session/meta.json",
  });
  assert.ok(Object.isFrozen(scope));
});

test("scoped resolver locates and places only its bound session under the bound parent", async () => {
  const resolver = new ScopedSessionLocationResolver(scopedOptions);
  const sessionDir = "/workspace/alice/runtime/plugin-data/workflow/session/run/node";
  const located = await resolver.locateSessionScope("alice", "child");
  assert.equal(located.sessionDir, sessionDir);
  assert.equal(located.resolvedParentSessionId, "parent");
  assert.equal(located.indexed, false);
  assert.equal(located.registered, true);
  const placed = await resolver.placeSessionScope("alice", {
    sessionId: "child",
    parentSessionId: "parent",
  });
  assert.equal(placed.sessionDir, sessionDir);

  await assert.rejects(() => resolver.locateSessionScope("bob", "child"), /user does not match/);
  await assert.rejects(() => resolver.locateSessionScope("alice", ""), /requires a sessionId/);
  await assert.rejects(() => resolver.locateSessionScope("alice", "other"), /id does not match/);
  for (const parentSessionId of ["other", ""]) {
    await assert.rejects(
      () => resolver.placeSessionScope("alice", { sessionId: "child", parentSessionId }),
      /parent does not match/,
    );
  }
});

test("scoped resolver requires every binding field including the parent session", () => {
  for (const field of [
    "pathResolver",
    "userId",
    "sessionId",
    "parentSessionId",
    "scopeId",
    "relativeDir",
    "allowedRoot",
  ]) {
    const { [field]: _omitted, ...options } = scopedOptions;
    assert.throws(() => new ScopedSessionLocationResolver(options), TypeError, field);
  }
});

test("scoped resolver rejects absolute, escaping, similar-prefix, and default-session targets", () => {
  const build = (overrides) => () =>
    new ScopedSessionLocationResolver({ ...scopedOptions, ...overrides });
  assert.throws(build({ relativeDir: "/tmp/node" }), /relative/);
  assert.throws(build({ relativeDir: "runtime/plugin-data/workflow/session/../other" }), /escapes/);
  assert.throws(build({ relativeDir: "runtime/plugin-data/workflow/session" }), /child/);
  assert.throws(build({ relativeDir: "runtime/plugin-data/workflow/other" }), /escapes/);
  assert.throws(
    build({ relativeDir: "runtime/plugin-data/workflow/session-other/node" }),
    /escapes/,
  );
  assert.throws(
    build({ allowedRoot: "runtime", relativeDir: "runtime/session/node" }),
    /default session root/,
  );
});

test("persistence contexts are immutable, execution-local and accept only session location implementations", () => {
  const scoped = createPersistenceContext({
    locationResolver: new ScopedSessionLocationResolver(scopedOptions),
  });
  const sessionPathResolver = {};
  const tree = createSessionTreePersistenceContext({
    sessionPathResolver,
    userId: "alice",
    sessionId: "root",
  });
  for (const context of [scoped, tree]) {
    assert.ok(Object.isFrozen(context));
    assert.equal(context.kind, "noobot.session_persistence_scope");
    assert.equal(context.version, 1);
    assert.equal(context.userId, "alice");
  }
  assert.equal(scoped.scoped, true);
  assert.equal(scoped.scopeId, "agent:child");
  assert.equal(tree.scoped, false);
  assert.equal(tree.scopeId, "");
  assert.ok(tree.locationResolver instanceof SessionTreeLocationContext);
  assert.notEqual(scoped.locationResolver, tree.locationResolver);

  const lookalike = {
    userId: "alice",
    sessionId: "child",
    scopeId: "agent:child",
    locateSessionScope() {},
    placeSessionScope() {},
    commitSessionPlacement() {},
  };
  assert.throws(
    () => createPersistenceContext({ locationResolver: lookalike }),
    /session location implementation/,
  );
  assert.throws(() => createPersistenceContext({ locationResolver: {} }), /locationResolver/);
});

test("session tree location context is bound to one user and session", async () => {
  const calls = [];
  const sessionPathResolver = {
    locateSessionScope: async (...args) => calls.push(["locate", ...args]),
    placeSessionScope: async (...args) => calls.push(["place", ...args]),
    commitSessionPlacement: async (...args) => calls.push(["commit", ...args]),
  };
  const context = new SessionTreeLocationContext({
    sessionPathResolver,
    userId: "alice",
    sessionId: "child",
  });
  await context.locateSessionScope("alice", "child");
  await context.placeSessionScope("alice", { sessionId: "child", parentSessionId: "root" });
  await context.commitSessionPlacement("alice", {
    sessionId: "child",
    parentSessionId: "root",
    caller: "bot",
  });
  assert.deepEqual(calls, [
    ["locate", "alice", "child"],
    ["place", "alice", { sessionId: "child", parentSessionId: "root" }],
    ["commit", "alice", { sessionId: "child", parentSessionId: "root", caller: "bot" }],
  ]);
  await assert.rejects(() => context.locateSessionScope("bob", "child"), /user does not match/);
  await assert.rejects(() => context.locateSessionScope("alice", "other"), /id does not match/);
  assert.throws(
    () => new SessionTreeLocationContext({ sessionPathResolver, userId: "alice", sessionId: "" }),
    TypeError,
  );
});
