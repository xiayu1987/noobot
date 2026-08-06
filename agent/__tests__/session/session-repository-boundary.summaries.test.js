/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";

import { createSessionServices } from "../../src/session/index.js";
import { writeSessionArtifact } from "../../src/session/session-artifact-store.js";
import {
  buildSessionDisplaySummary,
  SESSION_DISPLAY_SUMMARY_SCHEMA_VERSION,
} from "../../src/session/session-summary-builders.js";
import { readSessionArtifact } from "../../src/session/session-artifact-store.js";

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

function canonicalMessages(messages = [], namespace = "summary") {
  return messages.map((message, index) => {
    const turnScopeId = String(message?.turnScopeId || `turn-${namespace}-${index + 1}`);
    return {
      messageUid: String(message?.messageUid || `sm_${namespace}_${index + 1}`),
      dialogProcessId: String(message?.dialogProcessId || `dialog-${turnScopeId}`),
      turnScopeId,
      ...message,
    };
  });
}













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
    sessionB.messages = canonicalMessages([
      { role: "system", content: "ignored" },
      { role: "user", content: "1234567890123456789012345" },
      { role: "assistant", content: "done", attachmentMetas: [{ id: "big" }] },
    ], "list_b");
    sessionB.currentTaskId = "task-b";
    await runtime.repositories.sessionRepository.save(userId, sessionB, "A");

    let summary = await runtime.repositories.sessionRepository.readSessionsSummary(userId);
    const writtenB = summary.sessions.find((item) => item.sessionId === "B");
    assert.equal(writtenB.title, "12345678901234567890");
    assert.equal(writtenB.messageCount, 3);
    assert.equal(writtenB.depth, 0);
    assert.equal(Array.isArray(writtenB.messages), false);
    assert.equal(writtenB.lastMessage.role, "assistant");
    assert.equal("attachmentMetas" in writtenB.lastMessage, false);

    const list = await runtime.sessionCrudService.getAllSessionSummaries({ userId });
    const listedB = list.find((item) => item.sessionId === "B");
    assert.equal(list.length, 2);
    assert.equal(listedB.depth, 2);
    assert.equal("messages" in listedB, false);

    summary = JSON.parse(
      await readFile(path.join(workspaceRoot, userId, "runtime", "session", "sessions.json"), "utf8"),
    );
    assert.equal(summary.sessions.find((item) => item.sessionId === "B").depth, 2);
  });
});

test("display maintenance rejects artifacts that require offline protocol migration", async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const userId = "u1";
    const sessionId = "legacy";
    await mkdir(path.join(workspaceRoot, userId), { recursive: true });
    const runtime = createSessionServices({ workspaceRoot });
    await runtime.sessionTreeService.upsertSessionTree({ userId, sessionId });
    await runtime.sessionCrudService.ensureSession(userId, sessionId, "");

    const session = await runtime.repositories.sessionRepository.findById(userId, sessionId, "");
    session.messages = [{
      messageUid: "sm-legacy-user",
      role: "user",
      content: "legacy message",
      turnScopeId: "turn-legacy",
      dialogProcessId: "dialog-legacy",
    }];
    await runtime.repositories.sessionRepository.save(userId, session, "");

    const sessionDir = path.join(workspaceRoot, userId, "runtime", "session", sessionId);
    await writeFile(
      path.join(sessionDir, "session.json"),
      JSON.stringify({ ...session, schemaVersion: 4 }),
      "utf8",
    );
    await writeFile(
      path.join(sessionDir, "session-summary.json"),
      JSON.stringify({ schemaVersion: 13, sessionId, messages: [] }),
      "utf8",
    );

    const maintenance = await runtime.sessionCrudService.maintainSessionDisplaySummaries({ userId });
    assert.deepEqual(maintenance.failures, [{
      sessionId,
      code: "SESSION_TURN_JOURNAL_SCHEMA_REQUIRED",
      message: "Session artifact requires offline protocol migration",
    }]);
    assert.deepEqual(maintenance.migratedSessionIds, []);
    assert.deepEqual(maintenance.rebuiltSessionIds, []);

    const manifest = JSON.parse(await readFile(path.join(sessionDir, "session.json"), "utf8"));
    assert.equal(manifest.schemaVersion, 4);
    assert.equal("messages" in manifest, true);
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
    kept.messages = [{
      messageUid: "sm-kept-user",
      role: "user",
      content: "keep me",
      turnScopeId: "turn-kept",
      dialogProcessId: "dialog-kept",
    }];
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
    const display = await runtime.sessionCrudService.getSessionDisplayData({ userId, sessionId: "kept" });
    assert.equal(display.exists, true);
    assert.equal(display.sessions[0].depth, 1);
    assert.equal(display.sessions[0].messages[0].content, "keep me");
  });
});

