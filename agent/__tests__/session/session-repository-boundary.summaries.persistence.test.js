/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */


import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { mkdir, readFile } from "node:fs/promises";

import { createSessionServices } from "../../src/session/index.js";
import { readSessionArtifact } from "../../src/session/session-artifact-store.js";
import { withTempWorkspace, canonicalMessages } from "./session-repository-boundary.summaries.fixtures.js";

test("session save refreshes the display projection with live activity timeline", async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const userId = "u1";
    await mkdir(path.join(workspaceRoot, userId), { recursive: true });
    const runtime = createSessionServices({ workspaceRoot });
    await runtime.sessionTreeService.upsertSessionTree({ userId, sessionId: "live" });
    await runtime.sessionCrudService.ensureSession(userId, "live", "");

    const session = await runtime.repositories.sessionRepository.findById(userId, "live", "");
    session.messages = canonicalMessages(
      [
        {
          role: "assistant",
          type: "tool_call",
          chatPresentation: false,
          presentationMessageId: "presentation-live",
          turnScopeId: "turn-live",
          activityTimeline: [
            {
              eventId: "guidance-analysis:live",
              activityKind: "guidance_analysis",
              sequence: 1,
              sequenceDomain: "activity",
              sequenceScopeId: "presentation-live",
              authority: "authoritative",
              text: "analysis in progress",
            },
          ],
        },
      ],
      "live",
    );
    await runtime.repositories.sessionRepository.save(userId, session, "");

    const display = await runtime.repositories.sessionRepository.readSessionDisplaySummary(
      userId,
      "live",
      "",
    );
    assert.equal(display.messages.length, 1);
    assert.equal(display.messages[0].presentationMessageId, "presentation-live");
    assert.equal(display.messages[0].thinkingDetailCount, 1);
    assert.equal(display.messages[0].activityTimeline.length, 1);
    assert.equal(display.messages[0].activityTimeline[0].eventId, "guidance-analysis:live");
  });
});

test("session save writes the display summary once", async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const userId = "u1";
    await mkdir(path.join(workspaceRoot, userId), { recursive: true });
    const runtime = createSessionServices({ workspaceRoot });
    await runtime.sessionTreeService.upsertSessionTree({
      userId,
      sessionId: "single-summary-write",
    });
    await runtime.sessionCrudService.ensureSession(userId, "single-summary-write", "");

    const repository = runtime.repositories.sessionRepository;
    const originalWriteJsonAtomic = repository.storageService.writeJsonAtomic.bind(
      repository.storageService,
    );
    let displaySummaryWrites = 0;
    repository.storageService.writeJsonAtomic = async (filePath, payload) => {
      if (String(filePath).endsWith(`${path.sep}session-summary.json`)) displaySummaryWrites += 1;
      return originalWriteJsonAtomic(filePath, payload);
    };
    const session = await repository.findById(userId, "single-summary-write", "");
    session.messages = canonicalMessages(
      [{ role: "user", content: "one durable update" }],
      "single_write",
    );

    await repository.save(userId, session, "");

    assert.equal(displaySummaryWrites, 1);
  });
});

test("summary checkpoint receipts survive turn-journal persistence with historical targets", async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const userId = "u1";
    const sessionId = "checkpoint-receipt";
    await mkdir(path.join(workspaceRoot, userId), { recursive: true });
    const runtime = createSessionServices({ workspaceRoot });
    await runtime.sessionTreeService.upsertSessionTree({ userId, sessionId });
    await runtime.sessionCrudService.ensureSession(userId, sessionId, "");

    const repository = runtime.repositories.sessionRepository;
    const session = await repository.findById(userId, sessionId, "");
    session.messages = [
      {
        messageUid: "sm_historical",
        role: "assistant",
        content: "historical guidance",
        dialogProcessId: "dialog-old",
        turnScopeId: "turn-old",
      },
      {
        messageUid: "sm_current",
        role: "user",
        content: "current request",
        dialogProcessId: "dialog-current",
        turnScopeId: "turn-current",
      },
    ];
    session.turnLifecycle = {
      activeTurnScopeId: "turn-current",
      turns: {
        "turn-current": {
          turnScopeId: "turn-current",
          dialogProcessId: "dialog-current",
          messageId: "message-current",
          presentationMessageId: "presentation-current",
          state: "processing",
        },
      },
    };
    await repository.save(userId, session, "");

    const checkpoint = {
      userId,
      sessionId,
      dialogProcessId: "dialog-current",
      turnScopeId: "turn-current",
      checkpointId: "checkpoint-with-history",
      summarizedMessageUids: ["sm_historical"],
    };
    const committed = await runtime.sessionMessageService.commitTurnSummaryCheckpoint(checkpoint);
    assert.equal(committed.committed, true);

    const sessionFile = path.join(
      workspaceRoot,
      userId,
      "runtime",
      "session",
      sessionId,
      "session.json",
    );
    const manifest = JSON.parse(await readFile(sessionFile, "utf8"));
    assert.equal("messages" in manifest, false);
    assert.deepEqual(
      manifest.turnSummaryCheckpoints["turn-current"].receipts[0].summarizedMessageUids,
      ["sm_historical"],
    );

    const reloaded = await repository.findById(userId, sessionId, "");
    assert.equal(
      reloaded.messages.find((message) => message.messageUid === "sm_historical").summarized,
      true,
    );
    assert.deepEqual(
      reloaded.turnSummaryCheckpoints["turn-current"].receipts[0].summarizedMessageUids,
      ["sm_historical"],
    );
    const replay = await runtime.sessionMessageService.commitTurnSummaryCheckpoint(checkpoint);
    assert.equal(replay.deduplicated, true);
  });
});

test("concurrent saves for different sessions preserve every sessions summary entry", async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const userId = "u1";
    await mkdir(path.join(workspaceRoot, userId), { recursive: true });
    const runtime = createSessionServices({ workspaceRoot });
    await runtime.sessionTreeService.upsertSessionTree({ userId, sessionId: "A" });
    await runtime.sessionTreeService.upsertSessionTree({ userId, sessionId: "B" });
    await runtime.sessionCrudService.ensureSession(userId, "A", "");
    await runtime.sessionCrudService.ensureSession(userId, "B", "");
    const [sessionA, sessionB] = await Promise.all([
      runtime.repositories.sessionRepository.findById(userId, "A", ""),
      runtime.repositories.sessionRepository.findById(userId, "B", ""),
    ]);
    sessionA.messages = canonicalMessages([{ role: "user", content: "updated A" }], "concurrent_a");
    sessionB.messages = canonicalMessages([{ role: "user", content: "updated B" }], "concurrent_b");

    await Promise.all([
      runtime.repositories.sessionRepository.save(userId, sessionA, ""),
      runtime.repositories.sessionRepository.save(userId, sessionB, ""),
    ]);

    const summary = await runtime.repositories.sessionRepository.readSessionsSummary(userId);
    assert.deepEqual(summary.sessions.map((item) => item.sessionId).sort(), ["A", "B"]);
    assert.equal(summary.sessions.find((item) => item.sessionId === "A").title, "updated A");
    assert.equal(summary.sessions.find((item) => item.sessionId === "B").title, "updated B");
  });
});

