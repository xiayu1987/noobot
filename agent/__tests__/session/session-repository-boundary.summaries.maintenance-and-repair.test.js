/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";

import { createTestSessionServices, provisionTestSession } from "../helpers/session-services.js";
import { WORKSPACE_LAYOUT } from "@noobot/workspace-protocol";
import { SESSIONS_SUMMARY_SCHEMA_VERSION } from "@noobot/session-protocol/sessions-summary";
import {
  SESSION_ARTIFACT_LEGACY_TURN_COMMIT_SCHEMA_VERSION,
  SESSION_ERROR_CODE,
} from "@noobot/session-protocol";
import { SESSION_CALLER } from "@noobot/shared/session-caller";
import {
  canonicalMessages,
  withTempWorkspace,
} from "./session-repository-boundary.summaries.fixtures.js";
import { initializeUserWorkspace } from "../helpers/user-workspace.js";
import { applySessionMessageFacts } from "../helpers/session-message-facts.js";
import { TEST_MESSAGE_TS } from "../helpers/session-run-payload.js";

test("session summaries should be maintained and rebuilt for list API", async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const userId = "u1";
    await initializeUserWorkspace(workspaceRoot, userId);

    const runtime = createTestSessionServices(
      { workspaceRoot },
      { now: () => "2026-05-14T00:00:00.000Z" },
    );

    await provisionTestSession(runtime, {
      userId,
      sessionId: "A",
      parentSessionId: "",
      caller: SESSION_CALLER.USER,
    });
    await provisionTestSession(runtime, {
      userId,
      sessionId: "B",
      parentSessionId: "A",
      caller: SESSION_CALLER.USER,
    });

    const sessionB = await runtime.repositories.sessionRepository.findById(userId, "B", {
      persistenceContext: runtime.repositories.sessionRepository.treePersistenceContext(
        userId,
        "B",
      ),
    });
    sessionB.messages = canonicalMessages(
      [
        { role: "system", content: "ignored" },
        { role: "user", messageOrigin: "natural", content: "1234567890123456789012345" },
        { role: "assistant", content: "done", attachmentMetas: [{ id: "big" }] },
      ],
      "B",
      "list_b",
    );
    sessionB.aggregateVersion = 4;
    await runtime.repositories.sessionRepository.save(userId, applySessionMessageFacts(sessionB), {
      persistenceContext: runtime.repositories.sessionRepository.treePersistenceContext(
        userId,
        sessionB.sessionId,
      ),
    });

    let summary = await runtime.repositories.sessionRepository.readSessionsSummary(userId);
    assert.equal(summary.schemaVersion, SESSIONS_SUMMARY_SCHEMA_VERSION);
    const writtenB = summary.sessions.find((item) => item.sessionId === "B");
    assert.equal(writtenB.title, "12345678901234567890");
    assert.equal(writtenB.messageCount, 3);
    assert.equal(writtenB.aggregateVersion, 4);
    assert.equal("depth" in writtenB, false);
    assert.equal(Array.isArray(writtenB.messages), false);
    assert.equal(writtenB.lastMessage.role, "assistant");
    assert.equal("attachmentMetas" in writtenB.lastMessage, false);

    const { sessions: list } = await runtime.sessionCrudService.getAllSessionSummaries({ userId });
    const listedB = list.find((item) => item.sessionId === "B");
    assert.equal(list.length, 2);
    assert.equal(listedB.aggregateVersion, 4);
    assert.equal("depth" in listedB, false);
    assert.equal("messages" in listedB, false);

    summary = JSON.parse(
      await readFile(
        path.join(workspaceRoot, userId, "runtime", "session", "sessions.json"),
        "utf8",
      ),
    );
    assert.equal("depth" in summary.sessions.find((item) => item.sessionId === "B"), false);
  });
});

test("list index under another schema is rebuilt from the Session source on read", async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const userId = "u1";
    await initializeUserWorkspace(workspaceRoot, userId);
    const runtime = createTestSessionServices({ workspaceRoot });
    const repository = runtime.repositories.sessionRepository;
    await provisionTestSession(runtime, {
      userId,
      sessionId: "A",
      parentSessionId: "",
      caller: SESSION_CALLER.USER,
    });
    const summaryFile = path.join(workspaceRoot, userId, "runtime", "session", "sessions.json");
    await writeFile(
      summaryFile,
      JSON.stringify({ schemaVersion: SESSIONS_SUMMARY_SCHEMA_VERSION - 1, sessions: [] }),
    );

    const read = await repository.readSessionsSummary(userId);
    assert.equal(read.schemaVersion, SESSIONS_SUMMARY_SCHEMA_VERSION);
    assert.deepEqual(
      read.sessions.map((item) => item.sessionId),
      ["A"],
    );

    const { sessions: list } = await runtime.sessionCrudService.getAllSessionSummaries({ userId });
    assert.deepEqual(
      list.map((item) => item.sessionId),
      ["A"],
    );
    const repaired = JSON.parse(await readFile(summaryFile, "utf8"));
    assert.equal(repaired.schemaVersion, SESSIONS_SUMMARY_SCHEMA_VERSION);
  });
});