test("session save refreshes the display projection with live activity timeline", async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const userId = "u1";
    await mkdir(path.join(workspaceRoot, userId), { recursive: true });
    const runtime = createSessionServices({ workspaceRoot });
    await runtime.sessionTreeService.upsertSessionTree({ userId, sessionId: "live" });
    await runtime.sessionCrudService.ensureSession(userId, "live", "");

    const session = await runtime.repositories.sessionRepository.findById(userId, "live", "");
    session.messages = canonicalMessages([{
      role: "assistant",
      type: "tool_call",
      chatPresentation: false,
      presentationMessageId: "presentation-live",
      turnScopeId: "turn-live",
      activityTimeline: [{
        eventId: "guidance-analysis:live",
        activityKind: "guidance_analysis",
        sequence: 1,
        sequenceDomain: "activity",
        sequenceScopeId: "presentation-live",
        authority: "authoritative",
        text: "analysis in progress",
      }],
    }], "live");
    await runtime.repositories.sessionRepository.save(userId, session, "");

    const display = await runtime.repositories.sessionRepository.readSessionDisplaySummary(userId, "live", "");
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
    await runtime.sessionTreeService.upsertSessionTree({ userId, sessionId: "single-summary-write" });
    await runtime.sessionCrudService.ensureSession(userId, "single-summary-write", "");

    const repository = runtime.repositories.sessionRepository;
    const originalWriteJsonAtomic = repository.storageService.writeJsonAtomic.bind(repository.storageService);
    let displaySummaryWrites = 0;
    repository.storageService.writeJsonAtomic = async (filePath, payload) => {
      if (String(filePath).endsWith(`${path.sep}session-summary.json`)) displaySummaryWrites += 1;
      return originalWriteJsonAtomic(filePath, payload);
    };
    const session = await repository.findById(userId, "single-summary-write", "");
    session.messages = canonicalMessages([{ role: "user", content: "one durable update" }], "single_write");

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

test("session display summary projects persisted messageUid as canonical message identity", () => {
  const summary = buildSessionDisplaySummary({
    sessionId: "identity-session",
    messages: [{
      role: "user",
      content: "persisted user",
      messageUid: "sm-persisted-user",
      frontendUserMessage: true,
      turnScopeId: "turn-identity",
    }],
  });

  assert.deepEqual(
    (({ id, messageId, messageUid, role }) => ({ id, messageId, messageUid, role }))(summary.messages[0]),
    {
      id: "sm-persisted-user",
      messageId: "sm-persisted-user",
      messageUid: "sm-persisted-user",
      role: "user",
    },
  );
});

test("session display summary retains a workflow final assistant with stable presentation identity", () => {
  const summary = buildSessionDisplaySummary({
    sessionId: "workflow-final-session",
    messages: [{
      role: "assistant",
      type: "workflow",
      content: "final workflow body\n\n/workspace/result.md",
      messageUid: "sm-workflow-final",
      messageId: "sm-workflow-final",
      presentationMessageId: "assistant-presentation-workflow",
      chatPresentation: true,
      turnScopeId: "turn-workflow",
      transferEnvelopes: [{
        protocol: "noobot.semantic-transfer",
        version: 1,
        direction: "output",
        transport: "file",
        files: [{ filePath: "/workspace/result.md" }],
      }],
    }],
  });

  assert.equal(summary.messages.length, 1);
  assert.equal(summary.messages[0]?.messageId, "assistant-presentation-workflow");
  assert.equal(summary.messages[0]?.content.includes("/workspace/result.md"), true);
  assert.equal(summary.messages[0]?.transferEnvelopes?.length, 1);
});

test("session display summary does not synthesize a missing workflow presentation identity", () => {
  const summary = buildSessionDisplaySummary({
    sessionId: "workflow-lifecycle-session",
    messages: [{
      role: "assistant",
      type: "workflow",
      content: "persisted workflow final",
      messageUid: "sm-workflow-lifecycle",
      messageId: "sm-workflow-lifecycle",
      chatPresentation: true,
      turnScopeId: "turn-workflow-lifecycle",
    }],
    turnLifecycle: {
      turns: {
        "turn-workflow-lifecycle": {
          turnScopeId: "turn-workflow-lifecycle",
          presentationMessageId: "assistant-from-lifecycle",
          state: "completed",
        },
      },
    },
  });

  assert.equal(summary.messages.length, 0);
});

test("session display summary materializes the active Turn presentation in the zero-event window", () => {
  const summary = buildSessionDisplaySummary({
    sessionId: "active-turn-session",
    messages: [{
      role: "user",
      type: "message",
      content: "resend request",
      messageUid: "sm-active-user",
      messageId: "sm-active-user",
      frontendUserMessage: true,
      turnScopeId: "turn-active",
    }],
    turnLifecycle: {
      activeTurnScopeId: "turn-active",
      turns: {
        "turn-active": {
          turnScopeId: "turn-active",
          presentationMessageId: "presentation-active",
          dialogProcessId: "dialog-active",
          state: "processing",
          updatedAt: "2026-07-31T02:53:42.225Z",
        },
      },
    },
  });

  assert.deepEqual(summary.messages.map((message) => ({
    role: message.role,
    messageId: message.messageId,
    presentationMessageId: message.presentationMessageId || "",
    turnScopeId: message.turnScopeId,
  })), [
    {
      role: "user",
      messageId: "sm-active-user",
      presentationMessageId: "",
      turnScopeId: "turn-active",
    },
    {
      role: "assistant",
      messageId: "presentation-active",
      presentationMessageId: "presentation-active",
      turnScopeId: "turn-active",
    },
  ]);
  assert.equal(summary.messages[1].turnPlaceholder, true);
  assert.equal(summary.messages[1].chatPresentation, true);
});

test("full and summary Session Detail expose the same canonical active Turn messages", async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const userId = "u1";
    const sessionId = "active-full-detail";
    await mkdir(path.join(workspaceRoot, userId), { recursive: true });
    const runtime = createSessionServices({ workspaceRoot });
    await runtime.sessionTreeService.upsertSessionTree({ userId, sessionId });
    await runtime.sessionCrudService.ensureSession(userId, sessionId, "");

    const session = await runtime.repositories.sessionRepository.findById(userId, sessionId, "");
    session.messages = canonicalMessages([{
      id: "user-active-full",
      messageId: "user-active-full",
      messageUid: "user-active-full",
      role: "user",
      type: "message",
      content: "resend request",
      turnScopeId: "turn-active-full",
    }], "active_full");
    session.turnLifecycle = {
      activeTurnScopeId: "turn-active-full",
      sequence: 1,
      turns: {
        "turn-active-full": {
          turnScopeId: "turn-active-full",
          presentationMessageId: "presentation-active-full",
          dialogProcessId: "dialog-active-full",
          state: "processing",
          sequence: 1,
          updatedAt: "2026-07-31T03:04:06.000Z",
        },
      },
    };
    await runtime.repositories.sessionRepository.save(userId, session, "");
    await runtime.sessionCrudService.maintainSessionDisplaySummaries({ userId });

    const summaryDetail = await runtime.sessionCrudService.getSessionDisplayData({ userId, sessionId });
    const fullDetail = await runtime.sessionCrudService.getSessionData({ userId, sessionId });
    const summarySession = summaryDetail.sessions[0];
    const fullSession = fullDetail.sessions[0];

    assert.equal(fullDetail.detailMode, "full");
    assert.equal(fullDetail.messageProjection, "canonical-presentation");
    assert.equal(summaryDetail.messageProjection, fullDetail.messageProjection);
    assert.deepEqual(fullSession.messages, summarySession.messages);
    assert.deepEqual(fullSession.messages.map((message) => message.messageId), [
      "user-active-full",
      "presentation-active-full",
    ]);
    assert.equal(fullSession.messages[1].turnPlaceholder, true);
    assert.deepEqual(fullSession.rawMessages.map((message) => message.messageId), ["user-active-full"]);
  });
});

