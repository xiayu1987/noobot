/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";

import { createTestSessionServices } from "../helpers/session-services.js";
import { WORKSPACE_LAYOUT } from "@noobot/workspace-protocol";
import { SESSIONS_SUMMARY_SCHEMA_VERSION } from "../../src/session/session-summary-builders.js";
import {
  SESSION_ARTIFACT_LEGACY_TURN_COMMIT_SCHEMA_VERSION,
  SESSION_ARTIFACT_SCHEMA_VERSION,
} from "@noobot/session-protocol";
import { SESSION_CALLER } from "@noobot/shared/session-caller";
import {
  canonicalMessages,
  withTempWorkspace,
} from "./session-repository-boundary.summaries.fixtures.js";
import { initializeUserWorkspace } from "../helpers/user-workspace.js";
import { applySessionMessageFacts } from "../helpers/session-message-facts.js";

test("session summaries should be maintained and rebuilt for list API", async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const userId = "u1";
    await initializeUserWorkspace(workspaceRoot, userId);

    const runtime = createTestSessionServices(
      { workspaceRoot },
      { now: () => "2026-05-14T00:00:00.000Z" },
    );

    await runtime.sessionCrudService.ensureSession(userId, "A", "", SESSION_CALLER.USER);
    await runtime.sessionCrudService.ensureSession(userId, "B", "A", SESSION_CALLER.USER);

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
    await runtime.repositories.sessionRepository.save(
      userId,
      applySessionMessageFacts(sessionB),
      "A",
    );

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
    assert.equal("depth" in summary.sessions.find((item) => item.sessionId === "B"), false);
  });
});

test("list index under another schema is rejected on read and rebuilt only by listing reconciliation", async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const userId = "u1";
    await initializeUserWorkspace(workspaceRoot, userId);
    const runtime = createTestSessionServices({ workspaceRoot });
    const repository = runtime.repositories.sessionRepository;
    await runtime.sessionCrudService.ensureSession(userId, "A", "", SESSION_CALLER.USER);
    const summaryFile = path.join(workspaceRoot, userId, "runtime", "session", "sessions.json");
    await writeFile(
      summaryFile,
      JSON.stringify({ schemaVersion: SESSIONS_SUMMARY_SCHEMA_VERSION - 1, sessions: [] }),
    );

    await assert.rejects(repository.readSessionsSummary(userId), {
      code: "SESSIONS_SUMMARY_SCHEMA_UNSUPPORTED",
    });

    const list = await runtime.sessionCrudService.getAllSessionSummaries({ userId });
    assert.deepEqual(
      list.map((item) => item.sessionId),
      ["A"],
    );
    const repaired = JSON.parse(await readFile(summaryFile, "utf8"));
    assert.equal(repaired.schemaVersion, SESSIONS_SUMMARY_SCHEMA_VERSION);
  });
});

test("session list projects session-tree nodes without Session artifacts as unavailable", async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const userId = "u-tree-orphans";
    await initializeUserWorkspace(workspaceRoot, userId);
    const runtime = createTestSessionServices({ workspaceRoot });
    await runtime.sessionCrudService.ensureSession(userId, "materialized", "", SESSION_CALLER.USER);
    await runtime.repositories.sessionRepository.registerSessionTreeNode(userId, {
      sessionId: "orphan",
      parentSessionId: "",
      caller: SESSION_CALLER.BOT,
    });

    const summaries = await runtime.sessionCrudService.getAllSessionSummaries({ userId });
    assert.deepEqual(summaries.map((item) => item.sessionId).sort(), ["materialized", "orphan"]);
    const orphan = summaries.find((item) => item.sessionId === "orphan");
    assert.equal(orphan.availability, "unavailable");
    assert.equal(orphan.unavailableReason.code, "SESSION_ARTIFACT_MISSING");
    assert.equal(orphan.caller, SESSION_CALLER.BOT);
  });
});

test("session detail projects a tree child without artifact as unavailable", async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const userId = "u-detail-orphan-child";
    await initializeUserWorkspace(workspaceRoot, userId);
    const runtime = createTestSessionServices({ workspaceRoot });
    await runtime.sessionCrudService.ensureSession(userId, "root", "", SESSION_CALLER.USER);
    await runtime.repositories.sessionRepository.registerSessionTreeNode(userId, {
      sessionId: "child",
      parentSessionId: "root",
      caller: SESSION_CALLER.BOT,
    });

    const detail = await runtime.sessionCrudService.getSessionData({ userId, sessionId: "root" });
    assert.deepEqual(
      detail.sessions.map((item) => item.sessionId),
      ["root", "child"],
    );
    const child = detail.sessions.find((item) => item.sessionId === "child");
    assert.equal(child.availability, "unavailable");
    assert.equal(child.unavailableReason.code, "SESSION_ARTIFACT_MISSING");
    assert.equal(child.parentSessionId, "root");
    assert.equal(child.caller, SESSION_CALLER.BOT);
  });
});

