/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import os from "node:os";
import path from "node:path";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { FileSystemSessionRepository } from "../../src/session/repositories/file-system-session-repository.js";
import { FileSystemSessionTreeRepository } from "../../src/session/repositories/file-system-session-tree-repository.js";
import { FileSystemTaskRepository } from "../../src/session/repositories/file-system-task-repository.js";
import { FileSystemExecutionRepository } from "../../src/session/repositories/file-system-execution-repository.js";
import { StorageService } from "../../src/session/storage-service.js";
import { normalizeTaskEntity } from "../../src/session/entities/task-entity.js";
import { PathResolver } from "../../src/session/path-resolver.js";
import { initializeUserWorkspace } from "../helpers/user-workspace.js";
import { applyRuntimeEventsEnv } from "@noobot/runtime-events/testing";

export function buildHarness() {
  let root;
  let restoreRuntimeEventsEnv;
  const pathResolver = new PathResolver({
    get workspaceRoot() {
      return root;
    },
  });
  const sessionPathResolver = {
    async resolveSessionScope(userId, sessionId, parentSessionId) {
      const sessionDir = path.join(
        pathResolver.sessionRoot(pathResolver.resolveBasePath(userId)),
        sessionId,
      );
      return {
        resolvedParentSessionId: parentSessionId,
        sessionDir,
        sessionFile: path.join(sessionDir, "session.json"),
        sessionSummaryFile: path.join(sessionDir, "session-summary.json"),
        taskFile: path.join(sessionDir, "task.json"),
        metadataFile: path.join(sessionDir, "meta.json"),
      };
    },
  };
  return {
    async setup() {
      root = await mkdtemp(path.join(os.tmpdir(), "noobot-scoped-session-"));
      restoreRuntimeEventsEnv = applyRuntimeEventsEnv({ workspaceRoot: root });
      await initializeUserWorkspace(root, "alice");
      const storageService = new StorageService({ pathResolver });
      const sessionRepo = new FileSystemSessionRepository({
        pathResolver,
        sessionPathResolver,
        sessionTreeRepository: new FileSystemSessionTreeRepository({
          pathResolver,
          storageService,
        }),
        storageService,
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
      restoreRuntimeEventsEnv();
      await rm(root, { recursive: true, force: true });
    },
  };
}

export async function readJson(file) {
  return JSON.parse(await readFile(file, "utf8"));
}

export function readJournalLines(text) {
  return text
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}
