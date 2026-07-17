/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
// Tests split by responsibility from session-repository-boundary.test.js.
import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";

import { createSessionServices } from "../../../src/system-core/session/index.js";
import { writeSessionArtifact } from "../../../src/system-core/session/session-artifact-store.js";
import { buildSessionDisplaySummary } from "../../../src/system-core/session/session-summary-builders.js";

async function withTempWorkspace(fn) {
  const workspaceRoot = await mkdtemp(
    path.join(os.tmpdir(), "noobot-session-boundary-"),
  );
  try {
    return await fn(workspaceRoot);
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
}

async function exists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

















test("renameSession should persist custom title to full, display summary and sessions summary", async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const userId = "u1";
    await mkdir(path.join(workspaceRoot, userId), { recursive: true });

    const runtime = createSessionServices(
      { workspaceRoot },
      { now: () => "2026-05-14T01:02:03.000Z" },
    );

    await runtime.sessionTreeService.upsertSessionTree({ userId, sessionId: "A" });
    await runtime.sessionCrudService.ensureSession(userId, "A", "");
    const session = await runtime.repositories.sessionRepository.findById(userId, "A", "");
    session.messages = [{ role: "user", content: "old generated title" }];
    await runtime.repositories.sessionRepository.save(userId, session, "");

    const renamed = await runtime.sessionCrudService.renameSession({
      userId,
      sessionId: "A",
      title: "  新会话名称  ",
    });

    assert.equal(renamed.customTitle, "新会话名称");
    assert.equal(renamed.updatedAt, "2026-05-14T01:02:03.000Z");

    const scope = await runtime.repositories.sessionRepository.resolveSessionScope(userId, "A", "");
    const full = JSON.parse(await readFile(scope.sessionFile, "utf8"));
    const displaySummary = JSON.parse(await readFile(path.join(scope.sessionDir, "session-summary.json"), "utf8"));
    const sessionsSummary = JSON.parse(
      await readFile(path.join(workspaceRoot, userId, "runtime", "session", "sessions.json"), "utf8"),
    );

    assert.equal(full.customTitle, "新会话名称");
    assert.equal(displaySummary.title, "新会话名称");
    assert.equal(sessionsSummary.sessions.find((item) => item.sessionId === "A").title, "新会话名称");
  });
});

test("renameSession should validate title and return null for missing session", async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const userId = "u1";
    await mkdir(path.join(workspaceRoot, userId), { recursive: true });
    const runtime = createSessionServices({ workspaceRoot });

    await assert.rejects(
      () => runtime.sessionCrudService.renameSession({ userId, sessionId: "missing", title: "   " }),
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







