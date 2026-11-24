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
import { PARTITION_JOURNAL_HEAD_FILE } from "@noobot/session-protocol/partition-journal";

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
    await using runtime = createTestSessionServices({ workspaceRoot });
    await provisionTestSession(runtime, {
      userId,
      sessionId: "A",
      parentSessionId: "",
      caller: SESSION_CALLER.USER,
    });
    const repository = runtime.repositories.sessionRepository;
    const persistenceContext = repository.treePersistenceContext(userId, "A");
    await using reader = await repository.requireSessionReader(userId, "A", { persistenceContext });
    return await fn({ userId, repository, persistenceContext, reader });
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
}

test("incremental commit rejects reuse of a published sequence with different content", async () => {
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
        code: "SESSION_OPERATION_CONFLICT",
      },
    );
    await using current = await repository.requireSessionReader(userId, "A", {
      persistenceContext,
    });
    assert.equal(current.generation, reader.generation + 1);
    assert.equal((await current.readMetadata()).customTitle, "committed title");
    assert.notEqual((await reader.readMetadata()).customTitle, "committed title");
  });
});

test("a live session missing CURRENT rejects reads and commits as corruption", async () => {
  await withProvisionedSession(async ({ userId, repository, persistenceContext, reader }) => {
    const scope = await repository.requireSessionScope(userId, "A", persistenceContext);
    const current = path.join(scope.sessionDir, PARTITION_JOURNAL_HEAD_FILE);
    const request = await reader.prepareRequest({
      operationId: "missing-current",
      committedAt: repository.now(),
      changes: { sessionMetadata: { customTitle: "must not recreate" } },
    });
    await reader.close();
    await rm(current);
    await assert.rejects(repository.requireSessionReader(userId, "A", { persistenceContext }), {
      code: "SESSION_STORAGE_CORRUPT",
    });
    await assert.rejects(
      submitTestSessionRequest(repository, userId, "A", request, persistenceContext),
      { code: "SESSION_STORAGE_CORRUPT" },
    );
    await assert.rejects(access(current), {
      code: "ENOENT",
    });
  });
});
