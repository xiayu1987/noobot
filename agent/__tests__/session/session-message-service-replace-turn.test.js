/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";

import { SessionMessageService } from "../../src/session/services/session-message-service.js";

function createService({ initialSession }) {
  const saved = [];
  let currentSession = structuredClone(initialSession);
  const sessionRepo = {
    async resolveParentSessionId() {
      return currentSession?.parentSessionId || "";
    },
    async findById() {
      return currentSession;
    },
    async save(_userId, session) {
      currentSession = structuredClone(session);
      saved.push(structuredClone(session));
    },
  };
  const service = new SessionMessageService({
    sessionRepo,
    now: () => "2026-06-22T00:00:00.000Z",
  });
  return { service, saved, getSession: () => currentSession };
}

function baseSession(overrides = {}) {
  return {
    sessionId: "s1",
    parentSessionId: "",
    version: 2,
    revision: 2,
    messages: [
      { turnScopeId: "scope-keep", role: "user", content: "keep", dialogProcessId: "dp-keep" },
      { role: "user", content: "old", dialogProcessId: "dp-old", turnScopeId: "scope-old" },
      { role: "assistant", content: "old answer", dialogProcessId: "dp-old", turnScopeId: "scope-old" },
      { role: "user", content: "tail", turnScopeId: "scope-tail" },
    ],
    ...overrides,
  };
}

test("SessionMessageService.replaceTurn matches turnScopeId and returns snapshot without old tail", async () => {
  const { service, saved } = createService({ initialSession: baseSession({
    turnLifecycle: {
      activeTurnScopeId: "",
      sequence: 8,
      turns: {
        "scope-keep": {
          turnScopeId: "scope-keep", messageId: "source-keep", presentationMessageId: "presentation-keep",
          state: "completed", phase: "completion", revision: 4, sequence: 4,
        },
        "scope-old": {
          turnScopeId: "scope-old", messageId: "source-old", presentationMessageId: "presentation-old",
          state: "stop_completed", phase: "stop", revision: 4, sequence: 6,
        },
        "scope-tail": {
          turnScopeId: "scope-tail", messageId: "source-tail", presentationMessageId: "presentation-tail",
          state: "stop_completed", phase: "stop", revision: 4, sequence: 8,
        },
      },
      commandReceipts: [
        { commandId: "keep-receipt", eventType: "turn.completed", turnScopeId: "scope-keep", requestHash: "keep" },
        { commandId: "old-receipt", eventType: "turn.stop_completed", turnScopeId: "scope-old", requestHash: "old" },
      ],
    },
  }) });

  const result = await service.replaceTurn({
    userId: "u1",
    sessionId: "s1",
    anchor: { turnScopeId: "scope-old" },
    newContent: "edited",
    turnScopeId: "turn-scope-new",
    expectedVersion: 2,
    idempotencyKey: "idem-1",
  });

  assert.deepEqual(Object.keys(result).sort(), ["deduplicated", "session", "turnReplacement"]);
  assert.deepEqual(result.turnReplacement, {
    protocolVersion: 1,
    eventType: "turn.replaced",
    commandId: "idem-1",
    sessionId: "s1",
    committedVersion: 3,
    replacedTurnScopeIds: ["scope-old", "scope-tail"],
    replacementTurnScopeId: "turn-scope-new",
    replacementUserMessageId: saved[0].messages[1].messageId,
    committedAt: "2026-06-22T00:00:00.000Z",
  });
  assert.equal(saved.length, 1);
  assert.deepEqual(saved[0].messages.map((message) => message.content), ["keep", "edited"]);
  assert.equal(saved[0].messages[1].role, "user");
  assert.equal(saved[0].messages[1].turnId, undefined);
  assert.match(saved[0].messages[1].messageUid, /^sm_/);
  assert.equal(saved[0].messages[1].messageId, saved[0].messages[1].messageUid);
  assert.equal(saved[0].messages[1].id, saved[0].messages[1].messageUid);
  assert.equal(saved[0].messages[1].turnScopeId, "turn-scope-new");
  assert.equal(saved[0].messages[1].dialogProcessId, "");
  assert.equal(saved[0].version, 3);
  assert.equal(saved[0].revision, 3);
  assert.equal(saved[0].updatedAt, "2026-06-22T00:00:00.000Z");
  assert.deepEqual(Object.keys(saved[0].turnLifecycle.turns), ["scope-keep"]);
  assert.deepEqual(saved[0].turnLifecycle.commandReceipts.map((item) => item.turnScopeId), ["scope-keep"]);
  assert.equal(saved[0].turnLifecycle.sequence, 9);
  assert.equal(saved[0].turnLifecycle.replacedTurns["scope-old"].replacementTurnScopeId, "turn-scope-new");
  assert.equal(saved[0].turnLifecycle.replacedTurns["scope-tail"].replacementTurnScopeId, "turn-scope-new");
});

