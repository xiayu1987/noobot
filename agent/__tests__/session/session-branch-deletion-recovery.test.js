/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { access, mkdtemp, rm } from "node:fs/promises";

import {
  executeEmptySessionCleanup,
  createTestPartitionSessionServices as createTestSessionServices,
  provisionTestSession,
} from "../helpers/session-services.js";
import { initializeUserWorkspace } from "../helpers/user-workspace.js";
import { SESSION_CALLER } from "@noobot/shared/session-caller";
import { withRuntimeEventsEnv } from "@noobot/runtime-events/testing";
import { SessionMutationCoordinator } from "../../src/session/session-mutation-coordinator.js";
import {
  scopedSessionPageIdentity,
  treeSessionPageScope,
} from "@noobot/session-protocol/message-read-budget";
import { getFsAdapter } from "../../src/shared/storage/fs-adapter.js";
import { sessionDeletionStagingName } from "@noobot/workspace-protocol/session-tombstone";
import { PARTITION_JOURNAL_HEAD_FILE } from "@noobot/session-protocol/partition-journal";

async function withTempWorkspace(fn) {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "noobot-session-boundary-"));
  try {
    return await withRuntimeEventsEnv({ workspaceRoot }, () => fn(workspaceRoot));
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
}

test("branch deletion confirmations use locked persisted targets and reject stale or absent operations", async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const userId = "u1";
    await initializeUserWorkspace(workspaceRoot, userId);
    const first = createTestSessionServices({ workspaceRoot });
    const second = createTestSessionServices({ workspaceRoot });
    try {
      const repo = first.repositories.sessionRepository;
      const other = second.repositories.sessionRepository;
      const targets = [{ sessionId: "s1", directory: ["runtime", "session", "s1"] }];
      const key = JSON.stringify(["s1"]);
      await repo.recordSessionBranchDeletion(userId, key, targets, ["recorded-handler"]);
      const file = repo._sessionTombstoneFile(userId);
      const initial = await repo.storageService.readTextOrNull(file);
      await assert.rejects(repo.advanceSessionBranchDeletion(userId, key, "tree"), {
        code: "SESSION_BRANCH_DELETION_CONFLICT",
      });
      await assert.rejects(
        repo.advanceSessionBranchDeletion(userId, '["missing"]', "directories"),
        {
          code: "SESSION_TOMBSTONE_INVALID",
        },
      );
      assert.equal(await repo.storageService.readTextOrNull(file), initial);
      const confirmations = await Promise.allSettled([
        repo.advanceSessionBranchDeletion(userId, key, "directories"),
        other.advanceSessionBranchDeletion(userId, key, "directories"),
      ]);
      const fulfilled = confirmations.filter(({ status }) => status === "fulfilled");
      const rejected = confirmations.filter(({ status }) => status === "rejected");
      assert.equal(fulfilled.length, 1);
      assert.equal(rejected.length, 1);
      assert.equal(rejected[0].reason.code, "SESSION_BRANCH_DELETION_CONFLICT");
      assert.deepEqual(fulfilled[0].value, {
        targets,
        pluginHandlerIds: ["recorded-handler"],
        nextStage: "tree",
      });
      const committed = await repo.storageService.readTextOrNull(file);
      await assert.rejects(other.advanceSessionBranchDeletion(userId, key, "directories"), {
        code: "SESSION_BRANCH_DELETION_CONFLICT",
      });
      assert.equal(await repo.storageService.readTextOrNull(file), committed);
      assert.deepEqual(await other.readSessionBranchDeletion(userId, key), fulfilled[0].value);
      assert.deepEqual(JSON.parse(committed).sessions, JSON.parse(initial).sessions);
    } finally {
      await Promise.all([first.close(), second.close()]);
    }
  });
});