test("startup display-summary maintenance rebuilds a list index under another schema first", async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const userId = "u1";
    await initializeUserWorkspace(workspaceRoot, userId);
    const runtime = createTestSessionServices({ workspaceRoot });
    for (const sessionId of ["A", "B"]) {
      await provisionTestSession(runtime, {
        userId,
        sessionId,
        parentSessionId: "",
        caller: SESSION_CALLER.USER,
      });
    }
    const summaryFile = path.join(workspaceRoot, userId, "runtime", "session", "sessions.json");
    await writeFile(
      summaryFile,
      JSON.stringify({ schemaVersion: SESSIONS_SUMMARY_SCHEMA_VERSION - 1, sessions: [] }),
    );

    const result = await runtime.sessionCrudService.maintainSessionDisplaySummaries({ userId });

    assert.deepEqual(result.failures, []);
    const rebuilt = JSON.parse(await readFile(summaryFile, "utf8"));
    assert.equal(rebuilt.schemaVersion, SESSIONS_SUMMARY_SCHEMA_VERSION);
    assert.deepEqual(rebuilt.sessions.map((item) => item.sessionId).sort(), ["A", "B"]);
  });
});

test("session list projects session-tree nodes without Session artifacts as unavailable", async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const userId = "u-tree-orphans";
    await initializeUserWorkspace(workspaceRoot, userId);
    const runtime = createTestSessionServices({ workspaceRoot });
    await provisionTestSession(runtime, {
      userId,
      sessionId: "materialized",
      parentSessionId: "",
      caller: SESSION_CALLER.USER,
    });
    await runtime.sessionPathResolver.commitSessionPlacement(userId, {
      sessionId: "orphan",
      parentSessionId: "",
      caller: SESSION_CALLER.BOT,
    });

    const { sessions: summaries } = await runtime.sessionCrudService.getAllSessionSummaries({
      userId,
    });
    assert.deepEqual(summaries.map((item) => item.sessionId).sort(), ["materialized", "orphan"]);
    const orphan = summaries.find((item) => item.sessionId === "orphan");
    assert.equal(orphan.availability, "unavailable");
    assert.equal(orphan.unavailableReason.code, "SESSION_ARTIFACT_NOT_FOUND");
    assert.equal(orphan.caller, SESSION_CALLER.BOT);
  });
});

test("session detail projects a tree child without artifact as unavailable", async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const userId = "u-detail-orphan-child";
    await initializeUserWorkspace(workspaceRoot, userId);
    const runtime = createTestSessionServices({ workspaceRoot });
    await provisionTestSession(runtime, {
      userId,
      sessionId: "root",
      parentSessionId: "",
      caller: SESSION_CALLER.USER,
    });
    await runtime.sessionPathResolver.commitSessionPlacement(userId, {
      sessionId: "child",
      parentSessionId: "root",
      caller: SESSION_CALLER.BOT,
    });

    const detail = await runtime.sessionCrudService.getSessionDisplayData({
      userId,
      sessionId: "root",
    });
    assert.deepEqual(
      detail.sessions.map((item) => item.sessionId),
      ["root", "child"],
    );
    const child = detail.sessions.find((item) => item.sessionId === "child");
    assert.equal(child.availability, "unavailable");
    assert.equal(child.unavailableReason.code, "SESSION_ARTIFACT_NOT_FOUND");
    assert.equal(child.parentSessionId, "root");
    assert.equal(child.caller, SESSION_CALLER.BOT);
  });
});

test("ensureSession rejects an artifact absent from the session tree without registering it", async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const userId = "u-artifact-without-tree-node";
    await initializeUserWorkspace(workspaceRoot, userId);
    const runtime = createTestSessionServices({ workspaceRoot });
    await provisionTestSession(runtime, {
      userId,
      sessionId: "S",
      parentSessionId: "",
      caller: SESSION_CALLER.USER,
    });
    const treeFile = path.join(workspaceRoot, userId, WORKSPACE_LAYOUT.SESSION_TREE_FILE);
    await writeFile(treeFile, JSON.stringify({ nodes: {} }));

    await assert.rejects(
      provisionTestSession(runtime, {
        userId,
        sessionId: "S",
        parentSessionId: "",
        caller: SESSION_CALLER.USER,
      }),
      (error) => error?.code === "FATAL_SESSION_TREE_NODE_MISSING",
    );
    const tree = JSON.parse(await readFile(treeFile, "utf8"));
    assert.deepEqual(tree.nodes, {});
  });
});

