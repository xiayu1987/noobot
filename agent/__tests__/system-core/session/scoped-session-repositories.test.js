/*
 * Copyright (c) 2026 xiayu
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import test from "node:test";
import os from "node:os";
import path from "node:path";
import { mkdtemp, readFile, rm } from "node:fs/promises";

import { FileSystemSessionRepository } from "../../../src/system-core/session/repositories/file-system-session-repository.js";
import { FileSystemTaskRepository } from "../../../src/system-core/session/repositories/file-system-task-repository.js";
import { FileSystemExecutionRepository } from "../../../src/system-core/session/repositories/file-system-execution-repository.js";
import { StorageService } from "../../../src/system-core/session/storage-service.js";
import { normalizeMessagesEntity, normalizeSelectedConnectors } from "../../../src/system-core/session/entities/session-entity.js";
import { normalizeTaskEntity } from "../../../src/system-core/session/entities/task-entity.js";
import {
  ScopedSessionLocationResolver,
  createPersistenceContext,
} from "../../../src/system-core/session/session-location-resolver.js";

function buildHarness() {
  let root;
  const pathResolver = {
    resolveBasePath: (userId) => path.join(root, userId),
    sessionRoot: (basePath) => path.join(basePath, "runtime/session"),
    sessionsSummaryFile: (basePath) => path.join(basePath, "runtime/session/sessions.json"),
    deletedSessionMarkerFile: (basePath) => path.join(basePath, "runtime/session/.deleted-sessions.json"),
  };
  const sessionPathResolver = {
    async resolveSessionScope(userId, sessionId, parentSessionId = "") {
      const sessionDir = path.join(pathResolver.sessionRoot(pathResolver.resolveBasePath(userId)), sessionId);
      return {
        resolvedParentSessionId: String(parentSessionId || ""),
        sessionDir,
        sessionFile: path.join(sessionDir, "session.json"),
        sessionSummaryFile: path.join(sessionDir, "session-summary.json"),
        taskFile: path.join(sessionDir, "task.json"),
        executionFile: path.join(sessionDir, "execution.json"),
        executionEventsFile: path.join(sessionDir, "execution.jsonl"),
        metadataFile: path.join(sessionDir, "meta.json"),
        mutationLockDir: `${sessionDir}.mutation-lock`,
      };
    },
  };
  return {
    async setup() {
      root = await mkdtemp(path.join(os.tmpdir(), "noobot-scoped-session-"));
      await import("node:fs/promises").then(({ mkdir }) => mkdir(path.join(root, "alice"), { recursive: true }));
      const storageService = new StorageService({ pathResolver });
      const sessionRepo = new FileSystemSessionRepository({
        pathResolver,
        sessionPathResolver,
        storageService,
        normalizeMessages: normalizeMessagesEntity,
        normalizeSelectedConnectors,
      });
      const taskRepo = new FileSystemTaskRepository({
        pathResolver,
        sessionPathResolver,
        storageService,
        normalizeTask: normalizeTaskEntity,
        sessionRepository: sessionRepo,
      });
      const executionRepo = new FileSystemExecutionRepository({
        pathResolver,
        sessionPathResolver,
        storageService,
        sessionRepository: sessionRepo,
      });
      return { root, pathResolver, storageService, sessionRepo, taskRepo, executionRepo };
    },
    async cleanup() {
      if (root) await rm(root, { recursive: true, force: true });
    },
  };
}

async function readJson(file) {
  return JSON.parse(await readFile(file, "utf8"));
}

test("scoped repositories keep all artifacts and metadata in their execution directory without default leakage", async () => {
  const harness = buildHarness();
  const { root, pathResolver, sessionRepo, taskRepo, executionRepo } = await harness.setup();
  try {
    const resolver = new ScopedSessionLocationResolver({
      pathResolver,
      userId: "alice",
      allowedRoot: "runtime/workflow/session",
      relativeDir: "runtime/workflow/session/run-a/node-a",
    });
    const context = createPersistenceContext({
      locationResolver: resolver,
      metadataContributor: ({ sessionId, parentSessionId, scope }) => ({
        plugin: "workflow-test",
        sessionId,
        parentSessionId,
        sessionDir: scope.sessionDir,
      }),
    });

    await sessionRepo.withSessionMutation("alice", "child-a", "parent-a", async () => {
      await sessionRepo.ensureSession({
        userId: "alice",
        sessionId: "child-a",
        parentSessionId: "parent-a",
        meta: { caller: "bot", modelAlias: "m" },
        persistenceContext: context,
      });
      await taskRepo.save("alice", "child-a", {
        taskId: "task-a",
        skillName: "skill",
        taskName: "task",
        taskStatus: "start",
      }, "parent-a", context);
      await executionRepo.appendLog("alice", "child-a", { type: "event", value: 1 }, {}, "parent-a", context);
    }, context);

    const scope = await resolver.resolveSessionScope("alice", "child-a", "parent-a");
    assert.equal(scope.sessionDir, path.join(root, "alice/runtime/workflow/session/run-a/node-a"));
    assert.deepEqual(await readJson(scope.metadataFile), {
      plugin: "workflow-test",
      sessionId: "child-a",
      parentSessionId: "parent-a",
      sessionDir: scope.sessionDir,
    });
    assert.equal((await readJson(scope.sessionFile)).parentSessionId, "parent-a");
    assert.equal((await readJson(scope.sessionSummaryFile)).sessionId, "child-a");
    assert.equal((await readJson(scope.taskFile)).tasks[0].taskId, "task-a");
    assert.equal((await readFile(scope.executionEventsFile, "utf8")).trim().includes('"value":1'), true);

    const defaultRoot = path.join(root, "alice/runtime/session");
    assert.equal(await sessionRepo.storageService.exists(path.join(defaultRoot, "child-a/session.json")), false);
    assert.equal(await sessionRepo.storageService.exists(path.join(defaultRoot, "sessions.json")), false);
    assert.equal(await sessionRepo.storageService.exists(path.join(defaultRoot, ".deleted-sessions.json")), false);
    assert.equal(await sessionRepo.storageService.exists(path.join(defaultRoot, "session-tree.json")), false);
    assert.equal(await sessionRepo.storageService.exists(scope.mutationLockDir), false);
  } finally {
    await harness.cleanup();
  }
});

test("scoped repositories isolate concurrent contexts and mutation locks", async () => {
  const harness = buildHarness();
  const { pathResolver, sessionRepo, taskRepo, executionRepo } = await harness.setup();
  try {
    const makeContext = (name) => {
      const resolver = new ScopedSessionLocationResolver({
        pathResolver,
        userId: "alice",
        allowedRoot: "runtime/workflow/session",
        relativeDir: `runtime/workflow/session/run/${name}`,
      });
      return {
        resolver,
        context: createPersistenceContext({
          locationResolver: resolver,
          metadataContributor: () => ({ node: name }),
        }),
      };
    };
    const first = makeContext("node-1");
    const second = makeContext("node-2");

    await Promise.all([first, second].map(({ context }, index) => sessionRepo.withSessionMutation(
      "alice",
      `child-${index}`,
      "parent",
      async () => {
        await sessionRepo.ensureSession({ userId: "alice", sessionId: `child-${index}`, parentSessionId: "parent", persistenceContext: context });
        await taskRepo.save("alice", `child-${index}`, { taskId: `task-${index}`, taskStatus: "start" }, "parent", context);
        await executionRepo.appendLog("alice", `child-${index}`, { index }, {}, "parent", context);
      },
      context,
    )));

    const firstScope = await first.resolver.resolveSessionScope("alice", "child-0", "parent");
    const secondScope = await second.resolver.resolveSessionScope("alice", "child-1", "parent");
    assert.notEqual(firstScope.sessionDir, secondScope.sessionDir);
    assert.notEqual(firstScope.mutationLockDir, secondScope.mutationLockDir);
    assert.equal((await readJson(firstScope.metadataFile)).node, "node-1");
    assert.equal((await readJson(secondScope.metadataFile)).node, "node-2");
    assert.equal((await readJson(firstScope.taskFile)).tasks[0].taskId, "task-0");
    assert.equal((await readJson(secondScope.taskFile)).tasks[0].taskId, "task-1");
  } finally {
    await harness.cleanup();
  }
});

test("scoped metadata contributor failures abort the locked mutation", async () => {
  const harness = buildHarness();
  const { pathResolver, sessionRepo } = await harness.setup();
  try {
    const resolver = new ScopedSessionLocationResolver({
      pathResolver,
      userId: "alice",
      allowedRoot: "runtime/workflow/session",
      relativeDir: "runtime/workflow/session/run-fail/node",
    });
    const context = createPersistenceContext({
      locationResolver: resolver,
      metadataContributor: () => {
        throw new Error("metadata boom");
      },
    });
    await assert.rejects(() => sessionRepo.withSessionMutation("alice", "child", "parent", async () => {
      await sessionRepo.ensureSession({ userId: "alice", sessionId: "child", parentSessionId: "parent", persistenceContext: context });
    }, context), /metadata boom/);
    const scope = await resolver.resolveSessionScope("alice", "child", "parent");
    assert.equal(await sessionRepo.storageService.exists(scope.metadataFile), false);
    assert.equal(await sessionRepo.storageService.exists(scope.mutationLockDir), false);
  } finally {
    await harness.cleanup();
  }
});
