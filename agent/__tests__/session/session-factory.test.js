/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp, rm } from "node:fs/promises";

import { createTestSessionServices } from "../helpers/session-services.js";
import { initializeUserWorkspace } from "../helpers/user-workspace.js";

async function withTempWorkspace(fn) {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "noobot-session-factory-"));
  try {
    return await fn(workspaceRoot);
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
}

test("createSessionServices wires repositories/services with expected dependency chain", async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    await initializeUserWorkspace(workspaceRoot, "u1");

    const runtime = createTestSessionServices(
      { workspaceRoot },
      { now: () => "2026-05-14T00:00:00.000Z" },
    );

    assert.ok(runtime.sessionTreeService);
    assert.ok(runtime.sessionCrudService);
    assert.ok(runtime.sessionMessageService);
    assert.ok(runtime.sessionContextService);
    assert.ok(runtime.executionLogService);

    assert.equal(
      runtime.sessionContextService.sessionMessageService,
      runtime.sessionMessageService,
    );
    assert.equal(runtime.sessionMessageService.sessionCrudService, runtime.sessionCrudService);
    assert.equal(
      runtime.executionLogService.executionRepo,
      runtime.repositories.executionRepository,
    );
    assert.equal(runtime.executionLogService.sessionRepo, runtime.repositories.sessionRepository);
    assert.equal(runtime.sessionTreeService.treeRepo, runtime.repositories.sessionTreeRepository);
  });
});