test("disjoint branch deletions preserve both tombstones across repository instances", async (t) => {
  await withTempWorkspace(async (workspaceRoot) => {
    const userId = "u1";
    await initializeUserWorkspace(workspaceRoot, userId);
    const first = createTestSessionServices({ workspaceRoot });
    const second = createTestSessionServices({ workspaceRoot });
    for (const sessionId of ["first", "second"]) {
      await provisionTestSession(first, { userId, sessionId, caller: SESSION_CALLER.USER });
    }

    const firstRepo = first.repositories.sessionRepository;
    const secondRepo = second.repositories.sessionRepository;
    const tombstoneFile = firstRepo._sessionTombstoneFile(userId);
    const lock = first.pathResolver.sessionTombstoneLockFile(firstRepo._basePath(userId));
    const firstWriting = Promise.withResolvers();
    const releaseFirstWrite = Promise.withResolvers();
    const secondContending = Promise.withResolvers();
    const write = firstRepo.storageService.writeJsonAtomic.bind(firstRepo.storageService);
    t.mock.method(firstRepo.storageService, "writeJsonAtomic", async (file, data, ...rest) => {
      if (file === tombstoneFile) {
        firstWriting.resolve();
        await releaseFirstWrite.promise;
      }
      return write(file, data, ...rest);
    });
    const run = secondRepo.mutationCoordinator.run.bind(secondRepo.mutationCoordinator);
    t.mock.method(secondRepo.mutationCoordinator, "run", (key, operation) => {
      if (key === lock) secondContending.resolve();
      return run(key, operation);
    });

    const deletingFirst = first.sessionTreeService.deleteSessionBranch(
      {
        userId,
        sessionIds: ["first"],
      },
      executeEmptySessionCleanup,
    );
    await Promise.race([firstWriting.promise, deletingFirst]);
    const deletingSecond = second.sessionTreeService.deleteSessionBranch(
      {
        userId,
        sessionIds: ["second"],
      },
      executeEmptySessionCleanup,
    );
    try {
      await Promise.race([secondContending.promise, deletingSecond]);
    } finally {
      releaseFirstWrite.resolve();
      await Promise.all([deletingFirst, deletingSecond]);
    }

    const reopened = createTestSessionServices({ workspaceRoot });
    const repo = reopened.repositories.sessionRepository;
    assert.equal(await repo.isSessionDeleted(userId, "first"), true);
    assert.equal(await repo.isSessionDeleted(userId, "second"), true);
  });
});

test("deletion and placement in different repository instances preserve the session tree", async (t) => {
  await withTempWorkspace(async (workspaceRoot) => {
    const userId = "u1";
    await initializeUserWorkspace(workspaceRoot, userId);
    const first = createTestSessionServices({ workspaceRoot });
    const second = createTestSessionServices({ workspaceRoot });
    await provisionTestSession(first, { userId, sessionId: "old", caller: SESSION_CALLER.USER });

    const treeRepo = first.repositories.sessionTreeRepository;
    const treeFile = treeRepo._treeFile(userId);
    const lock = first.pathResolver.sessionTreeLockFile(treeRepo._basePath(userId));
    const firstWriting = Promise.withResolvers();
    const releaseFirstWrite = Promise.withResolvers();
    const secondContending = Promise.withResolvers();
    const write = treeRepo.storageService.writeJsonAtomic.bind(treeRepo.storageService);
    t.mock.method(treeRepo.storageService, "writeJsonAtomic", async (file, data, ...rest) => {
      if (file === treeFile) {
        firstWriting.resolve();
        await releaseFirstWrite.promise;
      }
      return write(file, data, ...rest);
    });
    const run = SessionMutationCoordinator.prototype.run;
    t.mock.method(SessionMutationCoordinator.prototype, "run", function (key, operation) {
      if (key === lock && this !== treeRepo.mutationCoordinator) {
        secondContending.resolve();
      }
      return run.call(this, key, operation);
    });

    const deleting = first.sessionTreeService.deleteSessionBranch(
      { userId, sessionIds: ["old"] },
      executeEmptySessionCleanup,
    );
    await Promise.race([firstWriting.promise, deleting]);
    const placing = provisionTestSession(second, {
      userId,
      sessionId: "new",
      caller: SESSION_CALLER.USER,
    });
    try {
      await Promise.race([secondContending.promise, placing]);
    } finally {
      releaseFirstWrite.resolve();
      await Promise.all([deleting, placing]);
    }

    const reopened = createTestSessionServices({ workspaceRoot });
    const tree = await reopened.sessionTreeService.getSessionTree({ userId });
    assert.deepEqual(Object.keys(tree.nodes), ["new"]);
  });
});

