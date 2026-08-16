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
  let currentSession = structuredClone({
    aggregateVersion: 0,
    turnLifecycle: { turns: {}, commandReceipts: [] },
    ...initialSession,
  });
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
    allocateDialogProcessId: () => "dialog-replacement",
  });
  return { service, saved, getSession: () => currentSession };
}

function baseSession(overrides = {}) {
  return {
    sessionId: "s1",
    parentSessionId: "",
    aggregateVersion: 2,
    turnLifecycle: { turns: {}, commandReceipts: [] },
    messages: [
      { turnScopeId: "scope-keep", role: "user", content: "keep", dialogProcessId: "dp-keep" },
      { role: "user", content: "old", dialogProcessId: "dp-old", turnScopeId: "scope-old" },
      {
        role: "assistant",
        content: "old answer",
        dialogProcessId: "dp-old",
        turnScopeId: "scope-old",
      },
      { role: "user", content: "tail", turnScopeId: "scope-tail" },
    ],
    ...overrides,
  };
}

test("SessionMessageService.replaceTurn matches turnScopeId and returns snapshot without old tail", async () => {
  const { service, saved } = createService({
    initialSession: baseSession({
      turnLifecycle: {
        activeTurnScopeId: "",
        sequence: 8,
        turns: {
          "scope-keep": {
            turnScopeId: "scope-keep",
            messageId: "source-keep",
            presentationMessageId: "presentation-keep",
            state: "completed",
            phase: "completion",
            revision: 4,
            sequence: 4,
          },
          "scope-old": {
            turnScopeId: "scope-old",
            messageId: "source-old",
            presentationMessageId: "presentation-old",
            state: "stop_completed",
            phase: "stop",
            revision: 4,
            sequence: 6,
          },
          "scope-tail": {
            turnScopeId: "scope-tail",
            messageId: "source-tail",
            presentationMessageId: "presentation-tail",
            state: "stop_completed",
            phase: "stop",
            revision: 4,
            sequence: 8,
          },
        },
        commandReceipts: [
          {
            commandId: "keep-receipt",
            type: "turn.completed",
            turnScopeId: "scope-keep",
            requestHash: "keep",
          },
          {
            commandId: "old-receipt",
            type: "turn.stop_completed",
            turnScopeId: "scope-old",
            requestHash: "old",
          },
        ],
      },
    }),
  });

  const result = await service.replaceTurn({
    userId: "u1",
    sessionId: "s1",
    anchor: { turnScopeId: "scope-old" },
    newContent: "edited",
    turnScopeId: "turn-scope-new",
    expectedAggregateVersion: 2,
    commandId: "idem-1",
  });

  assert.deepEqual(Object.keys(result).sort(), ["deduplicated", "session", "turnReplacement"]);
  assert.deepEqual(result.turnReplacement, {
    protocolVersion: 1,
    eventType: "turn.replaced",
    commandId: "idem-1",
    sessionId: "s1",
    committedAggregateVersion: 3,
    replacedTurnScopeIds: ["scope-old", "scope-tail"],
    replacementDialogProcessId: saved[0].messages[1].dialogProcessId,
    replacementTurnScopeId: "turn-scope-new",
    replacementUserMessageId: saved[0].messages[1].messageId,
    requestHash: result.turnReplacement.requestHash,
    committedAt: "2026-06-22T00:00:00.000Z",
  });
  assert.equal(saved.length, 1);
  assert.deepEqual(
    saved[0].messages.map((message) => message.content),
    ["keep", "edited"],
  );
  assert.equal(saved[0].messages[1].role, "user");
  assert.equal(saved[0].messages[1].turnId, undefined);
  assert.match(saved[0].messages[1].messageUid, /^sm_/);
  assert.equal(saved[0].messages[1].messageId, saved[0].messages[1].messageUid);
  assert.equal(saved[0].messages[1].id, saved[0].messages[1].messageUid);
  assert.equal(saved[0].messages[1].turnScopeId, "turn-scope-new");
  assert.equal(saved[0].messages[1].dialogProcessId, "dialog-replacement");
  assert.equal(
    saved[0].messages[1].dialogProcessId,
    result.turnReplacement.replacementDialogProcessId,
  );
  assert.equal(saved[0].aggregateVersion, 3);
  assert.equal(saved[0].updatedAt, "2026-06-22T00:00:00.000Z");
  assert.deepEqual(Object.keys(saved[0].turnLifecycle.turns), ["scope-keep"]);
  assert.deepEqual(
    saved[0].turnLifecycle.commandReceipts.map((item) => [item.type, item.turnScopeId]),
    [
      ["turn.completed", "scope-keep"],
      ["session.turn.replace", undefined],
    ],
  );
  assert.equal(saved[0].turnLifecycle.sequence, 9);
  assert.equal(
    saved[0].turnLifecycle.replacedTurns["scope-old"].replacementTurnScopeId,
    "turn-scope-new",
  );
  assert.equal(
    saved[0].turnLifecycle.replacedTurns["scope-tail"].replacementTurnScopeId,
    "turn-scope-new",
  );
});