test("SessionMessageService.replaceTurn cleans only the owning session turn statuses", async () => {
  const parent = createService({
    initialSession: baseSession({
      turnStatuses: [
        { turnScopeId: "scope-keep", dialogProcessId: "dp-keep", status: "completed", reason: "run_completed" },
        { turnScopeId: "scope-old", dialogProcessId: "dp-old", status: "error", reason: "run_error" },
        { turnScopeId: "scope-tail", status: "timeout", reason: "run_timeout" },
      ],
    }),
  });
  const child = createService({
    initialSession: {
      sessionId: "child",
      parentSessionId: "s1",
      messages: [{ turnScopeId: "child-turn", role: "user", content: "child" }],
      turnStatuses: [
        { turnScopeId: "child-turn", status: "user_stopped", reason: "user_stop" },
      ],
    },
  });

  await parent.service.replaceTurn({
    userId: "u1",
    sessionId: "s1",
    anchor: { turnScopeId: "scope-old" },
    newContent: "edited",
    turnScopeId: "scope-new",
    idempotencyKey: "replace-statuses",
  });

  assert.deepEqual(
    parent.getSession().turnStatuses.map((item) => item.turnScopeId),
    ["scope-keep"],
  );
  assert.deepEqual(
    child.getSession().turnStatuses.map((item) => item.turnScopeId),
    ["child-turn"],
  );
});

test("SessionMessageService.replaceTurn preserves rich attachment fields when payload is raw", async () => {
  const richAttachment = {
    attachmentId: "att-rich",
    name: "report.docx",
    mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    size: 123,
    sessionId: "s1",
    path: "/workspace/att-rich.docx",
    relativePath: "runtime/attach/s1/user/att-rich.docx",
    sandboxPath: "/workspace/att-rich.docx",
    parsedResult: { attachmentId: "parsed-rich", path: "/workspace/parsed-rich.md" },
  };
  const { service, saved } = createService({
    initialSession: baseSession({
      messages: [
        { role: "user", content: "old", dialogProcessId: "dp-old", turnScopeId: "scope-old", attachments: [richAttachment] },
        { role: "assistant", content: "old answer", dialogProcessId: "dp-old", turnScopeId: "scope-old" },
      ],
    }),
  });

  await service.replaceTurn({
    userId: "u1",
    sessionId: "s1",
    anchor: { turnScopeId: "scope-old" },
    newContent: "edited",
    turnScopeId: "scope-new",
    idempotencyKey: "replace-rich-attachment",
    attachments: [{ name: "report.docx", mimeType: richAttachment.mimeType, size: 123 }],
  });

  assert.equal(saved.length, 1);
  assert.deepEqual(saved[0].messages[0].attachments[0], richAttachment);
});

