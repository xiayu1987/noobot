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
  assertPersistenceContextIdentity,
  buildSessionLocationScope,
  createPersistenceContext,
} from "../../src/session/session-location-resolver.js";

const pathResolver = {
  resolveBasePath: (userId) => path.join("/workspace", userId),
  sessionRoot: (basePath) => path.join(basePath, "runtime/session"),
};

test("buildSessionLocationScope uses the canonical artifact map", () => {
  const scope = buildSessionLocationScope("/tmp/session", "parent");
  assert.deepEqual(scope, {
    resolvedParentSessionId: "parent",
    sessionDir: "/tmp/session",
    sessionFile: "/tmp/session/session.json",
    sessionSummaryFile: "/tmp/session/session-summary.json",
    taskFile: "/tmp/session/task.json",
    executionFile: "/tmp/session/execution.json",
    executionEventsFile: "/tmp/session/execution.jsonl",
    executionEventsDir: "/tmp/session/execution-events",
    turnsDir: "/tmp/session/turns",
    turnSnapshotsDir: "/tmp/session/turn-snapshots",
    metadataFile: "/tmp/session/meta.json",
    mutationLockDir: "/tmp/session.mutation-lock",
  });
  assert.ok(Object.isFrozen(scope));
});

test("scoped resolver confines a run to its allowed user-relative root", async () => {
  const resolver = new ScopedSessionLocationResolver({
    pathResolver,
    userId: "alice",
    sessionId: "child",
    parentSessionId: "parent",
    scopeId: "agent:child",
    allowedRoot: "runtime/workflow/session",
    relativeDir: "runtime/workflow/session/run/node",
  });
  const scope = await resolver.resolveSessionScope("alice", "child", "parent");
  assert.equal(scope.sessionDir, "/workspace/alice/runtime/workflow/session/run/node");
  assert.equal(scope.mutationLockDir, `${scope.sessionDir}.mutation-lock`);
  await assert.rejects(() => resolver.resolveSessionScope("bob", "child"), /user does not match/);
  await assert.rejects(() => resolver.resolveSessionScope("alice", ""), /requires a sessionId/);
  await assert.rejects(() => resolver.resolveSessionScope("alice", "other"), /id does not match/);
  await assert.rejects(
    () => resolver.resolveParentSessionId("alice", "child", "other"),
    /parent does not match/,
  );
});

test("scoped resolver rejects absolute, escaping, similar-prefix, and default-session targets", () => {
  const options = {
    pathResolver,
    userId: "alice",
    sessionId: "child",
    scopeId: "agent:child",
    allowedRoot: "runtime/workflow/session",
  };
  assert.throws(
    () => new ScopedSessionLocationResolver({ ...options, relativeDir: "/tmp/node" }),
    /relative/,
  );
  assert.throws(
    () =>
      new ScopedSessionLocationResolver({
        ...options,
        relativeDir: "runtime/workflow/session/../other",
      }),
    /escapes/,
  );
  assert.throws(
    () =>
      new ScopedSessionLocationResolver({ ...options, relativeDir: "runtime/workflow/session" }),
    /child/,
  );
  assert.throws(
    () => new ScopedSessionLocationResolver({ ...options, relativeDir: "runtime/workflow/other" }),
    /escapes/,
  );
  assert.throws(
    () =>
      new ScopedSessionLocationResolver({
        ...options,
        relativeDir: "runtime/workflow/session-other/node",
      }),
    /escapes/,
  );
  assert.throws(
    () =>
      new ScopedSessionLocationResolver({
        ...options,
        allowedRoot: "runtime",
        relativeDir: "runtime/session/node",
      }),
    /default session root/,
  );
});

test("persistence contexts are immutable and execution-local", () => {
  const first = createPersistenceContext({
    locationResolver: {
      userId: "alice",
      sessionId: "child",
      parentSessionId: "parent",
      scopeId: "agent:child",
      resolveSessionScope() {},
    },
  });
  const second = createPersistenceContext({
    locationResolver: {
      userId: "alice",
      sessionId: "child-2",
      scopeId: "agent:child-2",
      resolveSessionScope() {},
    },
  });
  assert.ok(Object.isFrozen(first));
  assert.notEqual(first.locationResolver, second.locationResolver);
  assert.equal(first.kind, "noobot.session_persistence_scope");
  assert.equal(first.version, 1);
  assert.equal(
    assertPersistenceContextIdentity(first, {
      userId: "alice",
      sessionId: "child",
      parentSessionId: "parent",
      scopeId: "agent:child",
    }),
    first,
  );
  assert.throws(
    () => assertPersistenceContextIdentity(first, { sessionId: "other" }),
    /sessionId does not match/,
  );
});