test("SessionMessageService.replaceTurn mutates only the owning lifecycle aggregate", async () => {
  const parent = createService({
    initialSession: baseSession({
      turnLifecycle: {
        turns: {
          "scope-keep": {
            turnScopeId: "scope-keep",
            dialogProcessId: "dp-keep",
            state: "completed",
          },
          "scope-old": {
            turnScopeId: "scope-old",
            dialogProcessId: "dp-old",
            state: "action_failed",
          },
          "scope-tail": {
            turnScopeId: "scope-tail",
            dialogProcessId: "dp-tail",
            state: "stop_completed",
          },
        },
        commandReceipts: [],
      },
    }),
  });
  const child = createService({
    initialSession: {
      sessionId: "child",
      parentSessionId: "s1",
      messages: [{ turnScopeId: "child-turn", role: "user", content: "child" }],
      turnLifecycle: {
        turns: {
          "child-turn": {
            turnScopeId: "child-turn",
            dialogProcessId: "child-dialog",
            state: "stop_completed",
          },
        },
        commandReceipts: [],
      },
    },
  });

  await parent.service.replaceTurn({
    userId: "u1",
    sessionId: "s1",
    anchor: { turnScopeId: "scope-old" },
    newContent: "edited",
    turnScopeId: "scope-new",
    commandId: "replace-statuses",
  });

  assert.deepEqual(Object.keys(parent.getSession().turnLifecycle.turns), ["scope-keep"]);
  assert.deepEqual(Object.keys(child.getSession().turnLifecycle.turns), ["child-turn"]);
});

test("SessionMessageService.replaceTurn preserves rich attachment fields when payload is raw", async () => {
  const richAttachment = {
    attachmentId: "att-rich",
    name: "report.docx",
    mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    size: 123,
    sessionId: "s1",
    attachmentSource: "user",
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
          content: "old",
          dialogProcessId: "dp-old",
          turnScopeId: "scope-old",
          attachments: [richAttachment],
        },
        {
          role: "assistant",
          content: "old answer",
          dialogProcessId: "dp-old",
          turnScopeId: "scope-old",
        },
      ],
    }),
  });

  await service.replaceTurn({
    userId: "u1",
    sessionId: "s1",
    anchor: { turnScopeId: "scope-old" },
    newContent: "edited",
    turnScopeId: "scope-new",
    commandId: "replace-rich-attachment",
    attachments: [
      {
        attachmentId: richAttachment.attachmentId,
        sessionId: richAttachment.sessionId,
        attachmentSource: richAttachment.attachmentSource,
        name: "report.docx",
        mimeType: richAttachment.mimeType,
        size: 123,
      },
    ],
  });

  assert.equal(saved.length, 1);
  assert.deepEqual(saved[0].messages[0].attachments[0], richAttachment);
});

test("SessionMessageService.replaceTurn rejects attachments without stable identity", async () => {
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
        {
          role: "user",
          content: "old",
          dialogProcessId: "dp-old",
          turnScopeId: "scope-old",
          attachments: [richAttachment],
        },
        {
          role: "assistant",
          content: "old answer",
          dialogProcessId: "dp-old",
          turnScopeId: "scope-old",
        },
      ],
    }),
  });

  await service.replaceTurn({
    userId: "u1",
    sessionId: "s1",
    anchor: { turnScopeId: "scope-old" },
    newContent: "edited",
    turnScopeId: "scope-new",
    commandId: "replace-attachment-identity",
    attachments: [incomingAttachment],
  });

  assert.equal(saved.length, 1);
  assert.equal(saved[0].messages[0].attachments, undefined);
});

