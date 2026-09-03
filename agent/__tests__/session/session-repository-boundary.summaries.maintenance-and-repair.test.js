/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";

import { createSessionServices } from "../../src/session/index.js";
import { writeSessionArtifact } from "../../src/session/session-artifact-store.js";
import { SESSIONS_SUMMARY_SCHEMA_VERSION } from "../../src/session/session-summary-builders.js";
import {
  canonicalMessages,
  withTempWorkspace,
} from "./session-repository-boundary.summaries.fixtures.js";

test("session summaries should be maintained and rebuilt for list API", async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const userId = "u1";
    await mkdir(path.join(workspaceRoot, userId), { recursive: true });

    const runtime = createSessionServices(
      { workspaceRoot },
      { now: () => "2026-05-14T00:00:00.000Z" },
    );

    await runtime.sessionTreeService.upsertSessionTree({ userId, sessionId: "A" });
    await runtime.sessionCrudService.ensureSession(userId, "A", "");
    await runtime.sessionTreeService.upsertSessionTree({
      userId,
      sessionId: "B",
      parentSessionId: "A",
    });
    await runtime.sessionCrudService.ensureSession(userId, "B", "A");

    const sessionB = await runtime.repositories.sessionRepository.findById(userId, "B", "A");
    sessionB.messages = canonicalMessages(
      [
        { role: "system", content: "ignored" },
        { role: "user", content: "1234567890123456789012345" },
        { role: "assistant", content: "done", attachmentMetas: [{ id: "big" }] },
      ],
      "list_b",
    );
    sessionB.currentTaskId = "task-b";
    sessionB.aggregateVersion = 4;
    await runtime.repositories.sessionRepository.save(userId, sessionB, "A");

    let summary = await runtime.repositories.sessionRepository.readSessionsSummary(userId);
    assert.equal(summary.schemaVersion, SESSIONS_SUMMARY_SCHEMA_VERSION);
    const writtenB = summary.sessions.find((item) => item.sessionId === "B");
    assert.equal(writtenB.title, "12345678901234567890");
    assert.equal(writtenB.messageCount, 3);
    assert.equal(writtenB.aggregateVersion, 4);
    assert.equal(writtenB.depth, 0);
    assert.equal(Array.isArray(writtenB.messages), false);
    assert.equal(writtenB.lastMessage.role, "assistant");
    assert.equal("attachmentMetas" in writtenB.lastMessage, false);

    const list = await runtime.sessionCrudService.getAllSessionSummaries({ userId });
    const listedB = list.find((item) => item.sessionId === "B");
    assert.equal(list.length, 2);
    assert.equal(listedB.aggregateVersion, 4);
    assert.equal(listedB.depth, 2);
    assert.equal("messages" in listedB, false);

    summary = JSON.parse(
      await readFile(
        path.join(workspaceRoot, userId, "runtime", "session", "sessions.json"),
        "utf8",
      ),
    );
    assert.equal(summary.sessions.find((item) => item.sessionId === "B").depth, 2);
  });
});

test("session list excludes orphan session-tree nodes without Session artifacts", async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const userId = "u-tree-orphans";
    await mkdir(path.join(workspaceRoot, userId), { recursive: true });
    const runtime = createSessionServices({ workspaceRoot });
    await runtime.sessionCrudService.ensureSession(userId, "materialized", "");
    await runtime.sessionTreeService.upsertSessionTree({ userId, sessionId: "orphan" });

    const summaries = await runtime.sessionCrudService.getAllSessionSummaries({ userId });
    assert.deepEqual(
      summaries.map((item) => item.sessionId),
      ["materialized"],
    );
  });
});

test("session discovery traverses only canonical Session directories", async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const userId = "u-session-discovery";
    await mkdir(path.join(workspaceRoot, userId), { recursive: true });
    const runtime = createSessionServices({ workspaceRoot });

    await runtime.sessionTreeService.upsertSessionTree({ userId, sessionId: "root" });
    await runtime.sessionCrudService.ensureSession(userId, "root", "");
    await runtime.sessionTreeService.upsertSessionTree({
      userId,
      sessionId: "child",
      parentSessionId: "root",
    });
    await runtime.sessionCrudService.ensureSession(userId, "child", "root");

    const runtimeSessionRoot = path.join(workspaceRoot, userId, "runtime", "session");
    const nonSessionTree = path.join(runtimeSessionRoot, "root", "turn-snapshots", "nested");
    await mkdir(nonSessionTree, { recursive: true });
    await writeFile(path.join(nonSessionTree, "session.json"), "{}", "utf8");

    assert.deepEqual((await runtime.repositories.sessionRepository.listSessionIds(userId)).sort(), [
      "child",
      "root",
    ]);
  });
});