test("deleting a child releases directory-scoped readers before removal and preserves the parent", async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const userId = "u1";
    const authoritySessionId = "parent";
    const sessionId = "child";
    await initializeUserWorkspace(workspaceRoot, userId);
    const runtime = createTestSessionServices({ workspaceRoot });
    try {
      const repo = runtime.repositories.sessionRepository;
      await provisionTestSession(runtime, {
        userId,
        sessionId: authoritySessionId,
        caller: SESSION_CALLER.USER,
      });
      await provisionTestSession(runtime, {
        userId,
        sessionId,
        parentSessionId: authoritySessionId,
        caller: SESSION_CALLER.USER,
      });
      const { sessionDir } = await repo.requireSessionScope(
        userId,
        sessionId,
        repo.treePersistenceContext(userId, sessionId),
      );
      const scoped = scopedSessionPageIdentity({ userId, authoritySessionId, sessionDir }, null);
      const parent = treeSessionPageScope(userId, authoritySessionId);
      const openPage = (identity, close) =>
        repo.pageSnapshots.read({
          assertReadAuthority: () => repo.assertSessionWritable(userId, sessionId),
          identity,
          cursor: null,
          open: async () => ({ close }),
          read: async () => ({ nextCursor: { after: 1, scope: "page" } }),
        });
      let childClosed = false;
      let parentClosed = false;
      const childPage = await openPage(scoped, async () => {
        await access(sessionDir);
        childClosed = true;
      });
      const parentPage = await openPage(parent, () => {
        parentClosed = true;
      });
      await runtime.sessionTreeService.deleteSessionBranch(
        { userId, sessionIds: [sessionId] },
        executeEmptySessionCleanup,
      );
      assert.equal(childClosed, true);
      assert.equal(parentClosed, false);
      assert.deepEqual(
        await repo.pageSnapshots.releaseCursor({ identity: scoped, cursor: childPage.nextCursor }),
        { released: false },
      );
      assert.deepEqual(
        await repo.pageSnapshots.releaseCursor({ identity: parent, cursor: parentPage.nextCursor }),
        { released: true },
      );
      await assert.rejects(access(sessionDir), { code: "ENOENT" });
    } finally {
      await runtime.close();
    }
  });
});

