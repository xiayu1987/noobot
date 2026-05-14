import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp, mkdir, rm } from "node:fs/promises";

import { createSessionServices } from "../../../system-core/session/index.js";

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
    await mkdir(path.join(workspaceRoot, "u1"), { recursive: true });

    const runtime = createSessionServices(
      { workspaceRoot },
      { now: () => "2026-05-14T00:00:00.000Z" },
    );

    assert.ok(runtime.services.sessionTreeService);
    assert.ok(runtime.services.sessionCrudService);
    assert.ok(runtime.services.sessionMessageService);
    assert.ok(runtime.services.sessionContextService);
    assert.ok(runtime.services.taskService);
    assert.ok(runtime.services.executionLogService);

    assert.equal(runtime.sessionTreeService, runtime.services.sessionTreeService);
    assert.equal(runtime.sessionCrudService, runtime.services.sessionCrudService);
    assert.equal(runtime.sessionMessageService, runtime.services.sessionMessageService);
    assert.equal(runtime.sessionContextService, runtime.services.sessionContextService);

    assert.equal(
      runtime.services.sessionContextService.sessionMessageService,
      runtime.services.sessionMessageService,
    );
    assert.equal(
      runtime.services.sessionMessageService.sessionCrudService,
      runtime.services.sessionCrudService,
    );
    assert.equal(
      runtime.services.executionLogService.executionRepo,
      runtime.repositories.executionRepository,
    );
    assert.equal(
      runtime.services.executionLogService.sessionRepo,
      runtime.repositories.sessionRepository,
    );
    assert.equal(runtime.services.taskService.taskRepo, runtime.repositories.taskRepository);
    assert.equal(
      runtime.services.sessionTreeService.treeRepo,
      runtime.repositories.sessionTreeRepository,
    );
  });
});
