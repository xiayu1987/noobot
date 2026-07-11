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


























test("session save persists thinking timing fields to full session and display summary", async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const userId = "u-thinking";
    await mkdir(path.join(workspaceRoot, userId), { recursive: true });

    const runtime = createSessionServices(
      { workspaceRoot },
      { now: () => "2026-07-08T10:00:10.000Z" },
    );

    await runtime.sessionTreeService.upsertSessionTree({ userId, sessionId: "S" });
    await runtime.sessionCrudService.ensureSession(userId, "S", "");
    const session = await runtime.repositories.sessionRepository.findById(userId, "S", "");
    session.messages = [
      { role: "user", content: "hello", turnScopeId: "turn-1" },
      {
        role: "assistant",
        content: "first assistant chunk",
        turnScopeId: "turn-1",
        dialogProcessId: "dp-1",
        thinkingStartedAt: "2026-07-08T10:00:00.000Z",
      },
      {
        role: "assistant",
        content: "final assistant chunk",
        turnScopeId: "turn-1",
        dialogProcessId: "dp-1",
        thinkingFinishedAt: "2026-07-08T10:00:04.000Z",
      },
    ];
    await runtime.repositories.sessionRepository.save(userId, session, "");

    const scope = await runtime.repositories.sessionRepository.resolveSessionScope(userId, "S", "");
    const full = JSON.parse(await readFile(scope.sessionFile, "utf8"));
    const displaySummary = JSON.parse(await readFile(path.join(scope.sessionDir, "session-summary.json"), "utf8"));

    const fullAssistant = full.messages.filter((item) => item.role === "assistant");
    assert.equal(fullAssistant[0].thinkingStartedAt, "2026-07-08T10:00:00.000Z");
    assert.equal(fullAssistant[0].thinkingFinishedAt, undefined);
    assert.equal(fullAssistant[1].thinkingStartedAt, undefined);
    assert.equal(fullAssistant[1].thinkingFinishedAt, "2026-07-08T10:00:04.000Z");

    const summaryAssistant = displaySummary.messages.filter((item) => item.role === "assistant");
    assert.equal(summaryAssistant[0].thinkingStartedAt, "2026-07-08T10:00:00.000Z");
    assert.equal(summaryAssistant[0].thinkingFinishedAt, undefined);
    assert.equal(summaryAssistant[1].thinkingStartedAt, undefined);
    assert.equal(summaryAssistant[1].thinkingFinishedAt, "2026-07-08T10:00:04.000Z");
  });
});
