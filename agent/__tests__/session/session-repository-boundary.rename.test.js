/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import test from "node:test";
import { SESSION_ERROR_CODE } from "@noobot/session-protocol";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp, readFile, rm } from "node:fs/promises";

import {
  createTestSessionServices,
  provisionTestSession,
  withTreeContext,
} from "../helpers/session-services.js";
import { readSessionArtifact } from "../../src/session/session-artifact-store.js";
import { initializeUserWorkspace } from "../helpers/user-workspace.js";
import { applySessionMessageFacts } from "../helpers/session-message-facts.js";
import { SESSION_CALLER } from "@noobot/shared/session-caller";
import { TEST_MESSAGE_TS } from "../helpers/session-run-payload.js";

async function withTempWorkspace(fn) {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "noobot-session-boundary-"));
  try {
    return await fn(workspaceRoot);
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
}

test("renameSession should persist custom title to full, display summary and sessions summary", async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const userId = "u1";
    await initializeUserWorkspace(workspaceRoot, userId);

    const runtime = createTestSessionServices(
      { workspaceRoot },
      { now: () => "2026-05-14T01:02:03.000Z" },
    );

    await provisionTestSession(runtime, {
      userId,
      sessionId: "A",
      parentSessionId: "",
      caller: SESSION_CALLER.USER,
    });
    const session = await runtime.repositories.sessionRepository.findById(userId, "A", {
      persistenceContext: runtime.repositories.sessionRepository.treePersistenceContext(
        userId,
        "A",
      ),
    });
    session.messages = [
      {
        messageUid: "sm_rename_user",
        ts: TEST_MESSAGE_TS,
        sessionId: "A",
        role: "user",
        messageOrigin: "natural",
        content: "old generated title",
        dialogProcessId: "dialog-rename",
        turnScopeId: "turn-rename",
      },
    ];
    await runtime.repositories.sessionRepository.save(userId, applySessionMessageFacts(session), {
      persistenceContext: runtime.repositories.sessionRepository.treePersistenceContext(
        userId,
        session.sessionId,
      ),
    });

    const renamed = await runtime.sessionCrudService.renameSession(
      withTreeContext(runtime, { userId, sessionId: "A", title: "  新会话名称  " }),
    );

    assert.equal(renamed.customTitle, "新会话名称");
    assert.equal(renamed.updatedAt, "2026-05-14T01:02:03.000Z");

    const scope = await runtime.repositories.sessionRepository.requireSessionScope(
      userId,
      "A",
      runtime.repositories.sessionRepository.treePersistenceContext(userId, "A"),
    );
    const full = await readSessionArtifact({ sessionDir: scope.sessionDir });
    await runtime.repositories.sessionRepository.ensureSessionDisplaySummary(userId, "A", {
      persistenceContext: runtime.repositories.sessionRepository.treePersistenceContext(
        userId,
        "A",
      ),
    });
    const displaySummary = JSON.parse(
      await readFile(path.join(scope.sessionDir, "session-summary.json"), "utf8"),
    );
    const sessionsSummary = JSON.parse(
      await readFile(
        path.join(workspaceRoot, userId, "runtime", "session", "sessions.json"),
        "utf8",
      ),
    );

    assert.equal(full.customTitle, "新会话名称");
    assert.equal(displaySummary.title, "新会话名称");
    assert.equal(
      sessionsSummary.sessions.find((item) => item.sessionId === "A").title,
      "新会话名称",
    );
  });
});

test("renameSession should validate title and reject a missing session as not found", async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const userId = "u1";
    await initializeUserWorkspace(workspaceRoot, userId);
    const runtime = createTestSessionServices({ workspaceRoot });

    await assert.rejects(
      () =>
        runtime.sessionCrudService.renameSession({ userId, sessionId: "missing", title: "   " }),
      /Session title is required/,
    );

    await assert.rejects(
      runtime.sessionCrudService.renameSession(
        withTreeContext(runtime, { userId, sessionId: "missing", title: "new title" }),
      ),
      { code: SESSION_ERROR_CODE.SESSION_NOT_FOUND, statusCode: 404 },
    );
  });
});
