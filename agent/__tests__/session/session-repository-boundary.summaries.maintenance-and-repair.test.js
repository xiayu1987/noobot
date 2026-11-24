/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { access, mkdir, readFile, rm, writeFile } from "node:fs/promises";

import {
  executeEmptySessionCleanup,
  createTestPartitionSessionServices,
  createTestSessionServices,
  provisionTestSession,
  commitTestSessionChanges,
} from "../helpers/session-services.js";
import { WORKSPACE_LAYOUT } from "@noobot/workspace-protocol";
import { PARTITION_JOURNAL_HEAD_FILE } from "@noobot/session-protocol/partition-journal";
import { SESSIONS_SUMMARY_SCHEMA_VERSION } from "@noobot/session-protocol/sessions-summary";
import { UNSUPPORTED_SESSION_STORAGE } from "@noobot/session-protocol/session-storage-format";
import { SESSION_CALLER } from "@noobot/shared/session-caller";
import {
  canonicalMessages,
  withTempWorkspace,
} from "./session-repository-boundary.summaries.fixtures.js";
import { initializeUserWorkspace } from "../helpers/user-workspace.js";
import { TEST_MESSAGE_TS } from "../helpers/session-run-payload.js";

test("session list projects committed heads without persisting another list document", async () => {
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

    const messages = canonicalMessages(
      [
        { attachments: [], role: "system", content: "ignored" },
        {
          attachments: [],
          role: "user",
          messageOrigin: "natural",
          content: "1234567890123456789012345",
        },
        { attachments: [], role: "assistant", content: "done", attachmentMetas: [{ id: "big" }] },
      ],
      "B",
      "list_b",
    ).map((message) => ({ ...message, parentSessionId: "A" }));
    await commitTestSessionChanges(runtime, {
      userId,
      sessionId: "B",
      changes: { messages },
    });
    await using reader = await runtime.repositories.sessionRepository.requireSessionReader(
      userId,
      "B",
      {
        persistenceContext: runtime.repositories.sessionRepository.treePersistenceContext(
          userId,
          "B",
        ),
      },
    );
    const { aggregateVersion } = await reader.readMetadata();

    const summary = await runtime.repositories.sessionRepository.readSessionsSummary(userId);
    assert.equal(summary.schemaVersion, SESSIONS_SUMMARY_SCHEMA_VERSION);
    const writtenB = summary.sessions.find((item) => item.sessionId === "B");
    assert.equal(writtenB.title, "12345678901234567890");
    assert.equal(writtenB.messageCount, 3);
    assert.equal(writtenB.aggregateVersion, aggregateVersion);
    assert.equal("depth" in writtenB, false);
    assert.equal(Array.isArray(writtenB.messages), false);
    assert.equal(writtenB.lastMessage.role, "assistant");
    assert.equal("attachmentMetas" in writtenB.lastMessage, false);

    const { sessions: list } = await runtime.sessionCrudService.getAllSessionSummaries({ userId });
    const listedB = list.find((item) => item.sessionId === "B");
    assert.equal(list.length, 2);
    assert.equal(listedB.aggregateVersion, aggregateVersion);
    assert.equal("depth" in listedB, false);
    assert.equal("messages" in listedB, false);

    await assert.rejects(
      access(path.join(workspaceRoot, userId, "runtime", "session", "sessions.json")),
      { code: "ENOENT" },
    );
  });
});

test("obsolete list schema is ignored without reading or rewriting the document", async () => {
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
    assert.equal(repaired.schemaVersion, SESSIONS_SUMMARY_SCHEMA_VERSION - 1);
  });
});

test("display-summary maintenance does not republish the obsolete list index", async () => {
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

    await runtime.sessionCrudService.getAllSessionSummaries({ userId });
    const rebuilt = JSON.parse(await readFile(summaryFile, "utf8"));
    assert.equal(rebuilt.schemaVersion, SESSIONS_SUMMARY_SCHEMA_VERSION - 1);
    assert.deepEqual(rebuilt.sessions, []);
    assert.deepEqual(
      (await runtime.repositories.sessionRepository.readSessionsSummary(userId)).sessions
        .map((item) => item.sessionId)
        .sort(),
      ["A", "B"],
    );
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
    assert.equal(orphan.unavailableReason.code, "SESSION_STORAGE_CORRUPT");
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
    assert.equal(child.unavailableReason.code, "SESSION_STORAGE_CORRUPT");
    assert.equal(child.parentSessionId, "root");
    assert.equal(child.caller, SESSION_CALLER.BOT);
  });
});