test("session discovery traverses only canonical Session directories", async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const userId = "u-session-discovery";
    await initializeUserWorkspace(workspaceRoot, userId);
    const runtime = createTestSessionServices({ workspaceRoot });

    await provisionTestSession(runtime, {
      userId,
      sessionId: "root",
      parentSessionId: "",
      caller: SESSION_CALLER.USER,
    });
    await provisionTestSession(runtime, {
      userId,
      sessionId: "child",
      parentSessionId: "root",
      caller: SESSION_CALLER.USER,
    });

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

test("session summary rebuild isolates an unreadable session as an unavailable projection from the tree node", async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const userId = "u-unavailable";
    await initializeUserWorkspace(workspaceRoot, userId);
    const runtime = createTestSessionServices(
      { workspaceRoot },
      { now: () => "2026-08-08T00:00:00.000Z" },
    );
    await provisionTestSession(runtime, {
      userId,
      sessionId: "available",
      parentSessionId: "",
      caller: SESSION_CALLER.USER,
    });
    await provisionTestSession(runtime, {
      userId,
      sessionId: "legacy",
      parentSessionId: "",
      caller: SESSION_CALLER.BOT,
    });

    const repository = runtime.repositories.sessionRepository;
    const legacyDir = path.join(workspaceRoot, userId, "runtime", "session", "legacy");
    await writeFile(path.join(legacyDir, "session.json"), "{invalid-json", "utf8");
    let readError = null;
    await assert.rejects(
      repository.findById(userId, "legacy", {
        persistenceContext: repository.treePersistenceContext(userId, "legacy"),
      }),
      (error) => {
        readError = error;
        return true;
      },
    );

    const payload = await repository.rebuildSessionsSummary(userId);
    const available = payload.sessions.find((item) => item.sessionId === "available");
    const unavailable = payload.sessions.find((item) => item.sessionId === "legacy");
    assert.equal(available.availability, "available");
    assert.equal(unavailable.availability, "unavailable");
    assert.equal("messages" in unavailable, false);
    assert.equal("messageCount" in unavailable, false);
    assert.equal("lastMessage" in unavailable, false);
    assert.deepEqual(unavailable.unavailableReason, {
      code: readError.code,
      message: readError.message,
    });
    assert.equal(unavailable.caller, SESSION_CALLER.BOT);
    assert.equal(unavailable.parentSessionId, "");
    assert.equal(Object.hasOwn(unavailable, "createdAt"), false);
    assert.equal(Object.hasOwn(unavailable, "updatedAt"), false);

    const persisted = await repository.readSessionsSummary(userId);
    assert.equal(
      persisted.sessions.find((item) => item.sessionId === "legacy").availability,
      "unavailable",
    );
  });
});

test("unreadable Session is rejected with its read error and projected unavailable without a repair record", async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const userId = "u-read-failed";
    const sessionId = "broken";
    await initializeUserWorkspace(workspaceRoot, userId);
    const runtime = createTestSessionServices({ workspaceRoot });
    await provisionTestSession(runtime, {
      userId,
      sessionId,
      parentSessionId: "",
      caller: SESSION_CALLER.USER,
    });
    const sessionDir = path.join(workspaceRoot, userId, "runtime", "session", sessionId);
    await writeFile(path.join(sessionDir, "session.json"), "{invalid-json", "utf8");

    const repository = runtime.repositories.sessionRepository;
    const read = () =>
      repository.findById(userId, sessionId, {
        persistenceContext: repository.treePersistenceContext(userId, sessionId),
      });
    let firstErrorCode = "";
    await assert.rejects(read(), (error) => {
      firstErrorCode = error.code;
      return Boolean(firstErrorCode) && error.repairSkipped === undefined;
    });
    await assert.rejects(read(), (error) => error.code === firstErrorCode);
    const summary = await repository.readSessionsSummary(userId);
    const projected = summary.sessions.find((item) => item.sessionId === sessionId);
    assert.equal(projected.availability, "unavailable");
  });
});