test("SessionMessageService.assertReusedUserTurnIdentity rejects attachment divergence", async () => {
  const committedAttachment = {
    attachmentId: "att-rich",
    sessionId: "s1",
    attachmentSource: "user",
    path: "/runtime/att-rich.docx",
    name: "report.docx",
  };
  const { service, saved } = createService({
    initialSession: baseSession({
      messages: [
        {
          role: "user",
          content: "edited",
          dialogProcessId: "dp-new",
          turnScopeId: "scope-edited",
          attachments: [committedAttachment],
        },
      ],
    }),
  });

  await assert.rejects(
    service.assertReusedUserTurnIdentity({
      userId: "u1",
      sessionId: "s1",
      turnScopeId: "scope-edited",
      dialogProcessId: "dp-new",
      attachments: [{ ...committedAttachment, attachmentId: "att-other" }],
    }),
    /attachments do not match Session authority/,
  );

  assert.equal(saved.length, 0);
});

test("SessionMessageService.replaceTurn rejects ts anchors", async () => {
  const { service: tsService, saved: tsSaved } = createService({
    initialSession: baseSession({
      messages: [
        { role: "user", content: "old", ts: "ts-user" },
        { role: "assistant", content: "old answer", ts: "ts-assistant" },
      ],
    }),
  });
  await assert.rejects(
    tsService.replaceTurn({
      userId: "u1",
      sessionId: "s1",
      anchor: { ts: "ts-assistant" },
      newContent: "by ts",
      turnScopeId: "scope-new",
      commandId: "replace-ts",
    }),
    (error) => error?.statusCode === 400 && /anchor is required/.test(error.message),
  );
  assert.equal(tsSaved.length, 0);
});

test("SessionMessageService.replaceTurn rejects dialogId compatibility anchors", async () => {
  const { service, saved } = createService({
    initialSession: baseSession({
      messages: [
        { role: "user", content: "first", dialogId: "dp-compat" },
        { role: "assistant", content: "answer", dialogId: "dp-compat" },
        { role: "user", content: "tail", dialogId: "dp-tail" },
      ],
    }),
  });

  await assert.rejects(
    service.replaceTurn({
      userId: "u1",
      sessionId: "s1",
      anchor: { dialogId: "dp-compat" },
      newContent: "edited compat",
      turnScopeId: "scope-new",
      commandId: "replace-dialog-id",
    }),
    (error) => error?.statusCode === 400 && /anchor is required/.test(error.message),
  );
  assert.equal(saved.length, 0);
});

test("SessionMessageService.replaceTurn rejects conflicts and missing anchors without saving", async () => {
  const { service, saved } = createService({
    initialSession: baseSession({ aggregateVersion: 5 }),
  });

  await assert.rejects(
    service.replaceTurn({
      userId: "u1",
      sessionId: "s1",
      anchor: { turnScopeId: "scope-old" },
      newContent: "edit",
      turnScopeId: "scope-new",
      commandId: "replace-conflict",
      expectedAggregateVersion: 4,
    }),
    (error) => error?.statusCode === 409 && error?.currentVersion === 5,
  );
  await assert.rejects(
    service.replaceTurn({
      userId: "u1",
      sessionId: "s1",
      anchor: { turnScopeId: "missing" },
      newContent: "edit",
      turnScopeId: "scope-new",
      commandId: "replace-missing",
    }),
    (error) => error?.statusCode === 404 && /anchor not found/.test(error.message),
  );
  assert.equal(saved.length, 0);
});

test("SessionMessageService.replaceTurn validates required payload", async () => {
  const { service, saved } = createService({ initialSession: baseSession() });

  await assert.rejects(
    service.replaceTurn({
      userId: "u1",
      sessionId: "s1",
      anchor: { turnScopeId: "scope-old" },
      newContent: " ",
    }),
    (error) => error?.statusCode === 400 && /newContent is required/.test(error.message),
  );
  await assert.rejects(
    service.replaceTurn({
      userId: "u1",
      sessionId: "s1",
      newContent: "edit",
      turnScopeId: "scope-new",
      commandId: "replace-no-anchor",
    }),
    (error) => error?.statusCode === 400 && /anchor is required/.test(error.message),
  );
  await assert.rejects(
    service.replaceTurn({
      userId: "u1",
      sessionId: "s1",
      anchor: { turnScopeId: "scope-old" },
      newContent: "edit",
      commandId: "replace-no-scope",
    }),
    (error) => error?.statusCode === 400 && /turnScopeId is required/.test(error.message),
  );
  await assert.rejects(
    service.replaceTurn({
      userId: "u1",
      sessionId: "s1",
      anchor: { turnScopeId: "scope-old" },
      newContent: "edit",
      turnScopeId: "scope-new",
    }),
    (error) => error?.statusCode === 400 && /commandId is required/.test(error.message),
  );
  assert.equal(saved.length, 0);
});