test("ensureSession rejects an artifact absent from the session tree without registering it", async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const userId = "u-artifact-without-tree-node";
    await initializeUserWorkspace(workspaceRoot, userId);
    const runtime = createTestSessionServices({ workspaceRoot });
    await runtime.sessionCrudService.ensureSession(userId, "S", "", SESSION_CALLER.USER);
    const treeFile = path.join(workspaceRoot, userId, WORKSPACE_LAYOUT.SESSION_TREE_FILE);
    await writeFile(treeFile, JSON.stringify({ nodes: {} }));

    await assert.rejects(
      runtime.sessionCrudService.ensureSession(userId, "S", "", SESSION_CALLER.USER),
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

    await runtime.sessionCrudService.ensureSession(userId, "root", "", SESSION_CALLER.USER);
    await runtime.sessionCrudService.ensureSession(userId, "child", "root", SESSION_CALLER.USER);

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
    await initializeUserWorkspace(workspaceRoot, userId);
    const runtime = createTestSessionServices(
      { workspaceRoot },
      { now: () => "2026-08-08T00:00:00.000Z" },
    );
    await runtime.sessionCrudService.ensureSession(userId, "available", "", SESSION_CALLER.USER);
    await runtime.sessionCrudService.ensureSession(userId, "legacy", "", SESSION_CALLER.USER);

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
    assert.equal("messages" in unavailable, false);
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
    await initializeUserWorkspace(workspaceRoot, userId);
    const runtime = createTestSessionServices({ workspaceRoot });
    await runtime.sessionCrudService.ensureSession(userId, sessionId, "", SESSION_CALLER.USER);
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
      WORKSPACE_LAYOUT.SESSION_LIFECYCLE_RECORDS_DIR,
      `${encodeURIComponent(sessionId)}.json`,
    );
    const lifecycle = JSON.parse(await readFile(lifecycleFile, "utf8"));
    assert.equal(lifecycle.repair.status, "failed");
    assert.equal(typeof lifecycle.repair.trigger?.code, "string");
    assert.ok(lifecycle.repair.trigger.message);

    await assert.rejects(
      repository.findById(userId, sessionId, ""),
      (error) =>
        error.code === firstErrorCode && error.repairSkipped === true && Boolean(error.cause),
    );
    const unchanged = JSON.parse(await readFile(lifecycleFile, "utf8"));
    assert.equal(unchanged.repair.failedAt, lifecycle.repair.failedAt);
  });
});

test("unavailable summary takes caller from the session tree when the manifest is corrupt", async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const userId = "u-corrupt-manifest-caller";
    const sessionId = "corrupt";
    await initializeUserWorkspace(workspaceRoot, userId);
    const runtime = createTestSessionServices({ workspaceRoot });
    await runtime.sessionCrudService.ensureSession(userId, sessionId, "", SESSION_CALLER.BOT);
    const sessionDir = path.join(workspaceRoot, userId, "runtime", "session", sessionId);
    await writeFile(path.join(sessionDir, "session.json"), "{invalid-json", "utf8");

    const payload = await runtime.repositories.sessionRepository.rebuildSessionsSummary(userId);
    const unavailable = payload.sessions.find((item) => item.sessionId === sessionId);
    assert.equal(unavailable.availability, "unavailable");
    assert.equal(unavailable.caller, SESSION_CALLER.BOT);
    assert.equal(unavailable.parentSessionId, "");
    assert.equal(unavailable.createdAt, "");
    assert.equal(unavailable.updatedAt, "");
  });
});

test("stale Session repair failure marker is cleared once the artifact validates", async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const userId = "u-repair-heal";
    const sessionId = "healed";
    await initializeUserWorkspace(workspaceRoot, userId);
    const runtime = createTestSessionServices({ workspaceRoot });
    await runtime.sessionCrudService.ensureSession(userId, sessionId, "", SESSION_CALLER.USER);
    const sessionFile = path.join(
      workspaceRoot,
      userId,
      "runtime",
      "session",
      sessionId,
      "session.json",
    );
    const original = await readFile(sessionFile, "utf8");
    await writeFile(sessionFile, "{invalid-json", "utf8");
    const repository = runtime.repositories.sessionRepository;
    await assert.rejects(repository.findById(userId, sessionId, ""));
    const lifecycleFile = path.join(
      workspaceRoot,
      userId,
      WORKSPACE_LAYOUT.SESSION_LIFECYCLE_RECORDS_DIR,
      `${encodeURIComponent(sessionId)}.json`,
    );
    assert.equal(JSON.parse(await readFile(lifecycleFile, "utf8")).repair.status, "failed");

    await writeFile(sessionFile, original, "utf8");
    const session = await repository.findById(userId, sessionId, "");
    assert.equal(session.sessionId, sessionId);
    await assert.rejects(readFile(lifecycleFile, "utf8"), { code: "ENOENT" });

    await writeFile(sessionFile, "{invalid-json", "utf8");
    await assert.rejects(
      repository.findById(userId, sessionId, ""),
      (error) => error.repairSkipped !== true,
    );
  });
});