test("Session reads reject a previous artifact schema instead of migrating it", async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const userId = "u-previous-artifact";
    const sessionId = "previous-artifact";
    await initializeUserWorkspace(workspaceRoot, userId);
    const runtime = createTestSessionServices({ workspaceRoot });
    await provisionTestSession(runtime, {
      userId,
      sessionId,
      parentSessionId: "",
      caller: SESSION_CALLER.USER,
    });
    const sessionDir = path.join(workspaceRoot, userId, "runtime", "session", sessionId);
    const manifestFile = path.join(sessionDir, "session.json");
    const repository = runtime.repositories.sessionRepository;
    const persistenceContext = repository.treePersistenceContext(userId, sessionId);
    const canonicalSession = await repository.findById(userId, sessionId, { persistenceContext });
    const manifest = JSON.parse(await readFile(manifestFile, "utf8"));
    const legacyManifest = JSON.stringify({
      ...manifest,
      schemaVersion: SESSION_ARTIFACT_LEGACY_TURN_COMMIT_SCHEMA_VERSION,
    });
    await writeFile(manifestFile, legacyManifest, "utf8");

    await assert.rejects(repository.findById(userId, sessionId, { persistenceContext }), {
      code: SESSION_ERROR_CODE.TURN_JOURNAL_SCHEMA_REQUIRED,
    });
    await assert.rejects(repository.save(userId, canonicalSession, { persistenceContext }), {
      code: SESSION_ERROR_CODE.TURN_JOURNAL_SCHEMA_REQUIRED,
    });
    assert.equal(await readFile(manifestFile, "utf8"), legacyManifest);
    const maintenance = await runtime.sessionCrudService.maintainSessionDisplaySummaries({
      userId,
    });
    assert.deepEqual(
      maintenance.failures.map(({ sessionId: id, code }) => ({ sessionId: id, code })),
      [{ sessionId, code: SESSION_ERROR_CODE.TURN_JOURNAL_SCHEMA_REQUIRED }],
    );
    assert.deepEqual(maintenance.rebuiltSessionIds, []);
    assert.equal(await readFile(manifestFile, "utf8"), legacyManifest);
  });
});

test("deleting one session does not invalidate another session display summary", async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const userId = "u1";
    await initializeUserWorkspace(workspaceRoot, userId);
    const runtime = createTestSessionServices({ workspaceRoot });
    for (const sessionId of ["kept", "deleted"]) {
      await provisionTestSession(runtime, {
        userId,
        sessionId,
        parentSessionId: "",
        caller: SESSION_CALLER.USER,
      });
    }

    const kept = await runtime.repositories.sessionRepository.findById(userId, "kept", {
      persistenceContext: runtime.repositories.sessionRepository.treePersistenceContext(
        userId,
        "kept",
      ),
    });
    kept.messages = [
      {
        messageUid: "sm-kept-user",
        ts: TEST_MESSAGE_TS,
        sessionId: "kept",
        role: "user",
        messageOrigin: "natural",
        content: "keep me",
        turnScopeId: "turn-kept",
        dialogProcessId: "dialog-kept",
      },
    ];
    await runtime.repositories.sessionRepository.save(userId, applySessionMessageFacts(kept), {
      persistenceContext: runtime.repositories.sessionRepository.treePersistenceContext(
        userId,
        kept.sessionId,
      ),
    });
    await runtime.repositories.sessionRepository.ensureSessionDisplaySummary(userId, "kept", {
      persistenceContext: runtime.repositories.sessionRepository.treePersistenceContext(
        userId,
        "kept",
      ),
    });
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

    await runtime.sessionTreeService.deleteSessionBranch({ userId, sessionIds: ["deleted"] });
    const display = await runtime.sessionCrudService.getSessionDisplayData({
      userId,
      sessionId: "kept",
    });
    assert.equal(display.exists, true);
    assert.equal(display.sessions[0].availability, "available");
    assert.equal(display.sessions[0].messages[0].content, "keep me");
  });
});

test("summary session detail projects an unreadable tree child as unavailable without attachment projection", async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const userId = "u-summary-unreadable-child";
    await initializeUserWorkspace(workspaceRoot, userId);
    const runtime = createTestSessionServices({ workspaceRoot });
    await provisionTestSession(runtime, {
      userId,
      sessionId: "root",
      parentSessionId: "",
      caller: SESSION_CALLER.USER,
    });
    await provisionTestSession(runtime, {
      userId,
      sessionId: "child",
      parentSessionId: "root",
      caller: SESSION_CALLER.BOT,
    });
    const childDir = path.join(workspaceRoot, userId, "runtime", "session", "root", "child");
    await writeFile(path.join(childDir, "session.json"), "{invalid-json", "utf8");

    const detail = await runtime.sessionCrudService.getSessionDisplayData({
      userId,
      sessionId: "root",
    });
    const child = detail.sessions.find((item) => item.sessionId === "child");
    assert.equal(child.availability, "unavailable");
    assert.equal("messages" in child, false);
    assert.equal("depth" in child, false);
    assert.equal(typeof child.unavailableReason.code, "string");
  });
});
