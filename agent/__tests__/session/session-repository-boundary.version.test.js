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
import { SESSION_ERROR_CODE } from "@noobot/session-protocol";
import { SESSION_CALLER } from "@noobot/shared/session-caller";

import { createTestSessionServices, provisionTestSession } from "../helpers/session-services.js";
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
    const session = await repository.findById(userId, "A", { persistenceContext });
    return await fn({ userId, repository, persistenceContext, session });
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
}

test("save rejects a stale expected aggregate version with the protocol conflict error", async () => {
  await withProvisionedSession(async ({ userId, repository, persistenceContext, session }) => {
    const staleVersion = session.aggregateVersion + 1;
    await assert.rejects(
      repository.save(userId, session, {
        expectedAggregateVersion: staleVersion,
        persistenceContext,
      }),
      {
        statusCode: 409,
        code: SESSION_ERROR_CODE.AGGREGATE_VERSION_CONFLICT,
        currentVersion: session.aggregateVersion,
      },
    );
  });
});

test("save rejects an expected version for a registered session without an artifact as not found", async () => {
  await withProvisionedSession(async ({ userId, repository, persistenceContext, session }) => {
    const scope = await repository.requireSessionScope(userId, "A", persistenceContext);
    await rm(scope.sessionFile);
    await assert.rejects(
      repository.save(userId, session, {
        expectedAggregateVersion: session.aggregateVersion,
        persistenceContext,
      }),
      { statusCode: 404, code: SESSION_ERROR_CODE.SESSION_NOT_FOUND },
    );
  });
});