test("display maintenance migrates repairable artifacts through the Session repair project", async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const userId = "u1";
    const sessionId = "legacy";
    await initializeUserWorkspace(workspaceRoot, userId);
    const runtime = createTestSessionServices({ workspaceRoot });
    await runtime.sessionCrudService.ensureSession(userId, sessionId, "", SESSION_CALLER.USER);

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
    await runtime.repositories.sessionRepository.save(
      userId,
      applySessionMessageFacts(session),
      "",
    );

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
    assert.equal(manifest.schemaVersion, SESSION_ARTIFACT_SCHEMA_VERSION);
    assert.equal("messages" in manifest, false);
  });
});

test("display summary repair migrates the previous canonical artifact before revision validation", async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const userId = "u-previous-artifact";
    const sessionId = "previous-artifact";
    await initializeUserWorkspace(workspaceRoot, userId);
    const runtime = createTestSessionServices({ workspaceRoot });
    await runtime.sessionCrudService.ensureSession(userId, sessionId, "", SESSION_CALLER.USER);

    const repository = runtime.repositories.sessionRepository;
    const session = await repository.findById(userId, sessionId, "");
    session.messages = canonicalMessages(
      [
        {
          role: "user",
          content: "previous protocol message",
          turnCommit: {
            action: "send",
            commandId: "command-previous",
            requestHash: "hash-previous",
          },
        },
      ],
      "previous",
    );
    await repository.save(userId, applySessionMessageFacts(session), "");

    const sessionDir = path.join(workspaceRoot, userId, "runtime", "session", sessionId);
    const manifestFile = path.join(sessionDir, "session.json");
    const manifest = JSON.parse(await readFile(manifestFile, "utf8"));
    const turn = manifest.turnOrder[0];
    const journalFile = path.join(sessionDir, turn.file);
    const records = (await readFile(journalFile, "utf8")).trim().split("\n").map(JSON.parse);
    const messageRecord = records.find((record) => record?.op === "upsert");
    messageRecord.message.turnCommit.runState = "pending_start";
    messageRecord.hash = `sha256:${createHash("sha256")
      .update(JSON.stringify(messageRecord.message))
      .digest("hex")}`;
    const journal = records.map((record) => `${JSON.stringify(record)}\n`).join("");
    await writeFile(journalFile, journal, "utf8");
    turn.committedBytes = Buffer.byteLength(journal);
    turn.messageHashes[messageRecord.messageUid] = messageRecord.hash;
    manifest.schemaVersion = SESSION_ARTIFACT_LEGACY_TURN_COMMIT_SCHEMA_VERSION;
    manifest.turnLifecycle.commandReceipts = [
      {
        commandId: "command-previous",
        type: "session.turn.commit",
        requestHash: "hash-previous",
        aggregateVersion: 1,
        committedAt: "2026-09-18T00:00:00.000Z",
        result: { messageUid: messageRecord.messageUid, runState: "pending_start" },
      },
    ];
    await writeFile(manifestFile, JSON.stringify(manifest), "utf8");

    const repaired = await repository.ensureSessionDisplaySummary(userId, sessionId, "");
    const repairedManifest = JSON.parse(await readFile(manifestFile, "utf8"));
    const repairedSession = await repository.findById(userId, sessionId, "");
    const displaySummary = repaired.summary;

    assert.equal(repaired.migrated, true);
    assert.equal(repairedManifest.schemaVersion, SESSION_ARTIFACT_SCHEMA_VERSION);
    assert.equal(repairedSession.messages.length, 1);
    assert.deepEqual(repairedSession.messages[0].turnCommit, {
      action: "send",
      commandId: "command-previous",
      requestHash: "hash-previous",
    });
    assert.deepEqual(repairedSession.turnLifecycle.commandReceipts[0].result, {
      messageUid: messageRecord.messageUid,
    });
    assert.equal(displaySummary.source.sessionSchemaVersion, SESSION_ARTIFACT_SCHEMA_VERSION);
  });
});

test("deleting one session does not invalidate another session display summary", async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const userId = "u1";
    await initializeUserWorkspace(workspaceRoot, userId);
    const runtime = createTestSessionServices({ workspaceRoot });
    for (const sessionId of ["kept", "deleted"]) {
      await runtime.sessionCrudService.ensureSession(userId, sessionId, "", SESSION_CALLER.USER);
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
    await runtime.repositories.sessionRepository.save(userId, applySessionMessageFacts(kept), "");
    await runtime.repositories.sessionRepository.ensureSessionDisplaySummary(userId, "kept", "");
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