test("session display summary rejects an active Turn without canonical presentation identity", () => {
  assert.throws(() => buildSessionDisplaySummary({
    sessionId: "invalid-active-turn-session",
    messages: [],
    turnLifecycle: {
      activeTurnScopeId: "turn-active",
      turns: { "turn-active": { turnScopeId: "turn-active", state: "processing" } },
    },
  }), /presentation_message_id_missing/);
});

test("session display summary rejects an active Turn presentation identity owned by another role", () => {
  assert.throws(() => buildSessionDisplaySummary({
    sessionId: "conflicting-active-turn-session",
    messages: [{
      role: "user",
      content: "conflicting identity",
      messageId: "presentation-active",
      turnScopeId: "turn-active",
    }],
    turnLifecycle: {
      activeTurnScopeId: "turn-active",
      turns: {
        "turn-active": {
          turnScopeId: "turn-active",
          presentationMessageId: "presentation-active",
          state: "processing",
        },
      },
    },
  }), /presentation_role_conflict/);
});

test("session display summary does not duplicate an active Turn with persisted assistant facts", () => {
  const summary = buildSessionDisplaySummary({
    sessionId: "active-turn-with-facts",
    messages: [{
      role: "assistant",
      type: "tool_call",
      content: "",
      messageId: "model-tool-call",
      presentationMessageId: "presentation-active",
      chatPresentation: false,
      turnScopeId: "turn-active",
      activityTimeline: [{ eventId: "thinking-1", type: "thinking", text: "working" }],
    }],
    turnLifecycle: {
      activeTurnScopeId: "turn-active",
      turns: {
        "turn-active": {
          turnScopeId: "turn-active",
          presentationMessageId: "presentation-active",
          state: "processing",
        },
      },
    },
  });

  assert.equal(summary.messages.length, 1);
  assert.equal(summary.messages[0].messageId, "presentation-active");
  assert.equal(summary.messages[0].thinkingDetailCount, 1);
  assert.equal(summary.messages[0].activityTimeline.length, 1);
  assert.notEqual(summary.messages[0].turnPlaceholder, true);
});