test("SessionMessageService.replaceTurn does not merge same-name attachments without stable identity", async () => {
  const richAttachment = {
    attachmentId: "att-rich",
    name: "report.docx",
    mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    size: 123,
    path: "/workspace/att-rich.docx",
    parsedResult: { attachmentId: "parsed-rich" },
  };
  const incomingAttachment = {
    name: "report.docx",
    mimeType: "application/pdf",
    size: 456,
  };
  const { service, saved } = createService({
    initialSession: baseSession({
      messages: [
        { role: "user", content: "old", dialogProcessId: "dp-old", turnScopeId: "scope-old", attachments: [richAttachment] },
        { role: "assistant", content: "old answer", dialogProcessId: "dp-old", turnScopeId: "scope-old" },
      ],
    }),
  });

  await service.replaceTurn({
    userId: "u1",
    sessionId: "s1",
    anchor: { turnScopeId: "scope-old" },
    newContent: "edited",
    turnScopeId: "scope-new",
    idempotencyKey: "replace-attachment-identity",
    attachments: [incomingAttachment],
  });

  assert.equal(saved.length, 1);
  assert.deepEqual(saved[0].messages[0].attachments, [incomingAttachment]);
});

test("SessionMessageService.stampReusedUserTurnDialogProcessId does not merge same-name attachments without stable identity", async () => {
  const richAttachment = {
    attachmentId: "att-rich",
    name: "report.docx",
    mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    size: 123,
    path: "/workspace/att-rich.docx",
    parsedResult: { attachmentId: "parsed-rich" },
  };
  const incomingAttachment = {
    name: "report.docx",
    mimeType: "application/pdf",
    size: 456,
  };
  const { service, saved } = createService({
    initialSession: baseSession({
      messages: [
        { role: "user", content: "edited", dialogProcessId: "dp-old", turnScopeId: "scope-edited", attachments: [richAttachment] },
      ],
    }),
  });

  await service.stampReusedUserTurnDialogProcessId({
    userId: "u1",
    sessionId: "s1",
    turnScopeId: "scope-edited",
    dialogProcessId: "dp-new",
    attachments: [incomingAttachment],
  });

  assert.equal(saved.length, 1);
  assert.deepEqual(saved[0].messages[0].attachments, [incomingAttachment]);
});

test("SessionMessageService.stampReusedUserTurnDialogProcessId preserves rich fields when resend payload is raw", async () => {
  const richAttachment = {
    attachmentId: "att-rich-resend",
    name: "report.docx",
    mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    size: 123,
    sessionId: "s1",
    attachmentSource: "user",
    path: "/workspace/admin/runtime/attach/scoped/s1/user/att-rich-resend/report.docx",
    relativePath: "runtime/attach/scoped/s1/user/att-rich-resend/report.docx",
    sandboxPath: "/workspace/admin/runtime/attach/scoped/s1/user/att-rich-resend/report.docx",
    previewUrl: "/api/attachments/preview/att-rich-resend",
    downloadUrl: "/api/attachments/download/att-rich-resend",
    parsedResultUrl: "/api/attachments/download/parsed-rich-resend",
    parsedResultAttachmentId: "parsed-rich-resend",
    parsedResult: { attachmentId: "parsed-rich-resend", path: "/workspace/parsed.md" },
  };
  const { service, saved } = createService({
    initialSession: baseSession({
      messages: [
        { role: "user", content: "edited", dialogProcessId: "dp-old", turnScopeId: "scope-edited", attachments: [richAttachment] },
      ],
    }),
  });

  await service.stampReusedUserTurnDialogProcessId({
    userId: "u1",
    sessionId: "s1",
    turnScopeId: "scope-edited",
    dialogProcessId: "dp-new",
    attachments: [{ name: "report.docx", mimeType: richAttachment.mimeType, size: 123 }],
  });

  assert.equal(saved.length, 1);
  assert.equal(saved[0].messages[0].dialogProcessId, "dp-new");
  assert.deepEqual(saved[0].messages[0].attachments, [richAttachment]);
});

test("SessionMessageService.replaceTurn rejects ts anchors", async () => {
  const { service: tsService, saved: tsSaved } = createService({
    initialSession: baseSession({ messages: [
      { role: "user", content: "old", ts: "ts-user" },
      { role: "assistant", content: "old answer", ts: "ts-assistant" },
    ] }),
  });
  await assert.rejects(
    tsService.replaceTurn({ userId: "u1", sessionId: "s1", anchor: { ts: "ts-assistant" }, newContent: "by ts", turnScopeId: "scope-new", idempotencyKey: "replace-ts" }),
    (error) => error?.statusCode === 400 && /anchor is required/.test(error.message),
  );
  assert.equal(tsSaved.length, 0);
});