test("ensureSession recovers registration of a committed session without repeating its commit", async () => {
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
    const headFile = path.join(
      workspaceRoot,
      userId,
      WORKSPACE_LAYOUT.SESSION_DIR,
      "S",
      PARTITION_JOURNAL_HEAD_FILE,
    );
    const committedHead = await readFile(headFile, "utf8");
    const treeFile = path.join(workspaceRoot, userId, WORKSPACE_LAYOUT.SESSION_TREE_FILE);
    await writeFile(treeFile, JSON.stringify({ nodes: {} }));

    await provisionTestSession(runtime, {
      userId,
      sessionId: "S",
      parentSessionId: "",
      caller: SESSION_CALLER.USER,
    });
    const tree = JSON.parse(await readFile(treeFile, "utf8"));
    assert.deepEqual(tree.nodes.S, {
      sessionId: "S",
      parentSessionId: "",
      caller: SESSION_CALLER.USER,
    });
    assert.equal(await readFile(headFile, "utf8"), committedHead);
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
    await writeFile(path.join(legacyDir, PARTITION_JOURNAL_HEAD_FILE), "{invalid-json", "utf8");
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

    const payload = await repository.readSessionsSummary(userId);
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
    await writeFile(path.join(sessionDir, PARTITION_JOURNAL_HEAD_FILE), "{invalid-json", "utf8");

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

test("Session reads reject an unsupported immutable format without rewriting it", async () => {
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
    const manifestFile = path.join(sessionDir, UNSUPPORTED_SESSION_STORAGE.head);
    const repository = runtime.repositories.sessionRepository;
    const persistenceContext = repository.treePersistenceContext(userId, sessionId);
    await rm(path.join(sessionDir, PARTITION_JOURNAL_HEAD_FILE));
    const legacyManifest = "retired immutable publication";
    await writeFile(manifestFile, legacyManifest, "utf8");

    await assert.rejects(repository.findById(userId, sessionId, { persistenceContext }), {
      code: "SESSION_STORAGE_FORMAT_UNSUPPORTED",
    });
    await assert.rejects(
      repository.withSessionReader(
        userId,
        sessionId,
        async ({ reader, commitChanges }) =>
          commitChanges(
            await reader.prepareRequest({
              operationId: "unsupported-format",
              committedAt: repository.now(),
              changes: { sessionMetadata: { customTitle: "must not write" } },
            }),
          ),
        { persistenceContext },
      ),
      { code: "SESSION_STORAGE_FORMAT_UNSUPPORTED" },
    );
    assert.equal(await readFile(manifestFile, "utf8"), legacyManifest);
    await assert.rejects(
      repository.readSessionDisplaySummary(userId, sessionId, { persistenceContext }),
      { code: "SESSION_STORAGE_FORMAT_UNSUPPORTED" },
    );
    assert.equal(await readFile(manifestFile, "utf8"), legacyManifest);
  });
});

test("deleting one session does not invalidate another session display summary", async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const userId = "u1";
    await initializeUserWorkspace(workspaceRoot, userId);
    await using runtime = createTestPartitionSessionServices({ workspaceRoot });
    for (const sessionId of ["kept", "deleted"]) {
      await provisionTestSession(runtime, {
        userId,
        sessionId,
        parentSessionId: "",
        caller: SESSION_CALLER.USER,
      });
    }

    const messages = [
      {
        attachments: [],
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
    await commitTestSessionChanges(runtime, {
      userId,
      sessionId: "kept",
      changes: { messages },
    });
    await runtime.repositories.sessionRepository.readSessionDisplaySummary(userId, "kept", {
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
      PARTITION_JOURNAL_HEAD_FILE,
    );
    const persistedHead = await readFile(keptSummaryFile, "utf8");

    await runtime.sessionTreeService.deleteSessionBranch(
      { userId, sessionIds: ["deleted"] },
      executeEmptySessionCleanup,
    );
    const display = await runtime.sessionCrudService.getSessionDisplayData({
      userId,
      sessionId: "kept",
    });
    assert.equal(display.exists, true);
    assert.equal(display.sessions[0].availability, "available");
    assert.equal(display.sessions[0].messages[0].content, "keep me");
    assert.equal(await readFile(keptSummaryFile, "utf8"), persistedHead);
  });
});

test("obsolete display cache is ignored and not rewritten on detail read", async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const userId = "u-summary-invalid-snapshot";
    await initializeUserWorkspace(workspaceRoot, userId);
    const runtime = createTestSessionServices({ workspaceRoot });
    await provisionTestSession(runtime, {
      userId,
      sessionId: "stale",
      parentSessionId: "",
      caller: SESSION_CALLER.USER,
    });
    const { sessionRepository } = runtime.repositories;
    await sessionRepository.readSessionDisplaySummary(userId, "stale", {
      persistenceContext: sessionRepository.treePersistenceContext(userId, "stale"),
    });
    const summaryFile = path.join(
      workspaceRoot,
      userId,
      "runtime",
      "session",
      "stale",
      "session-summary.json",
    );
    await assert.rejects(access(summaryFile), { code: "ENOENT" });
    const obsoleteCache = JSON.stringify({
      turnLifecycleSnapshot: { recentTerminalTurns: [{ parentSessionId: "residual" }] },
    });
    await writeFile(summaryFile, obsoleteCache, "utf8");

    const detail = await runtime.sessionCrudService.getSessionDisplayData({
      userId,
      sessionId: "stale",
    });
    assert.equal(detail.sessions[0].availability, "available");
    assert.deepEqual(detail.sessions[0].turnLifecycleSnapshot.recentTerminalTurns, []);
    assert.equal(await readFile(summaryFile, "utf8"), obsoleteCache);
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
    await writeFile(path.join(childDir, PARTITION_JOURNAL_HEAD_FILE), "{invalid-json", "utf8");

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