test("session display summary projects one explicit assistant presentation from many model messages", () => {
  const summary = buildSessionDisplaySummary({
    sessionId: "assistant-presentation-session",
    messages: [
      {
        role: "assistant",
        type: "tool_call",
        content: "",
        messageUid: "sm-tool-call",
        messageId: "model-tool-call",
        presentationMessageId: "presentation-1",
        chatPresentation: false,
        turnScopeId: "turn-1",
        activityTimeline: [{
          eventId: "thinking-1",
          event: "thinking",
          type: "thinking",
          text: "working",
          sequence: 1,
          sequenceScopeId: "model-tool-call",
          sequenceDomain: "message-event",
          authority: "authoritative",
        }],
        toolTimeline: [{
          key: "call:tool-1",
          toolCallId: "tool-1",
          status: "completed",
        }],
      },
      {
        role: "assistant",
        type: "message",
        content: "final answer",
        messageUid: "sm-final",
        messageId: "model-final",
        presentationMessageId: "presentation-1",
        chatPresentation: true,
        turnScopeId: "turn-1",
      },
    ],
  });

  assert.equal(summary.messages.length, 1);
  assert.equal(summary.messages[0].thinkingDetailCount, 2);
  assert.equal(summary.messages[0].activityTimeline.length, 1);
  assert.equal(summary.messages[0].toolTimeline.length, 1);
  assert.deepEqual(
    (({ id, messageId, messageUid, sourceMessageId, sourceMessageUid, content }) => ({
      id, messageId, messageUid, sourceMessageId, sourceMessageUid, content,
    }))(summary.messages[0]),
    {
      id: "presentation-1",
      messageId: "presentation-1",
      messageUid: undefined,
      sourceMessageId: "model-final",
      sourceMessageUid: "sm-final",
      content: "final answer",
    },
  );
});

test("active Turn summary carries its authoritative thinking timelines", () => {
  const turnScopeId = "client-turn:active-timeline";
  const presentationMessageId = "presentation-active-timeline";
  const summary = buildSessionDisplaySummary({
    sessionId: "active-timeline-session",
    messages: [{
      role: "assistant",
      type: "tool_call",
      chatPresentation: false,
      messageId: "source-tool-message",
      presentationMessageId,
      turnScopeId,
      toolTimeline: [{
        key: "call:active-tool",
        toolCallId: "active-tool",
        tool: "read_file",
        call: { eventId: "tool-start" },
      }],
      activityTimeline: [{ eventId: "thinking-active", event: "thinking" }],
    }, {
      role: "assistant",
      type: "tool_call",
      chatPresentation: false,
      messageId: "source-tool-message-2",
      presentationMessageId,
      turnScopeId,
      toolTimeline: [{
        key: "call:active-tool-2",
        toolCallId: "active-tool-2",
        tool: "search",
        call: { eventId: "tool-start-2" },
      }],
      activityTimeline: [{ eventId: "thinking-active-2", event: "thinking" }],
    }],
    turnLifecycle: {
      activeTurnScopeId: turnScopeId,
      sequence: 1,
      turns: {
        [turnScopeId]: {
          sessionId: "active-timeline-session",
          turnScopeId,
          dialogProcessId: "dialog-active-timeline",
          presentationMessageId,
          state: "processing",
        },
      },
    },
  });
  const activePresentation = summary.messages.find((message) =>
    message.presentationMessageId === presentationMessageId,
  );
  assert.equal(activePresentation.toolTimeline.length, 2);
  assert.equal(activePresentation.activityTimeline.length, 2);
  assert.equal(activePresentation.hasThinkingDetails, true);
  assert.equal(activePresentation.thinkingDetailCount, 4);
});