test("SessionMessageService.replaceTurn rejects dialogId compatibility anchors", async () => {
  const { service, saved } = createService({
    initialSession: baseSession({ messages: [
      { role: "user", content: "first", dialogId: "dp-compat" },
      { role: "assistant", content: "answer", dialogId: "dp-compat" },
      { role: "user", content: "tail", dialogId: "dp-tail" },
    ] }),
  });

  await assert.rejects(
    service.replaceTurn({
      userId: "u1",
      sessionId: "s1",
      anchor: { dialogId: "dp-compat" },
      newContent: "edited compat",
      turnScopeId: "scope-new",
      idempotencyKey: "replace-dialog-id",
    }),
    (error) => error?.statusCode === 400 && /anchor is required/.test(error.message),
  );
  assert.equal(saved.length, 0);
});

test("SessionMessageService.replaceTurn rejects conflicts and missing anchors without saving", async () => {
  const { service, saved } = createService({ initialSession: baseSession({ version: 5, revision: 5 }) });

  await assert.rejects(
    service.replaceTurn({ userId: "u1", sessionId: "s1", anchor: { turnScopeId: "scope-old" }, newContent: "edit", turnScopeId: "scope-new", idempotencyKey: "replace-conflict", expectedVersion: 4 }),
    (error) => error?.statusCode === 409 && error?.currentVersion === 5,
  );
  await assert.rejects(
    service.replaceTurn({ userId: "u1", sessionId: "s1", anchor: { turnScopeId: "missing" }, newContent: "edit", turnScopeId: "scope-new", idempotencyKey: "replace-missing" }),
    (error) => error?.statusCode === 404 && /anchor not found/.test(error.message),
  );
  assert.equal(saved.length, 0);
});

test("SessionMessageService.replaceTurn validates required payload", async () => {
  const { service, saved } = createService({ initialSession: baseSession() });

  await assert.rejects(
    service.replaceTurn({ userId: "u1", sessionId: "s1", anchor: { turnScopeId: "scope-old" }, newContent: " " }),
    (error) => error?.statusCode === 400 && /newContent is required/.test(error.message),
  );
  await assert.rejects(
    service.replaceTurn({ userId: "u1", sessionId: "s1", newContent: "edit", turnScopeId: "scope-new", idempotencyKey: "replace-no-anchor" }),
    (error) => error?.statusCode === 400 && /anchor is required/.test(error.message),
  );
  await assert.rejects(
    service.replaceTurn({ userId: "u1", sessionId: "s1", anchor: { turnScopeId: "scope-old" }, newContent: "edit", idempotencyKey: "replace-no-scope" }),
    (error) => error?.statusCode === 400 && /turnScopeId is required/.test(error.message),
  );
  await assert.rejects(
    service.replaceTurn({ userId: "u1", sessionId: "s1", anchor: { turnScopeId: "scope-old" }, newContent: "edit", turnScopeId: "scope-new" }),
    (error) => error?.statusCode === 400 && /idempotencyKey is required/.test(error.message),
  );
  assert.equal(saved.length, 0);
});

test("SessionMessageService.stampReusedUserTurnDialogProcessId updates the reused real user", async () => {
  const { service, saved } = createService({
    initialSession: baseSession({
      messages: [
        { role: "user", content: "keep", dialogProcessId: "dp-keep", turnScopeId: "scope-keep" },
        {
          role: "user",
          content: "edited",
          dialogProcessId: "dp-old",
          turnScopeId: "scope-edited",
          frontendUserMessage: true,
        },
        {
          role: "user",
          content: "plugin relay",
          dialogProcessId: "dp-old",
          turnScopeId: "scope-edited",
          injectedMessage: true,
        },
      ],
    }),
  });

  const result = await service.stampReusedUserTurnDialogProcessId({
    userId: "u1",
    sessionId: "s1",
    turnScopeId: "scope-edited",
    dialogProcessId: "dp-new",
  });

  assert.equal(result.stamped, true);
  assert.equal(result.messageIndex, 1);
  assert.equal(saved.length, 1);
  assert.equal(saved[0].messages[0].dialogProcessId, "dp-keep");
  assert.equal(saved[0].messages[1].dialogProcessId, "dp-new");
  assert.equal(saved[0].messages[2].dialogProcessId, "dp-old");
  assert.equal(saved[0].version, 2);
});

