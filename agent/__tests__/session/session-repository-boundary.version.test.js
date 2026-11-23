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
import { SESSION_CALLER } from "@noobot/shared/session-caller";

import {
  createTestSessionServices,
  provisionTestSession,
  submitTestSessionRequest,
} from "../helpers/session-services.js";
import { initializeUserWorkspace } from "../helpers/user-workspace.js";

async function withProvisionedSession(fn) {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "noobot-session-version-"));
  try {
    const userId = "u1";
    await initializeUserWorkspace(workspaceRoot, userId);
    const runtime = createTestSessionServices({ workspaceRoot });
    await provisionTestSession(runtime, {
      userId,
      sessionId: "A",
      parentSessionId: "",
      caller: SESSION_CALLER.USER,
    });
    const repository = runtime.repositories.sessionRepository;
    const persistenceContext = repository.treePersistenceContext(userId, "A");
    const reader = await repository.requireSessionReader(userId, "A", { persistenceContext });
    return await fn({ userId, repository, persistenceContext, reader });
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
}

test("incremental commit rejects a stale generation without changing committed metadata", async () => {
  await withProvisionedSession(async ({ userId, repository, persistenceContext, reader }) => {
    const command = {
      operationId: "version-first",
      committedAt: repository.now(),
      changes: { sessionMetadata: { customTitle: "committed title" } },
    };
    const submit = (request) =>
      submitTestSessionRequest(repository, userId, "A", request, persistenceContext);
    await submit(await reader.prepareRequest(command));
    await assert.rejects(
      submit(
        await reader.prepareRequest({
          ...command,
          operationId: "version-stale",
          changes: { sessionMetadata: { customTitle: "stale title" } },
        }),
      ),
      {
        code: "SESSION_GENERATION_CONFLICT",
      },
    );
    const current = await repository.requireSessionReader(userId, "A", { persistenceContext });
    assert.equal(current.generation, reader.generation + 1);
    assert.equal((await current.readMetadata()).customTitle, "committed title");
    assert.notEqual((await reader.readMetadata()).customTitle, "committed title");
  });
});

test("a switched session with a missing head rejects reads and commits as corruption", async () => {
  await withProvisionedSession(async ({ userId, repository, persistenceContext, reader }) => {
    const scope = await repository.requireSessionScope(userId, "A", persistenceContext);
    await rm(path.join(scope.sessionDir, "head.json"));
    await assert.rejects(repository.requireSessionReader(userId, "A", { persistenceContext }), {
      code: "SESSION_IMMUTABLE_STORAGE_INVALID",
    });
    await assert.rejects(
      submitTestSessionRequest(
        repository,
        userId,
        "A",
        await reader.prepareRequest({
          operationId: "missing-head",
          committedAt: repository.now(),
          changes: { sessionMetadata: { customTitle: "must not recreate" } },
        }),
        persistenceContext,
      ),
      { code: "SESSION_IMMUTABLE_STORAGE_INVALID" },
    );
    await assert.rejects(access(path.join(scope.sessionDir, "head.json")), {
      code: "ENOENT",
    });
  });
});