test("session display summary should keep chat view lightweight and rebuild stale files", async () => {
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

    const userContentTail = "__USER_CONTENT_COMPLETE_TAIL__";
    const assistantContentTail = "__ASSISTANT_CONTENT_COMPLETE_TAIL__";
    const workflowContentTail = "__WORKFLOW_CONTENT_COMPLETE_TAIL__";
    const longUserContent = `show attachment ${"user-long-content-".repeat(400)}${userContentTail}`;
    const longAssistantContent = `final answer ${"assistant-long-content-".repeat(400)}${assistantContentTail}`;
    const longWorkflowContent = `workflow final ${"workflow-long-content-".repeat(400)}${workflowContentTail}`;
    const workflowTransferEnvelope = {
      protocol: "noobot.semantic-transfer",
      version: 1,
      direction: "output",
      transport: "file",
      payload: { huge: true },
      files: [
        {
          role: "primary",
          filePath: "/workspace/u1/runtime/workflow-result.md",
          attachmentMeta: {
            attachmentId: "att-workflow-1",
            sessionId: "B",
            attachmentSource: "model",
            name: "workflow-result.md",
            mimeType: "text/markdown",
            size: 321,
            path: "/host/workflow-result.md",
            relativePath: "runtime/workflow-result.md",
          },
          pathView: {
            displayPath: "/workspace/u1/runtime/workflow-result.md",
            sandboxPath: "/sandbox/u1/runtime/workflow-result.md",
            relativePath: "runtime/workflow-result.md",
            hostPath: "/host/workflow-result.md",
          },
        },
      ],
    };

    const sessionB = await runtime.repositories.sessionRepository.findById(userId, "B", "A");
    sessionB.messages = canonicalMessages([
      {
        id: "u1",
        messageId: "u1",
        messageUid: "sm-u1",
        role: "user",
        turnScopeId: "turn-scope-u1",
        dialogProcessId: "dp-u1",
        content: longUserContent,
        attachments: [{ id: "att-1", name: "a.txt", type: "text/plain", size: 12, raw: "large" }],
      },
      {
        id: "i1",
        role: "system",
        injectedMessage: true,
        content: "injected secret should not be in summary",
      },
      {
        id: "a1",
        role: "assistant",
        turnScopeId: "turn-scope-u1",
        dialogProcessId: "dp-u1",
        content: longAssistantContent,
        activityTimeline: [{
          eventId: "activity-1", event: "thinking", sequence: 1,
          sequenceDomain: "message-event", sequenceScopeId: "a1", authority: "authoritative",
          text: "full thinking",
        }],
        toolTimeline: [{
          key: "call:call-1", toolCallId: "call-1", status: "completed",
          call: { eventId: "tool-call-1" },
          resultEvent: {
            eventId: "tool-result-1",
            writtenFiles: [{
              toolName: "write_file",
              resolvedPath: "/workspace/u1/project/a.txt",
              fileName: "a.txt",
              sourceType: "tool",
              recognized: false,
            }],
          },
        }],
        tool_calls: [{ id: "call-1", function: { name: "write_file", arguments: { path: "/tmp/a" } } }],
        rawMessages: [{ role: "assistant", content: "raw" }],
      },
      {
        id: "plugin-attachment-assistant",
        role: "assistant",
        turnScopeId: "turn-scope-plugin",
        content: "plugin attachment result",
        attachments: [
          {
            attachmentId: "att-plugin-1",
            sessionId: "B",
            attachmentSource: "model",
            name: "harness-plan-text.txt",
            mimeType: "text/plain",
            size: 123,
            owner: { type: "plugin", id: "harness-plugin" },
            generationSource: "harness_plan",
          },
        ],
      },
      {
        role: "tool",
        type: "tool_result",
        turnScopeId: "turn-scope-u1",
        dialogProcessId: "dp-u1",
        tool_call_id: "call-1",
        content: JSON.stringify({
          toolName: "write_file",
          state: "OK",
          resolvedPath: "/workspace/u1/project/a.txt",
          fileName: "a.txt",
        }),
      },
      {
        role: "tool",
        type: "tool_result",
        tool_call_id: "call-2",
        content: "ordinary tool result should not be in summary".repeat(20),
      },
      {
        id: "w1",
        role: "assistant",
        type: "workflow",
        turnScopeId: "turn-scope-workflow",
        presentationMessageId: "w1",
        chatPresentation: true,
        content: longWorkflowContent,
        activityTimeline: [{
          eventId: "workflow-activity-1",
          event: "workflow_semantic_response",
          sequence: 1,
          sequenceDomain: "message-event",
          sequenceScopeId: "w1",
          authority: "authoritative",
        }],
        pluginMessage: true,
        pluginMeta: {
          pluginId: "p1",
          source: "workflow-plugin",
          kind: "workflow",
          phase: "final",
          nodeName: "Done",
          internalState: { huge: true },
          payload: {
            workflowRunId: "workflow-run-1",
            semantic: {
              nodes: [
                { id: "start", type: "state", stateType: "start", name: "Start" },
                { id: "act", type: "action", name: "Action", task: "Do work" },
              ],
              flowtos: [{ from: "start", to: "act", extra: { keep: true } }],
            },
            execution: {
              workflowRunId: "workflow-run-1",
              instanceId: "workflow-run-1",
              completed: true,
              status: "success",
              nodeAgentRuns: [
                {
                  stepId: "step-act",
                  nodeDialogId: "dialog-act",
                  nodeSessionId: "session-act",
                  stepStatus: "success",
                  step: { nodeId: "act", nodeName: "Action", type: "action" },
                  nodeResultTransferEnvelopes: [workflowTransferEnvelope],
                  nodeResultText: "large node result should be dropped".repeat(80),
                },
              ],
            },
            nodeSessions: [
              {
                nodeId: "act",
                nodeName: "Action",
                dialogId: "dialog-act",
                sessionId: "session-act",
                stepStatus: "success",
                transferEnvelopes: [workflowTransferEnvelope],
                nodeResultText: "large node session result should be dropped".repeat(80),
              },
            ],
            diagnostics: { huge: "debug detail should be dropped" },
          },
        },
        transferEnvelopes: [workflowTransferEnvelope],
      },
      {
        id: "u2",
        role: "user",
        type: "message",
        dialogProcessId: "dp-tool-only",
        content: "run tool only thinking details",
      },
      {
        id: "tool-display-assistant",
        role: "assistant",
        type: "message",
        dialogProcessId: "dp-tool-only",
        content: "tool only final answer",
        toolTimeline: [
          { key: "call:tool-only-1", toolCallId: "tool-only-1", status: "running", call: { eventId: "tool-only-call-1" } },
          { key: "call:tool-only-2", toolCallId: "tool-only-2", status: "completed", call: { eventId: "tool-only-call-2" }, resultEvent: { eventId: "tool-only-result-2" } },
        ],
      },
      {
        role: "assistant",
        type: "tool_call",
        dialogProcessId: "dp-tool-only",
        tool_calls: [
          { id: "call-tool-only", function: { name: "search", arguments: { q: "demo" } } },
        ],
      },
      {
        role: "tool",
        type: "tool_result",
        dialogProcessId: "dp-tool-only",
        tool_call_id: "call-tool-only",
        content: "tool only result detail should not be in summary",
      },
    ], "lightweight_b");
    await runtime.repositories.sessionRepository.save(userId, sessionB, "A");

    const scopeB = await runtime.repositories.sessionRepository.resolveSessionScope(userId, "B", "A");
    const summaryFile = path.join(scopeB.sessionDir, "session-summary.json");
    const persistedSession = await readSessionArtifact({ sessionDir: scopeB.sessionDir });
    assert.equal(persistedSession.messages.every((item) => "turnScopeId" in item), true);
    let summary = JSON.parse(await readFile(summaryFile, "utf8"));
    assert.equal(summary.schemaVersion, SESSION_DISPLAY_SUMMARY_SCHEMA_VERSION);
    assert.equal(summary.sessionId, "B");
    assert.equal(summary.messages.length, 6);
    assert.equal(summary.messages.every((item) => "turnScopeId" in item), true);
    assert.deepEqual(
      (({ id, messageId, messageUid }) => ({ id, messageId, messageUid }))(summary.messages[0]),
      { id: "u1", messageId: "u1", messageUid: "sm-u1" },
    );
    assert.equal(summary.stats.messageCount, 11);
    assert.equal(summary.stats.displayMessageCount, 6);
    assert.equal(summary.stats.injectedMessageCount, 1);
    assert.equal(summary.stats.thinkingMessageCount, 3);
    assert.equal(summary.stats.attachmentCount, 3);
    assert.equal(summary.stats.toolLogCount, 5);
    assert.equal(summary.stats.displayToolLogCount, 1);
    assert.equal(summary.stats.hasToolDetails, true);
    assert.equal("toolLogSummaries" in summary, false);
    const assistantMessage = summary.messages.find((item) => item.id === "a1");
    assert.equal(assistantMessage.toolTimeline.length, 1);
    assert.equal(assistantMessage.toolTimeline[0].status, "completed");
    assert.equal("log" in assistantMessage.toolTimeline[0].resultEvent, false);
    assert.equal(assistantMessage.toolTimeline[0].resultEvent.turnScopeId, "turn-scope-u1");
    assert.deepEqual(assistantMessage.toolTimeline[0].resultEvent.writtenFiles, [{
      toolName: "write_file",
      resolvedPath: "/workspace/u1/project/a.txt",
      fileName: "a.txt",
      sourceType: "tool",
      recognized: false,
    }]);
    assert.equal(JSON.stringify(assistantMessage.toolTimeline).includes("ordinary tool result"), false);

    const userMessage = summary.messages.find((item) => item.id === "u1");
    assert.equal(userMessage.turnScopeId, "turn-scope-u1");
    assert.equal(userMessage.content, longUserContent);
    assert.equal(userMessage.content.endsWith(userContentTail), true);
    assert.equal(userMessage.content.includes(`${userContentTail}…`), false);
    assert.deepEqual(userMessage.attachments, [
      {
        attachmentId: "att-1",
        name: "a.txt",
        mimeType: "text/plain",
        size: 12,
      },
    ]);
    assert.equal("id" in userMessage.attachments[0], false);
    assert.equal("type" in userMessage.attachments[0], false);
    assert.equal("source" in userMessage.attachments[0], false);
    assert.equal(assistantMessage.content, longAssistantContent);
    assert.equal(assistantMessage.content.endsWith(assistantContentTail), true);
    assert.equal(assistantMessage.content.includes(`${assistantContentTail}…`), false);
    assert.equal(assistantMessage.hasThinkingDetails, true);
    assert.equal(assistantMessage.thinkingDetailCount, 2);
    assert.equal("realtimeLogs" in assistantMessage, false);
    assert.equal("completedToolLogs" in assistantMessage, false);
    assert.equal("rawMessages" in assistantMessage, false);
    const pluginAttachmentAssistant = summary.messages.find((item) => item.id === "plugin-attachment-assistant");
    assert.deepEqual(pluginAttachmentAssistant.attachments, [
      {
        attachmentId: "att-plugin-1",
        name: "harness-plan-text.txt",
        mimeType: "text/plain",
        size: 123,
        attachmentSource: "model",
        sessionId: "B",
        owner: { type: "plugin", id: "harness-plugin" },
        generationSource: "harness_plan",
      },
    ]);
    assert.equal("id" in pluginAttachmentAssistant.attachments[0], false);
    assert.equal("type" in pluginAttachmentAssistant.attachments[0], false);
    assert.equal("source" in pluginAttachmentAssistant.attachments[0], false);
    const toolOnlyAssistantMessage = summary.messages.find((item) => item.id === "tool-display-assistant");
    assert.equal(toolOnlyAssistantMessage.content, "tool only final answer");
    assert.equal(toolOnlyAssistantMessage.hasThinkingDetails, true);
    assert.equal(toolOnlyAssistantMessage.thinkingDetailCount, 2);
    assert.equal("realtimeLogs" in toolOnlyAssistantMessage, false);
    assert.equal("completedToolLogs" in toolOnlyAssistantMessage, false);
    assert.equal(JSON.stringify(summary.messages).includes("tool only result detail"), false);
    const workflowMessage = summary.messages.find((item) => item.id === "w1");
    assert.equal(workflowMessage.type, "workflow");
    assert.equal(workflowMessage.pluginMeta.payload.workflowRunId, "workflow-run-1");
    assert.equal(workflowMessage.pluginMeta.payload.execution.workflowRunId, "workflow-run-1");
    assert.equal(workflowMessage.pluginMeta.payload.execution.instanceId, "workflow-run-1");
    assert.equal(workflowMessage.content, longWorkflowContent);
    assert.equal(workflowMessage.content.endsWith(workflowContentTail), true);
    assert.equal(workflowMessage.content.includes(`${workflowContentTail}…`), false);
    assert.equal(workflowMessage.pluginMeta.source, "workflow-plugin");
    assert.equal(workflowMessage.pluginMeta.nodeName, "Done");
    assert.equal("internalState" in workflowMessage.pluginMeta, false);
    assert.equal(workflowMessage.pluginMeta.payload.execution.completed, true);
    assert.equal(workflowMessage.pluginMeta.payload.execution.status, "success");
    assert.equal(workflowMessage.pluginMeta.payload.execution.nodeAgentRuns[0].stepStatus, "success");
    assert.equal(workflowMessage.pluginMeta.payload.execution.nodeAgentRuns[0].step.nodeId, "act");
    assert.equal(workflowMessage.pluginMeta.payload.nodeSessions[0].stepStatus, "success");
    assert.equal(workflowMessage.pluginMeta.payload.nodeSessions[0].nodeId, "act");
    assert.equal(workflowMessage.pluginMeta.payload.semantic.nodes.length, 2);
    assert.equal("nodeResultText" in workflowMessage.pluginMeta.payload.execution.nodeAgentRuns[0], false);
    assert.equal("nodeResultText" in workflowMessage.pluginMeta.payload.nodeSessions[0], false);
    assert.equal("diagnostics" in workflowMessage.pluginMeta.payload, false);
    assert.equal("transferEnvelopes" in workflowMessage, true);
    assert.equal(Array.isArray(workflowMessage.transferEnvelopes), true);
    assert.equal(workflowMessage.transferEnvelopes[0].protocol, "noobot.semantic-transfer");
    assert.equal("filePath" in workflowMessage.transferEnvelopes[0], false);
    assert.equal(workflowMessage.transferEnvelopes[0].files[0].attachmentId, "att-workflow-1");
    assert.equal(workflowMessage.transferEnvelopes[0].files[0].sandboxPath, "/sandbox/u1/runtime/workflow-result.md");
    assert.equal(workflowMessage.attachments[0].attachmentId, "att-workflow-1");
    assert.equal(workflowMessage.attachments[0].relativePath, "runtime/workflow-result.md");
    assert.equal("payload" in workflowMessage.transferEnvelopes[0], false);
    assert.equal("attachmentMeta" in workflowMessage.transferEnvelopes[0].files[0], false);
    assert.equal("pathView" in workflowMessage.transferEnvelopes[0].files[0], false);
    assert.equal(
      workflowMessage.pluginMeta.payload.execution.nodeAgentRuns[0].nodeResultTransferEnvelopes[0].files[0].attachmentId,
      "att-workflow-1",
    );
    assert.equal(
      workflowMessage.pluginMeta.payload.nodeSessions[0].transferEnvelopes[0].files[0].attachmentId,
      "att-workflow-1",
    );
    assert.equal(JSON.stringify(summary).includes("injected secret"), false);

    await writeFile(summaryFile, JSON.stringify({ schemaVersion: 4, sessionId: "B", depth: 2, messages: [] }), "utf8");
    await assert.rejects(
      runtime.sessionCrudService.getSessionDisplayData({ userId, sessionId: "B" }),
      (error) => error?.code === "SESSION_DISPLAY_SUMMARY_MAINTENANCE_REQUIRED",
    );
    const maintenance = await runtime.sessionCrudService.maintainSessionDisplaySummaries({ userId });
    assert.deepEqual(maintenance.rebuiltSessionIds, ["B"]);
    const displayData = await runtime.sessionCrudService.getSessionDisplayData({ userId, sessionId: "B" });
    assert.equal(displayData.summary, true);
    assert.equal(displayData.sessions.length, 1);
    assert.equal(displayData.sessions[0].depth, 2);
    assert.equal("toolLogSummaries" in displayData.sessions[0], false);
    summary = JSON.parse(await readFile(summaryFile, "utf8"));
    assert.equal(summary.schemaVersion, SESSION_DISPLAY_SUMMARY_SCHEMA_VERSION);
    assert.equal(summary.sessionId, "B");
    assert.equal("depth" in summary, false);
  });
});