test("branch deletion retries snapshot release without changing its deletion marker", async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const userId = "u1";
    const sessionId = "retry-delete";
    await initializeUserWorkspace(workspaceRoot, userId);
    const runtime = createTestSessionServices({ workspaceRoot });
    await provisionTestSession(runtime, { userId, sessionId, caller: SESSION_CALLER.USER });
    const repo = runtime.repositories.sessionRepository;
    const scope = await repo.requireSessionScope(
      userId,
      sessionId,
      repo.treePersistenceContext(userId, sessionId),
    );
    const cause = new Error("snapshot release failed");
    let attempts = 0;
    await repo.pageSnapshots.read({
      assertReadAuthority: () => repo.assertSessionWritable(userId, sessionId),
      identity: treeSessionPageScope(userId, sessionId),
      cursor: null,
      open: async () => ({
        async close() {
          if (++attempts === 1) throw cause;
        },
      }),
      read: async () => ({ nextCursor: { after: 1, scope: "snapshot" } }),
    });

    const request = { userId, sessionIds: [sessionId] };
    await assert.rejects(
      runtime.sessionTreeService.deleteSessionBranch(request, executeEmptySessionCleanup),
      (error) => {
        assert.deepEqual(error.errors, [cause]);
        return true;
      },
    );
    const file = repo._sessionTombstoneFile(userId);
    const tombstone = JSON.parse(await repo.storageService.readTextOrNull(file));
    assert.equal(await repo.isSessionDeleted(userId, sessionId), true);
    await assert.rejects(repo.assertSessionWritable(userId, sessionId), {
      code: "SESSION_DELETED",
    });
    await access(scope.sessionDir);

    const result = await runtime.sessionTreeService.deleteSessionBranch(
      request,
      executeEmptySessionCleanup,
    );
    assert.deepEqual(result.deletedSessionIds, [sessionId]);
    const resumed = JSON.parse(await repo.storageService.readTextOrNull(file));
    const key = JSON.stringify(request.sessionIds);
    assert.deepEqual(resumed.sessions, tombstone.sessions);
    assert.equal(resumed.updatedAt, tombstone.updatedAt);
    assert.deepEqual(resumed.branchDeletions[key].targets, tombstone.branchDeletions[key].targets);
    assert.equal(tombstone.branchDeletions[key].nextStage, "directories");
    assert.equal(resumed.branchDeletions[key].nextStage, "complete");
    assert.equal(attempts, 2);
    await assert.rejects(access(scope.sessionDir), { code: "ENOENT" });
    assert.deepEqual((await runtime.sessionTreeService.getSessionTree({ userId })).nodes, {});
    await runtime.close();
  });
});

test("tree branch deletion resumes after a directory removal is interrupted", async (t) => {
  await withTempWorkspace(async (workspaceRoot) => {
    const userId = "u1";
    const root = "interrupted-root";
    const child = "interrupted-child";
    await initializeUserWorkspace(workspaceRoot, userId);
    const runtime = createTestSessionServices({ workspaceRoot });
    const repo = runtime.repositories.sessionRepository;
    await provisionTestSession(runtime, { userId, sessionId: root, caller: SESSION_CALLER.USER });
    await provisionTestSession(runtime, {
      userId,
      sessionId: child,
      parentSessionId: root,
      caller: SESSION_CALLER.BOT,
    });
    const scope = await repo.requireSessionScope(
      userId,
      root,
      repo.treePersistenceContext(userId, root),
    );
    const cause = new Error("interrupted directory removal");
    const staging = path.join(path.dirname(scope.sessionDir), sessionDeletionStagingName(root));
    const adapter = getFsAdapter();
    const remove = adapter.rm;
    const summaries = t.mock.method(repo, "removeSessionDisplaySummaries");
    const fault = t.mock.method(adapter, "rm", async (target, options) => {
      if (target !== staging) return remove(target, options);
      await assert.rejects(access(path.join(staging, child)), { code: "ENOENT" });
      await rm(path.join(staging, PARTITION_JOURNAL_HEAD_FILE));
      throw cause;
    });
    const request = { userId, sessionIds: [root] };
    try {
      await assert.rejects(
        runtime.sessionTreeService.deleteSessionBranch(request, executeEmptySessionCleanup),
        (error) => error === cause,
      );
    } finally {
      fault.mock.restore();
      await runtime.close();
    }
    assert.deepEqual(
      summaries.mock.calls.map(({ arguments: args }) => args),
      [[userId, [root, child]]],
    );
    await assert.rejects(access(scope.sessionDir), { code: "ENOENT" });
    await access(staging);

    const reopened = createTestSessionServices({ workspaceRoot });
    try {
      const reopenedRepo = reopened.repositories.sessionRepository;
      const file = reopenedRepo._sessionTombstoneFile(userId);
      const tombstone = JSON.parse(await reopenedRepo.storageService.readTextOrNull(file));
      assert.equal(await reopenedRepo.isSessionDeleted(userId, root), true);
      assert.equal(await reopenedRepo.isSessionDeleted(userId, child), true);
      const reopenedSummaries = t.mock.method(reopenedRepo, "removeSessionDisplaySummaries");
      const result = await reopened.sessionTreeService.deleteSessionBranch(
        request,
        executeEmptySessionCleanup,
      );
      assert.deepEqual(result.deletedSessionIds, [root, child]);
      assert.equal(reopenedSummaries.mock.callCount(), 1);
      const resumed = JSON.parse(await reopenedRepo.storageService.readTextOrNull(file));
      const key = JSON.stringify(request.sessionIds);
      assert.deepEqual(resumed.sessions, tombstone.sessions);
      assert.equal(resumed.updatedAt, tombstone.updatedAt);
      assert.deepEqual(
        resumed.branchDeletions[key].targets,
        tombstone.branchDeletions[key].targets,
      );
      assert.equal(tombstone.branchDeletions[key].nextStage, "directories");
      assert.equal(resumed.branchDeletions[key].nextStage, "complete");
      await assert.rejects(access(scope.sessionDir), { code: "ENOENT" });
      await assert.rejects(access(staging), { code: "ENOENT" });
      assert.deepEqual((await reopened.sessionTreeService.getSessionTree({ userId })).nodes, {});
    } finally {
      await reopened.close();
    }
  });
});

