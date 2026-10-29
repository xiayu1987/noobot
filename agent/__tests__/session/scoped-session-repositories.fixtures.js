/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import os from "node:os";
import path from "node:path";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createTestSessionServices } from "../helpers/session-services.js";
import { initializeUserWorkspace } from "../helpers/user-workspace.js";
import { applyRuntimeEventsEnv } from "@noobot/runtime-events/testing";

export function buildHarness() {
  let root;
  let restoreRuntimeEventsEnv;
  return {
    async setup() {
      root = await mkdtemp(path.join(os.tmpdir(), "noobot-scoped-session-"));
      restoreRuntimeEventsEnv = applyRuntimeEventsEnv({ workspaceRoot: root });
      await initializeUserWorkspace(root, "alice");
      const runtime = createTestSessionServices({ workspaceRoot: root });
      const { sessionRepository, fileSystemExecutionRepository } = runtime.repositories;
      return {
        root,
        runtime,
        pathResolver: runtime.pathResolver,
        storageService: runtime.storageService,
        sessionRepo: sessionRepository,
        executionRepo: fileSystemExecutionRepository,
      };
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
