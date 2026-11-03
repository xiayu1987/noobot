/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { access, mkdtemp, rm } from "node:fs/promises";
import { AGENT_SCOPED_SESSION_ROOTS } from "@noobot/workspace-protocol";
import { SESSION_CALLER } from "@noobot/shared/session-caller";
import { withRuntimeEventsEnv } from "@noobot/runtime-events/testing";
import { createTestSessionServices, provisionTestSession } from "../helpers/session-services.js";
import { initializeUserWorkspace } from "../helpers/user-workspace.js";
import {
  ScopedSessionLocationResolver,
  createPersistenceContext,
} from "../../src/session/session-location-resolver.js";

for (const concurrentPlacement of [false, true]) {
  test(`branch deletion removes nested Agent scopes, concurrent placement=${concurrentPlacement}`, async () => {
    const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "noobot-agent-delete-"));
    try {
      await withRuntimeEventsEnv({ workspaceRoot }, async () => {
        const userId = "u1";
        await initializeUserWorkspace(workspaceRoot, userId);
        const runtime = createTestSessionServices({ workspaceRoot });
        const repo = runtime.repositories.sessionRepository;
        for (const sessionId of ["parent", "other"]) {
          await provisionTestSession(runtime, { userId, sessionId, caller: SESSION_CALLER.USER });
        }
        const contexts = new Map();
        const place = async (sessionId, parentSessionId) => {
          const allowedRoot = AGENT_SCOPED_SESSION_ROOTS[0];
          const context = createPersistenceContext({
            locationResolver: new ScopedSessionLocationResolver({
              pathResolver: repo.pathResolver,
              userId,
              sessionId,
              parentSessionId,
              scopeId: `agent:${sessionId}`,
              relativeDir: path.join(allowedRoot, sessionId),
              allowedRoot,
            }),
          });
          contexts.set(sessionId, context);
          await repo.ensureSession({
            userId,
            sessionId,
            parentSessionId,
            caller: SESSION_CALLER.USER,
            persistenceContext: context,
          });
        };
        await place("child", "parent");
        await place("grandchild", "child");
        await place("unrelated", "other");
        if (concurrentPlacement) {
          const lock = repo.withSessionLifecycleMutations.bind(repo);
          let injected = false;
          repo.withSessionLifecycleMutations = async (lockedUserId, ids, operation) => {
            if (!injected) {
              injected = true;
              await place("late-child", "grandchild");
            }
            return lock(lockedUserId, ids, operation);
          };
        }
        const result = await runtime.sessionTreeService.deleteSessionBranch({
          userId,
          sessionIds: ["parent"],
        });
        const expected = ["parent", "child", "grandchild"];
        if (concurrentPlacement) expected.push("late-child");
        assert.deepEqual(new Set(result.deletedSessionIds), new Set(expected));
        for (const sessionId of expected) {
          assert.equal(await repo.isSessionDeleted(userId, sessionId), true);
          if (contexts.has(sessionId)) {
            const scope = await repo.requireSessionScope(
              userId,
              sessionId,
              contexts.get(sessionId),
            );
            await assert.rejects(access(scope.sessionDir), { code: "ENOENT" });
          }
        }
        assert.equal(await repo.isSessionDeleted(userId, "other"), false);
        assert.ok(
          await repo.findById(userId, "unrelated", {
            persistenceContext: contexts.get("unrelated"),
          }),
        );
        await assert.rejects(place("after-delete", "child"), { code: "SESSION_DELETED" });
      });
    } finally {
      await rm(workspaceRoot, { recursive: true, force: true });
    }
  });
}

test("branch deletion rejects a root without a persistence owner", async () => {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "noobot-agent-delete-"));
  try {
    await withRuntimeEventsEnv({ workspaceRoot }, async () => {
      const userId = "u1";
      await initializeUserWorkspace(workspaceRoot, userId);
      const runtime = createTestSessionServices({ workspaceRoot });
      await assert.rejects(
        runtime.sessionTreeService.deleteSessionBranch({ userId, sessionIds: ["missing"] }),
        { code: "FATAL_SESSION_TREE_NODE_MISSING" },
      );
    });
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test("branch deletion rejects a session owned by both the tree and an Agent scope", async () => {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "noobot-agent-delete-"));
  try {
    await withRuntimeEventsEnv({ workspaceRoot }, async () => {
      const userId = "u1";
      await initializeUserWorkspace(workspaceRoot, userId);
      const runtime = createTestSessionServices({ workspaceRoot });
      const repo = runtime.repositories.sessionRepository;
      await provisionTestSession(runtime, {
        userId,
        sessionId: "parent",
        caller: SESSION_CALLER.USER,
      });
      await provisionTestSession(runtime, {
        userId,
        sessionId: "dual",
        parentSessionId: "parent",
        caller: SESSION_CALLER.USER,
      });
      const allowedRoot = AGENT_SCOPED_SESSION_ROOTS[0];
      await repo.ensureSession({
        userId,
        sessionId: "dual",
        parentSessionId: "parent",
        caller: SESSION_CALLER.USER,
        persistenceContext: createPersistenceContext({
          locationResolver: new ScopedSessionLocationResolver({
            pathResolver: repo.pathResolver,
            userId,
            sessionId: "dual",
            parentSessionId: "parent",
            scopeId: "agent:dual",
            relativeDir: path.join(allowedRoot, "dual"),
            allowedRoot,
          }),
        }),
      });
      await assert.rejects(
        runtime.sessionTreeService.deleteSessionBranch({ userId, sessionIds: ["parent"] }),
        { code: "FATAL_SESSION_PERSISTENCE_OWNER_CONFLICT" },
      );
      assert.equal(await repo.isSessionDeleted(userId, "parent"), false);
    });
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});