test("branch deletion resumes in an independent process after a durable tree removal", async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const userId = "u1";
    const sessionId = "process-interrupted";
    await initializeUserWorkspace(workspaceRoot, userId);
    const runtime = createTestSessionServices({ workspaceRoot });
    await provisionTestSession(runtime, { userId, sessionId, caller: SESSION_CALLER.USER });
    await runtime.close();
    const moduleUrl = (file) => new URL(file, import.meta.url).href;
    const request = { userId, sessionIds: [sessionId] };
    const source = `
      import { writeSync } from "node:fs";
      import { createTestPartitionSessionServices as createTestSessionServices, executeEmptySessionCleanup } from ${JSON.stringify(moduleUrl("../helpers/session-services.js"))};
      import { SESSION_DELETION_STAGE } from "@noobot/workspace-protocol/session-tombstone";
      const [workspaceRoot, raw] = process.argv.slice(1);
      const runtime = createTestSessionServices({ workspaceRoot });
      await runtime.sessionTreeService.deleteSessionBranch(JSON.parse(raw), (stage) => {
        if (stage.stage === SESSION_DELETION_STAGE.PLUGINS) {
          writeSync(1, "tree removed");
          process.kill(process.pid, "SIGKILL");
        }
        return executeEmptySessionCleanup(stage);
      });
    `;
    const child = spawnSync(
      process.execPath,
      [
        "--import",
        moduleUrl("../../../shared/testing/runtime-params.js"),
        "--input-type=module",
        "--eval",
        source,
        workspaceRoot,
        JSON.stringify(request),
      ],
      { encoding: "utf8", timeout: 10000 },
    );
    assert.equal(child.signal, "SIGKILL", child.stderr);
    assert.equal(child.stdout, "tree removed");
    const reopened = createTestSessionServices({ workspaceRoot });
    try {
      assert.deepEqual((await reopened.sessionTreeService.getSessionTree({ userId })).nodes, {});
      const resumed = [];
      const result = await reopened.sessionTreeService.deleteSessionBranch(request, (stage) => {
        resumed.push(stage.stage);
        return executeEmptySessionCleanup(stage);
      });
      assert.deepEqual(result, { ok: true, deletedSessionIds: [sessionId] });
      assert.deepEqual(resumed, ["plugins", "attachments", "short_memory"]);
    } finally {
      await reopened.close();
    }
  });
});

