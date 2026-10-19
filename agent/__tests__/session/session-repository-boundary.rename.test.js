/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp, readFile, rm } from "node:fs/promises";

import { createTestSessionServices } from "../helpers/session-services.js";
import { readSessionArtifact } from "../../src/session/session-artifact-store.js";
import { initializeUserWorkspace } from "../helpers/user-workspace.js";
import { applySessionMessageFacts } from "../helpers/session-message-facts.js";
import { SESSION_CALLER } from "@noobot/shared/session-caller";

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

    await runtime.sessionCrudService.ensureSession(userId, "A", "", SESSION_CALLER.USER);
    const session = await runtime.repositories.sessionRepository.findById(userId, "A", "");
    session.messages = [
      {
        messageUid: "sm_rename_user",
        role: "user",
        content: "old generated title",
        dialogProcessId: "dialog-rename",
        turnScopeId: "turn-rename",
      },
    ];
    await runtime.repositories.sessionRepository.save(
      userId,
      applySessionMessageFacts(session),
      "",
    );

    const renamed = await runtime.sessionCrudService.renameSession({
      userId,
      sessionId: "A",
      title: "  新会话名称  ",
    });

    assert.equal(renamed.customTitle, "新会话名称");
    assert.equal(renamed.updatedAt, "2026-05-14T01:02:03.000Z");

    const scope = await runtime.repositories.sessionRepository.resolveSessionScope(userId, "A", "");
    const full = await readSessionArtifact({ sessionDir: scope.sessionDir });
    await runtime.repositories.sessionRepository.ensureSessionDisplaySummary(userId, "A", "");
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

test("renameSession should validate title and return null for missing session", async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const userId = "u1";
    await initializeUserWorkspace(workspaceRoot, userId);
    const runtime = createTestSessionServices({ workspaceRoot });

    await assert.rejects(
      () =>
        runtime.sessionCrudService.renameSession({ userId, sessionId: "missing", title: "   " }),
      /Session title is required/,
    );

    const result = await runtime.sessionCrudService.renameSession({
      userId,
      sessionId: "missing",
      title: "new title",
    });
    assert.equal(result, null);
  });
});
