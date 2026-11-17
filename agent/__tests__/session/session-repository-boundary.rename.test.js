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
import { mkdtemp, rm } from "node:fs/promises";

import {
  createTestSessionServices,
  provisionTestSession,
  withTreeContext,
  commitTestSessionChanges,
} from "../helpers/session-services.js";
import { initializeUserWorkspace } from "../helpers/user-workspace.js";
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
    const messages = [
      {
        attachments: [],
        messageUid: "sm_rename_user",
        ts: TEST_MESSAGE_TS,
        sessionId: "A",
        parentSessionId: "",
        parentDialogProcessId: "",
        userMessageId: "um_rename_user",
        role: "user",
        messageOrigin: "natural",
        content: "old generated title",
        dialogProcessId: "dialog-rename",
        turnScopeId: "turn-rename",
      },
    ];
    await commitTestSessionChanges(runtime, {
      userId,
      sessionId: "A",
      changes: { messages },
    });

    const renamed = await runtime.sessionCrudService.renameSession(
      withTreeContext(runtime, { userId, sessionId: "A", title: "  新会话名称  " }),
    );

    assert.equal(renamed.customTitle, "新会话名称");
    assert.equal(renamed.updatedAt, "2026-05-14T01:02:03.000Z");

    const reader = await runtime.repositories.sessionRepository.requireSessionReader(userId, "A", {
      persistenceContext: runtime.repositories.sessionRepository.treePersistenceContext(
        userId,
        "A",
      ),
    });
    const full = await reader.exportSession();
    const displaySummary = await runtime.repositories.sessionRepository.readSessionDisplaySummary(
      userId,
      "A",
      {
        persistenceContext: runtime.repositories.sessionRepository.treePersistenceContext(
          userId,
          "A",
        ),
      },
    );
    const sessionsSummary =
      await runtime.repositories.sessionRepository.readSessionsSummary(userId);

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