test("deleteSessionBranch deletes a child placed between branch planning and locking", async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const userId = "u1";
    const rootSessionId = "race-root";
    const childSessionId = "race-child";
    await initializeUserWorkspace(workspaceRoot, userId);

    const runtime = createTestSessionServices({ workspaceRoot });
    await provisionTestSession(runtime, {
      userId,
      sessionId: rootSessionId,
      parentSessionId: "",
      caller: SESSION_CALLER.USER,
    });
    const sessionRepo = runtime.sessionTreeService.sessionRepo;
    const lockSets = [];
    const lockMutations = sessionRepo.withSessionLifecycleMutations.bind(sessionRepo);
    sessionRepo.withSessionLifecycleMutations = async (lockUserId, sessionIds, operation) => {
      if (lockSets.length === 0 && sessionIds.includes(rootSessionId)) {
        lockSets.push([...sessionIds]);
        await provisionTestSession(runtime, {
          userId,
          sessionId: childSessionId,
          parentSessionId: rootSessionId,
          caller: SESSION_CALLER.BOT,
        });
      } else if (sessionIds.includes(rootSessionId)) {
        lockSets.push([...sessionIds]);
      }
      return lockMutations(lockUserId, sessionIds, operation);
    };

    const result = await runtime.sessionTreeService.deleteSessionBranch(
      {
        userId,
        sessionIds: [rootSessionId],
      },
      executeEmptySessionCleanup,
    );

    assert.deepEqual(lockSets[0], [rootSessionId]);
    assert.deepEqual(result.deletedSessionIds.sort(), [childSessionId, rootSessionId]);
    assert.equal(await sessionRepo.isSessionDeleted(userId, childSessionId), true);
    const tree = await runtime.sessionTreeService.getSessionTree({ userId });
    assert.equal(Object.hasOwn(tree.nodes, childSessionId), false);
    assert.equal(Object.hasOwn(tree.nodes, rootSessionId), false);
    await assert.rejects(
      provisionTestSession(runtime, {
        userId,
        sessionId: "race-late-child",
        parentSessionId: rootSessionId,
        caller: SESSION_CALLER.BOT,
      }),
    );
  });
});

test("deleteSessionBranch merges multiple roots into one lifecycle mutation", async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const userId = "u1";
    await initializeUserWorkspace(workspaceRoot, userId);
    const runtime = createTestSessionServices({ workspaceRoot });
    for (const [sessionId, parentSessionId] of [
      ["R1", ""],
      ["R1-child", "R1"],
      ["R2", ""],
      ["R3", ""],
    ]) {
      await provisionTestSession(runtime, {
        userId,
        sessionId,
        parentSessionId,
        caller: SESSION_CALLER.USER,
      });
    }
    const sessionRepo = runtime.sessionTreeService.sessionRepo;
    const lockSets = [];
    const lockMutations = sessionRepo.withSessionLifecycleMutations.bind(sessionRepo);
    sessionRepo.withSessionLifecycleMutations = async (lockUserId, sessionIds, operation) => {
      lockSets.push([...sessionIds].sort());
      return lockMutations(lockUserId, sessionIds, operation);
    };

    const result = await runtime.sessionTreeService.deleteSessionBranch(
      {
        userId,
        sessionIds: ["R1", "R2", "R1"],
      },
      executeEmptySessionCleanup,
    );

    assert.deepEqual(lockSets, [["R1", "R1-child", "R2"]]);
    assert.deepEqual(result.deletedSessionIds.sort(), ["R1", "R1-child", "R2"]);
    const tree = await runtime.sessionTreeService.getSessionTree({ userId });
    assert.deepEqual(Object.keys(tree.nodes), ["R3"]);
  });
});

test("deleteSessionBranch rejects empty or blank sessionIds", async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const userId = "u1";
    await initializeUserWorkspace(workspaceRoot, userId);
    const runtime = createTestSessionServices({ workspaceRoot });
    for (const sessionIds of [undefined, [], ["  "]]) {
      await assert.rejects(
        runtime.sessionTreeService.deleteSessionBranch(
          { userId, sessionIds },
          executeEmptySessionCleanup,
        ),
      );
    }
  });
});
