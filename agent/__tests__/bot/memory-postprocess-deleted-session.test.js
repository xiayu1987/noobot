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

import { withRuntimeEventsEnv } from "@noobot/runtime-events/testing";
import { SESSION_CALLER } from "@noobot/shared/session-caller";
import { createSessionFacade } from "../../src/session/index.js";
import { MemoryPostProcessService } from "../../src/bot/execution/memory-postprocess.js";
import {
  createTestSessionServices,
  provisionTestSession,
  testWallClock,
} from "../helpers/session-services.js";
import { initializeUserWorkspace } from "../helpers/user-workspace.js";

const USER_ID = "u1";
const SESSION_ID = "memory-target";

async function exists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

test("memory postprocess for a session deleted after scheduling reports SESSION_DELETED without recreating it", async () => {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "noobot-memory-delete-"));
  try {
    await withRuntimeEventsEnv({ workspaceRoot }, async () => {
      await initializeUserWorkspace(workspaceRoot, USER_ID);
      const runtime = createTestSessionServices({ workspaceRoot });
      const repository = runtime.repositories.sessionRepository;
      await provisionTestSession(runtime, {
        userId: USER_ID,
        sessionId: SESSION_ID,
        caller: SESSION_CALLER.USER,
      });
      const scope = await repository.requireSessionScope(
        USER_ID,
        SESSION_ID,
        repository.treePersistenceContext(USER_ID, SESSION_ID),
      );
      const session = createSessionFacade(runtime);
      const captures = [];
      const loggedErrors = [];
      const service = new MemoryPostProcessService({
        now: testWallClock,
        globalConfig: {},
        session,
        memory: {
          async captureDialogToShortMemory(payload) {
            captures.push(payload);
          },
          async maybeSummarize() {},
        },
        errorLogger: {
          async log(entry) {
            loggedErrors.push(entry);
          },
        },
      });
      await session.deleteSessionBranch({ userId: USER_ID, sessionIds: [SESSION_ID] });

      await assert.rejects(
        service.runMemoryPostProcessFlow({
          userId: USER_ID,
          sessionId: SESSION_ID,
          parentSessionId: "",
          dialogProcessId: "dp-memory",
          persistenceScope: null,
          userConfig: {},
          mode: "async",
        }),
        (error) => {
          assert.ok(error instanceof AggregateError);
          assert.deepEqual(
            error.errors.map((entry) => entry?.code),
            ["SESSION_DELETED", "EXECUTION_LOG_PERSISTENCE_FAILED"],
          );
          assert.equal(error.cause.statusCode, 410);
          return true;
        },
      );

      assert.deepEqual(captures, []);
      assert.equal(loggedErrors.length, 1);
      assert.equal(loggedErrors[0].error.code, "SESSION_DELETED");
      assert.equal(await exists(scope.sessionDir), false);
    });
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});