test("SessionMessageService.stampReusedUserTurnDialogProcessId syncs reused user attachments", async () => {
  const { service, saved } = createService({
    initialSession: baseSession({
      messages: [
        { role: "user", content: "keep", dialogProcessId: "dp-keep", turnScopeId: "scope-keep" },
        {
          role: "user",
          content: "edited",
          dialogProcessId: "dp-old",
          turnScopeId: "scope-edited",
          frontendUserMessage: true,
          attachments: [{ attachmentId: "old", name: "old.txt" }],
        },
      ],
    }),
  });

  const nextAttachments = [
    { attachmentId: "kept", name: "kept.txt" },
    { attachmentId: "new", name: "new.txt" },
  ];
  const result = await service.stampReusedUserTurnDialogProcessId({
    userId: "u1",
    sessionId: "s1",
    turnScopeId: "scope-edited",
    dialogProcessId: "dp-new",
    attachments: nextAttachments,
  });

  assert.equal(result.stamped, true);
  assert.equal(saved.length, 1);
  assert.equal(saved[0].messages[1].dialogProcessId, "dp-new");
  assert.deepEqual(saved[0].messages[1].attachments, nextAttachments);
  assert.equal(saved[0].version, 2);
});

test("SessionMessageService.stampReusedUserTurnDialogProcessId preserves rich fields when prepared payload is raw-matching", async () => {
  const richAttachment = {
    attachmentId: "att-rich",
    name: "report.docx",
    mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    size: 123,
    sessionId: "s1",
    path: "/workspace/att-rich.docx",
    relativePath: "runtime/attach/s1/user/att-rich.docx",
    sandboxPath: "/workspace/att-rich.docx",
    parsedResult: { attachmentId: "parsed-rich", path: "/workspace/parsed-rich.md" },
  };
  const { service, saved } = createService({
    initialSession: baseSession({
      messages: [
        {
          role: "user",
          content: "edited",
          dialogProcessId: "dp-old",
          turnScopeId: "scope-edited",
          frontendUserMessage: true,
          attachments: [richAttachment],
        },
      ],
    }),
  });

  await service.stampReusedUserTurnDialogProcessId({
    userId: "u1",
    sessionId: "s1",
    turnScopeId: "scope-edited",
    dialogProcessId: "dp-new",
    attachments: [{ name: "report.docx", mimeType: richAttachment.mimeType, size: 123 }],
  });

  assert.equal(saved.length, 1);
  assert.equal(saved[0].messages[0].dialogProcessId, "dp-new");
  assert.deepEqual(saved[0].messages[0].attachments[0], richAttachment);
});

test("SessionMessageService.stampReusedUserTurnDialogProcessId preserves empty attachments as delete-all", async () => {
  const { service, saved } = createService({
    initialSession: baseSession({
      messages: [
        {
          role: "user",
          content: "edited",
          dialogProcessId: "dp-old",
          turnScopeId: "scope-edited",
          attachments: [{ attachmentId: "old", name: "old.txt" }],
        },
      ],
    }),
  });

  await service.stampReusedUserTurnDialogProcessId({
    userId: "u1",
    sessionId: "s1",
    turnScopeId: "scope-edited",
    dialogProcessId: "dp-new",
    attachments: [],
  });

  assert.equal(saved.length, 1);
  assert.deepEqual(saved[0].messages[0].attachments, []);
});

test("SessionMessageService.stampReusedUserTurnDialogProcessId does not stamp without turnScopeId", async () => {
  const { service, saved } = createService({ initialSession: baseSession() });

  const result = await service.stampReusedUserTurnDialogProcessId({
    userId: "u1",
    sessionId: "s1",
    dialogProcessId: "dp-new",
  });

  assert.deepEqual(result, { stamped: false, reason: "missing_turn_scope" });
  assert.equal(saved.length, 0);
});