test("session summary rebuild isolates an unreadable session as an unavailable projection", async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const userId = "u-unavailable";
    await mkdir(path.join(workspaceRoot, userId), { recursive: true });
    const runtime = createSessionServices(
      { workspaceRoot },
      { now: () => "2026-08-08T00:00:00.000Z" },
    );
    await runtime.sessionCrudService.ensureSession(userId, "available", "");
    await runtime.sessionCrudService.ensureSession(userId, "legacy", "");

    const repository = runtime.repositories.sessionRepository;
    const findById = repository.findById.bind(repository);
    repository.findById = async (...args) => {
      if (args[1] === "legacy") {
        const error = new Error("invalid_transfer_envelope:forbidden_path_field");
        error.code = "INVALID_TRANSFER_ENVELOPE";
        throw error;
      }
      return findById(...args);
    };

    const payload = await repository.rebuildSessionsSummary(userId);
    const available = payload.sessions.find((item) => item.sessionId === "available");
    const unavailable = payload.sessions.find((item) => item.sessionId === "legacy");
    assert.equal(available.availability, "available");
    assert.equal(unavailable.availability, "unavailable");
    assert.deepEqual(unavailable.messages, []);
    assert.equal(unavailable.messageCount, 0);
    assert.equal(unavailable.lastMessage, null);
    assert.equal(unavailable.unavailableReason.code, "INVALID_TRANSFER_ENVELOPE");
    assert.equal(
      unavailable.unavailableReason.message,
      "invalid_transfer_envelope:forbidden_path_field",
    );

    const persisted = await repository.readSessionsSummary(userId);
    assert.equal(
      persisted.sessions.find((item) => item.sessionId === "legacy").availability,
      "unavailable",
    );
  });
});

test("failed Session repair is marked and skipped on subsequent reads", async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const userId = "u-repair-failed";
    const sessionId = "broken";
    await mkdir(path.join(workspaceRoot, userId), { recursive: true });
    const runtime = createSessionServices({ workspaceRoot });
    await runtime.sessionCrudService.ensureSession(userId, sessionId, "");
    const sessionDir = path.join(workspaceRoot, userId, "runtime", "session", sessionId);
    await writeFile(path.join(sessionDir, "session.json"), "{invalid-json", "utf8");

    const repository = runtime.repositories.sessionRepository;
    let firstErrorCode = "";
    await assert.rejects(repository.findById(userId, sessionId, ""), (error) => {
      firstErrorCode = error.code;
      return Boolean(firstErrorCode);
    });
    const lifecycleFile = path.join(
      workspaceRoot,
      userId,
      "runtime",
      "session",
      ".lifecycle",
      "records",
      `${encodeURIComponent(sessionId)}.json`,
    );
    const lifecycle = JSON.parse(await readFile(lifecycleFile, "utf8"));
    assert.equal(lifecycle.repair.status, "failed");

    await assert.rejects(
      repository.findById(userId, sessionId, ""),
      (error) => error.code === firstErrorCode,
    );
    const unchanged = JSON.parse(await readFile(lifecycleFile, "utf8"));
    assert.equal(unchanged.repair.failedAt, lifecycle.repair.failedAt);
  });
});

test("display maintenance migrates repairable artifacts through the Session repair project", async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const userId = "u1";
    const sessionId = "legacy";
    await mkdir(path.join(workspaceRoot, userId), { recursive: true });
    const runtime = createSessionServices({ workspaceRoot });
    await runtime.sessionTreeService.upsertSessionTree({ userId, sessionId });
    await runtime.sessionCrudService.ensureSession(userId, sessionId, "");

    const session = await runtime.repositories.sessionRepository.findById(userId, sessionId, "");
    session.messages = [
      {
        messageUid: "sm-legacy-user",
        role: "user",
        content: "legacy message",
        turnScopeId: "turn-legacy",
        dialogProcessId: "dialog-legacy",
      },
    ];
    await runtime.repositories.sessionRepository.save(userId, session, "");

    const sessionDir = path.join(workspaceRoot, userId, "runtime", "session", sessionId);
    await writeFile(
      path.join(sessionDir, "session.json"),
      JSON.stringify({ ...session, schemaVersion: 5 }),
      "utf8",
    );
    await writeFile(
      path.join(sessionDir, "session-summary.json"),
      JSON.stringify({ schemaVersion: 13, sessionId, messages: [] }),
      "utf8",
    );

    const maintenance = await runtime.sessionCrudService.maintainSessionDisplaySummaries({
      userId,
    });
    assert.deepEqual(maintenance.failures, []);
    assert.deepEqual(maintenance.migratedSessionIds, [sessionId]);
    assert.deepEqual(maintenance.rebuiltSessionIds, []);

    const manifest = JSON.parse(await readFile(path.join(sessionDir, "session.json"), "utf8"));
    assert.equal(manifest.schemaVersion, 6);
    assert.equal("messages" in manifest, false);
  });
});

test("deleting one session does not invalidate another session display summary", async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const userId = "u1";
    await mkdir(path.join(workspaceRoot, userId), { recursive: true });
    const runtime = createSessionServices({ workspaceRoot });
    for (const sessionId of ["kept", "deleted"]) {
      await runtime.sessionTreeService.upsertSessionTree({ userId, sessionId });
      await runtime.sessionCrudService.ensureSession(userId, sessionId, "");
    }

    const kept = await runtime.repositories.sessionRepository.findById(userId, "kept", "");
    kept.messages = [
      {
        messageUid: "sm-kept-user",
        role: "user",
        content: "keep me",
        turnScopeId: "turn-kept",
        dialogProcessId: "dialog-kept",
      },
    ];
    await runtime.repositories.sessionRepository.save(userId, kept, "");
    const keptSummaryFile = path.join(
      workspaceRoot,
      userId,
      "runtime",
      "session",
      "kept",
      "session-summary.json",
    );
    const persistedSummary = JSON.parse(await readFile(keptSummaryFile, "utf8"));
    assert.equal("depth" in persistedSummary, false);

    await runtime.sessionTreeService.deleteSessionBranch({ userId, sessionId: "deleted" });
    const display = await runtime.sessionCrudService.getSessionDisplayData({
      userId,
      sessionId: "kept",
    });
    assert.equal(display.exists, true);
    assert.equal(display.sessions[0].depth, 1);
    assert.equal(display.sessions[0].messages[0].content, "keep me");
  });
});