test("SessionMessageService.assertReusedUserTurnIdentity accepts the exact committed identity without saving", async () => {
  const attachments = [
    {
      attachmentId: "att-1",
      sessionId: "s1",
      attachmentSource: "user",
      path: "/runtime/att-1.txt",
      contentSha256: "sha-1",
      name: "report.txt",
    },
  ];
  const { service, saved } = createService({
    initialSession: baseSession({
      messages: [
        {
          role: "user",
          content: "edited",
          dialogProcessId: "dp-new",
          turnScopeId: "scope-edited",
          frontendUserMessage: true,
          attachments,
        },
      ],
    }),
  });

  const result = await service.assertReusedUserTurnIdentity({
    userId: "u1",
    sessionId: "s1",
    turnScopeId: "scope-edited",
    dialogProcessId: "dp-new",
    attachments,
  });

  assert.equal(result.asserted, true);
  assert.equal(result.messageIndex, 0);
  assert.equal(result.userMessage.dialogProcessId, "dp-new");
  assert.deepEqual(result.userMessage.attachments, attachments);
  assert.equal(saved.length, 0);
});

test("SessionMessageService.assertReusedUserTurnIdentity ignores derived attachment presentation fields", async () => {
  const committedAttachment = {
    attachmentId: "att-1",
    sessionId: "s1",
    attachmentSource: "user",
    path: "/runtime/att-1.txt",
    contentSha256: "sha-1",
    name: "report.txt",
  };
  const { service, saved } = createService({
    initialSession: baseSession({
      messages: [
        {
          role: "user",
          content: "edited",
          dialogProcessId: "dp-new",
          turnScopeId: "scope-edited",
          attachments: [committedAttachment],
        },
      ],
    }),
  });

  const result = await service.assertReusedUserTurnIdentity({
    userId: "u1",
    sessionId: "s1",
    turnScopeId: "scope-edited",
    dialogProcessId: "dp-new",
    attachments: [
      {
        ...committedAttachment,
        name: "derived-display-name.txt",
        downloadUrl: "/api/attachments/att-1",
        previewUrl: "",
        generatedByModel: false,
        parsedResult: {},
      },
    ],
  });

  assert.equal(result.asserted, true);
  assert.equal(saved.length, 0);
});

test("SessionMessageService.assertReusedUserTurnIdentity rejects immutable attachment identity divergence", async () => {
  const committedAttachment = {
    attachmentId: "att-1",
    sessionId: "s1",
    attachmentSource: "user",
    path: "/runtime/att-1.txt",
    contentSha256: "sha-1",
  };
  const { service, saved } = createService({
    initialSession: baseSession({
      messages: [
        {
          role: "user",
          content: "edited",
          dialogProcessId: "dp-new",
          turnScopeId: "scope-edited",
          attachments: [committedAttachment],
        },
      ],
    }),
  });

  for (const divergentAttachment of [
    { ...committedAttachment, attachmentId: "att-2" },
    { ...committedAttachment, sessionId: "s2" },
    { ...committedAttachment, attachmentSource: "model" },
    { ...committedAttachment, path: "/runtime/other.txt" },
    { ...committedAttachment, contentSha256: "sha-2" },
  ]) {
    await assert.rejects(
      service.assertReusedUserTurnIdentity({
        userId: "u1",
        sessionId: "s1",
        turnScopeId: "scope-edited",
        dialogProcessId: "dp-new",
        attachments: [divergentAttachment],
      }),
      (error) =>
        error?.errorCode === "INVALID_CANONICAL_ATTACHMENT" ||
        /attachments do not match Session authority/.test(error?.message || ""),
    );
  }
  assert.equal(saved.length, 0);
});

test("SessionMessageService.assertReusedUserTurnIdentity rejects dialog identity divergence", async () => {
  const { service, saved } = createService({
    initialSession: baseSession({
      messages: [
        {
          role: "user",
          content: "edited",
          dialogProcessId: "dp-committed",
          turnScopeId: "scope-edited",
        },
      ],
    }),
  });

  await assert.rejects(
    service.assertReusedUserTurnIdentity({
      userId: "u1",
      sessionId: "s1",
      turnScopeId: "scope-edited",
      dialogProcessId: "dp-other",
    }),
    /dialogProcessId does not match Session authority/,
  );

  assert.equal(saved.length, 0);
});

test("SessionMessageService.assertReusedUserTurnIdentity requires complete identity", async () => {
  const { service, saved } = createService({ initialSession: baseSession() });

  await assert.rejects(
    service.assertReusedUserTurnIdentity({
      userId: "u1",
      sessionId: "s1",
      dialogProcessId: "dp-new",
    }),
    /turnScopeId is required/,
  );

  assert.equal(saved.length, 0);
});
