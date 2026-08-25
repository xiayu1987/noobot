/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";

import {
  buildContextMessages,
  buildHumanMessagesForUser,
} from "../../../src/context/assembly/message-builder.js";
import { createTestAgentExecutionScope } from "../../helpers/agent-execution-scope.js";
import { createPersistedCurrentUserMessage } from "./message-builder-current-user-fixture.js";

function findUserMetaMessage(messages) {
  return messages.find((message) => String(message?.content || "").startsWith("[用户元信息]"));
}

function parseUserMeta(content) {
  const text = String(content || "");
  const json = text.replace(/^\[用户元信息\]\n/, "").replace(/\n\[\/用户元信息\]$/, "");
  return JSON.parse(json);
}

function userAttachment(attachmentId, sessionId, metadata = {}) {
  return { attachmentId, sessionId, attachmentSource: "user", ...metadata };
}

test("buildContextMessages uses current runtime userMessageAttachments in user meta", () => {
  const messages = buildContextMessages(
    createTestAgentExecutionScope(
      {
        userId: "admin",
        userMessageAttachments: [
          userAttachment("att-a", "session-a", {
            name: "AI 体系现状概览.docx",
            mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            size: 1407731,
          }),
        ],
        attachments: [],
        systemRuntime: {
          sessionId: "session-a",
          dialogProcessId: "dialog-a",
          turnScopeId: "turn-a",
        },
      },
      { messageBlocks: { system: [], history: [] } },
    ),
    {
      currentUserMessage: createPersistedCurrentUserMessage("hello", {
        attachments: [
          userAttachment("att-a", "session-a", {
            name: "AI 体系现状概览.docx",
            mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            size: 1407731,
          }),
        ],
      }),
    },
  );

  const metaMessage = findUserMetaMessage(messages);
  assert.ok(metaMessage);
  const meta = parseUserMeta(metaMessage.content);
  assert.equal(meta.attachments.length, 1);
  assert.equal(meta.attachments[0].attachmentRef, "attachment:v1:session-a/user/att-a");
  assert.equal(meta.attachments[0].name, "AI 体系现状概览.docx");
});

test("buildContextMessages preserves explicit empty current userMessageAttachments", () => {
  const messages = buildContextMessages(
    createTestAgentExecutionScope(
      {
        userId: "admin",
        userMessageAttachments: [],
        systemRuntime: {
          sessionId: "session-a",
          dialogProcessId: "dialog-a",
          turnScopeId: "turn-a",
        },
      },
      { messageBlocks: { system: [], history: [] } },
    ),
    { currentUserMessage: createPersistedCurrentUserMessage("hello") },
  );

  const metaMessage = findUserMetaMessage(messages);
  assert.ok(metaMessage);
  const meta = parseUserMeta(metaMessage.content);
  assert.deepEqual(meta.attachments, []);
});

test("buildContextMessages does not treat runtime attachments bucket as current user attachments", () => {
  const messages = buildContextMessages(
    createTestAgentExecutionScope(
      {
        userId: "admin",
        userMessageAttachments: [],
        attachments: [{ attachmentId: "tool-output", name: "tool.txt", mimeType: "text/plain" }],
        systemRuntime: {
          sessionId: "session-a",
          dialogProcessId: "dialog-a",
          turnScopeId: "turn-a",
        },
      },
      { messageBlocks: { system: [], history: [] } },
    ),
    { currentUserMessage: createPersistedCurrentUserMessage("hello") },
  );

  const metaMessage = findUserMetaMessage(messages);
  assert.ok(metaMessage);
  const meta = parseUserMeta(metaMessage.content);
  assert.deepEqual(meta.attachments, []);
});

test("buildContextMessages uses only userMessageAttachments as current user attachment input", () => {
  const messages = buildContextMessages(
    createTestAgentExecutionScope(
      {
        userId: "admin",
        userMessageAttachments: [
          userAttachment("current-user-input", "session-a", {
            name: "current.docx",
            mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          }),
        ],
        attachments: [{ attachmentId: "tool-output", name: "tool.txt", mimeType: "text/plain" }],
        systemRuntime: {
          sessionId: "session-a",
          dialogProcessId: "dialog-a",
          turnScopeId: "turn-a",
        },
      },
      { messageBlocks: { system: [], history: [] } },
    ),
    {
      currentUserMessage: createPersistedCurrentUserMessage("hello", {
        attachments: [
          userAttachment("current-user-input", "session-a", {
            name: "current.docx",
            mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          }),
        ],
      }),
    },
  );

  const metaMessage = findUserMetaMessage(messages);
  assert.ok(metaMessage);
  const meta = parseUserMeta(metaMessage.content);
  assert.equal(meta.attachments.length, 1);
  assert.equal(
    meta.attachments[0].attachmentRef,
    "attachment:v1:session-a/user/current-user-input",
  );
});

test("buildContextMessages does not use fallback meta attachments as current user attachments", () => {
  const messages = buildContextMessages(
    createTestAgentExecutionScope(
      {
        userId: "admin",
        userMessageAttachments: [],
        attachments: [{ attachmentId: "tool-output", name: "tool.txt", mimeType: "text/plain" }],
        systemRuntime: {
          sessionId: "session-a",
          dialogProcessId: "dialog-a",
          turnScopeId: "turn-a",
        },
      },
      {
        messageBlocks: {
          system: [],
          history: [
            {
              role: "user",
              content: "history with stale attachments",
              attachments: [
                {
                  attachmentId: "stale-history-attachment",
                  name: "stale.txt",
                  mimeType: "text/plain",
                },
              ],
            },
          ],
        },
      },
    ),
    { currentUserMessage: createPersistedCurrentUserMessage("hello") },
  );

  const metaMessage = findUserMetaMessage(messages);
  assert.ok(metaMessage);
  const meta = parseUserMeta(metaMessage.content);
  assert.deepEqual(meta.attachments, []);
});

test("buildContextMessages projects only model attachment metadata", () => {
  const richAttachment = {
    attachmentId: "att-rich",
    name: "AI 体系现状概览.docx",
    mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    attachmentSource: "user",
    sessionId: "session-rich",
    path: "/workspace/admin/runtime/attach/scoped/session-rich/user/att-rich/AI 体系现状概览.docx",
    relativePath: "runtime/attach/scoped/session-rich/user/att-rich/AI 体系现状概览.docx",
    sandboxPath:
      "/workspace/admin/runtime/attach/scoped/session-rich/user/att-rich/AI 体系现状概览.docx",
    previewUrl: "/preview/att-rich",
    downloadUrl: "/download/att-rich",
    transferFilePath: "runtime/attach/scoped/session-rich/user/att-rich/AI 体系现状概览.docx",
    size: 1407731,
  };
  const messages = buildContextMessages(
    createTestAgentExecutionScope(
      {
        userId: "admin",
        userMessageAttachments: [richAttachment],
        systemRuntime: {
          sessionId: "session-rich",
          dialogProcessId: "dialog-rich",
        },
      },
      { messageBlocks: { system: [], history: [] } },
    ),
    {
      currentUserMessage: createPersistedCurrentUserMessage("hello", {
        userName: "admin",
        sessionId: "session-rich",
        dialogProcessId: "dialog-rich",
        attachments: [richAttachment],
      }),
    },
  );

  const metaMessage = findUserMetaMessage(messages);
  assert.ok(metaMessage);
  const meta = parseUserMeta(metaMessage.content);
  assert.equal(meta.attachments.length, 1);
  const attachment = meta.attachments[0];
  assert.deepEqual(attachment, {
    attachmentRef: "attachment:v1:session-rich/user/att-rich",
    name: "AI 体系现状概览.docx",
    mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    size: 1407731,
  });
});

test("buildContextMessages does not copy current-turn attachments into historical user metadata", () => {
  const fallbackMeta = {
    userName: "admin",
    sessionId: "session-a",
    turnScopeId: "turn-latest",
    userMessageAttachments: [
      userAttachment("latest-only", "session-a", {
        name: "latest.docx",
        mimeType: "application/docx",
      }),
    ],
  };
  const attachmentFreeHistory = buildHumanMessagesForUser(
    {},
    { role: "user", content: "first", turnScopeId: "turn-1", attachments: [] },
    fallbackMeta,
    { allowFallbackAttachments: false },
  );
  const attachedHistory = buildHumanMessagesForUser(
    {},
    {
      role: "user",
      content: "historical attachment",
      turnScopeId: "turn-2",
      attachments: [
        userAttachment("history-only", "session-a", {
          name: "history.txt",
          mimeType: "text/plain",
        }),
      ],
    },
    fallbackMeta,
    { allowFallbackAttachments: false },
  );

  const emptyMeta = parseUserMeta(attachmentFreeHistory[1].content);
  const historyMeta = parseUserMeta(attachedHistory[1].content);
  assert.deepEqual(emptyMeta.attachments, []);
  assert.deepEqual(
    historyMeta.attachments.map((item) => item.attachmentRef),
    ["attachment:v1:session-a/user/history-only"],
  );
  assert.notStrictEqual(emptyMeta.attachments, historyMeta.attachments);
});

test("buildContextMessages keeps complete metadata per historical user turn without current-turn fallback", () => {
  const messages = buildContextMessages(
    createTestAgentExecutionScope(
      {
        userId: "current-admin",
        userMessageAttachments: [
          userAttachment("latest-only", "current-session", {
            name: "latest.docx",
            mimeType: "application/docx",
          }),
        ],
        systemRuntime: {
          sessionId: "current-session",
          dialogProcessId: "current-dialog",
          turnScopeId: "current-turn",
        },
      },
      {
        messageBlocks: {
          system: [],
          history: [
            {
              role: "user",
              content: "first historical turn",
              frontendUserMessage: true,
              userName: "historical-admin",
              sessionId: "historical-session",
              parentSessionId: "historical-parent-session",
              dialogProcessId: "historical-dialog",
              parentDialogProcessId: "historical-parent-dialog",
              turnScopeId: "historical-turn",
              attachments: [],
            },
            {
              role: "assistant",
              content: "first historical answer",
              dialogProcessId: "historical-dialog",
              turnScopeId: "historical-turn",
            },
            {
              role: "user",
              content: "legacy history missing identity",
              frontendUserMessage: true,
              dialogProcessId: "legacy-dialog",
              turnScopeId: "legacy-turn",
              attachments: [],
            },
            {
              role: "assistant",
              content: "legacy historical answer",
              dialogProcessId: "legacy-dialog",
              turnScopeId: "legacy-turn",
            },
          ],
        },
      },
    ),
    {
      currentUserMessage: createPersistedCurrentUserMessage("current turn", {
        userName: "current-admin",
        sessionId: "current-session",
        dialogProcessId: "current-dialog",
        turnScopeId: "current-turn",
        attachments: [
          userAttachment("latest-only", "current-session", {
            name: "latest.docx",
            mimeType: "application/docx",
          }),
        ],
      }),
    },
  );

  const metas = messages
    .filter((message) => String(message?.content || "").startsWith("[用户元信息]"))
    .map((message) => parseUserMeta(message.content));

  assert.equal(metas.length, 3);
  assert.deepEqual(metas[0], {
    userName: "historical-admin",
    sessionId: "historical-session",
    parentSessionId: "historical-parent-session",
    dialogProcessId: "historical-dialog",
    parentDialogProcessId: "historical-parent-dialog",
    turnScopeId: "historical-turn",
    attachments: [],
  });
  assert.deepEqual(metas[1], {
    userName: "",
    sessionId: "",
    parentSessionId: "",
    dialogProcessId: "legacy-dialog",
    parentDialogProcessId: "",
    turnScopeId: "legacy-turn",
    attachments: [],
  });
  assert.equal(metas[2].userName, "current-admin");
  assert.equal(metas[2].sessionId, "current-session");
  assert.equal(metas[2].dialogProcessId, "current-dialog");
  assert.equal(metas[2].turnScopeId, "current-turn");
  assert.deepEqual(
    metas[2].attachments.map((item) => item.attachmentRef),
    ["attachment:v1:current-session/user/latest-only"],
  );
});

test("buildContextMessages rebuilds metadata beside every legacy stopped/resend user turn", () => {
  const history = [
    {
      role: "user",
      content: "你好",
      dialogProcessId: "dialog-1",
      turnScopeId: "turn-1",
      attachments: [],
    },
    { role: "assistant", content: "answer-1", dialogProcessId: "dialog-1", turnScopeId: "turn-1" },
    {
      role: "user",
      content: "你好",
      dialogProcessId: "dialog-2",
      turnScopeId: "turn-2",
      attachments: [],
    },
    { role: "assistant", content: "answer-2", dialogProcessId: "dialog-2", turnScopeId: "turn-2" },
    {
      role: "user",
      content: "你好",
      dialogProcessId: "dialog-3",
      turnScopeId: "turn-3",
      attachments: [
        userAttachment("last-turn-only", "current-session", {
          name: "last.docx",
          mimeType: "application/docx",
        }),
      ],
    },
  ];
  const messages = buildContextMessages(
    createTestAgentExecutionScope(
      {
        userId: "current-admin",
        userMessageAttachments: [],
        systemRuntime: {
          sessionId: "current-session",
          dialogProcessId: "dialog-current",
          turnScopeId: "turn-current",
        },
      },
      { messageBlocks: { system: [], history } },
    ),
    { currentUserMessage: createPersistedCurrentUserMessage("current") },
  );

  const historicalBodies = messages.filter(
    (message) => message?.content === "你好" && message?._getType?.() === "human",
  );
  assert.equal(historicalBodies.length, 3);
  for (const body of historicalBodies) {
    const bodyIndex = messages.indexOf(body);
    const metaMessage = messages[bodyIndex + 1];
    assert.equal(String(metaMessage?.content || "").startsWith("[用户元信息]"), true);
  }

  const historicalMetas = historicalBodies.map((body) => {
    const bodyIndex = messages.indexOf(body);
    return parseUserMeta(messages[bodyIndex + 1].content);
  });
  assert.deepEqual(
    historicalMetas.map(({ dialogProcessId, turnScopeId }) => ({ dialogProcessId, turnScopeId })),
    [
      { dialogProcessId: "dialog-1", turnScopeId: "turn-1" },
      { dialogProcessId: "dialog-2", turnScopeId: "turn-2" },
      { dialogProcessId: "dialog-3", turnScopeId: "turn-3" },
    ],
  );
  assert.deepEqual(
    historicalMetas.map((meta) => meta.attachments.map((item) => item.attachmentRef)),
    [[], [], ["attachment:v1:current-session/user/last-turn-only"]],
  );
});

test("buildContextMessages discards classified user_meta without inferring from user text", () => {
  const messages = buildContextMessages(
    createTestAgentExecutionScope(
      {
        resumeFromStoppedSnapshot: true,
        userId: "admin",
        userMessageAttachments: [],
        systemRuntime: {
          sessionId: "s1",
          dialogProcessId: "dialog-current",
          turnScopeId: "turn-current",
        },
      },
      {
        messageBlocks: {
          system: [],
          history: [
            {
              role: "user",
              content: "hello",
              frontendUserMessage: true,
              dialogProcessId: "dialog-current",
              turnScopeId: "turn-current",
            },
            {
              role: "user",
              content: '[用户元信息]\n{"dialogProcessId":"dialog-current"}\n[/用户元信息]',
              additional_kwargs: { noobotInternalMessageType: "user_meta" },
            },
            {
              role: "user",
              content: "[用户元信息]\n{}\n[/用户元信息]",
            },
          ],
        },
      },
    ),
    { currentUserMessage: null },
  );

  assert.equal(messages.filter((message) => message?.content === "hello").length, 1);
  assert.equal(
    messages.filter((message) => String(message?.content || "").startsWith("[用户元信息]")).length,
    2,
  );
  assert.equal(
    messages.filter((message) => message?.content === "[用户元信息]\n{}\n[/用户元信息]").length,
    1,
  );
});

test("buildContextMessages ignores derived metadata and uses stopped source facts", () => {
  const messages = buildContextMessages(
    createTestAgentExecutionScope(
      {
        resumeFromStoppedSnapshot: true,
        userId: "admin",
        userMessageAttachments: [userAttachment("attachment-b", "s1", { name: "continue.docx" })],
        systemRuntime: {
          sessionId: "s1",
          dialogProcessId: "dialog-continue",
          turnScopeId: "turn-continue",
        },
      },
      {
        messageBlocks: {
          system: [],
          history: [
            {
              type: "human",
              content: "parse attachment",
              userName: "admin",
              sessionId: "s1",
              parentSessionId: "parent-1",
              parentDialogProcessId: "parent-dialog-1",
              turnScopeId: "turn-stopped",
              attachments: [userAttachment("attachment-a", "s1", { name: "stopped.docx" })],
              additional_kwargs: {
                dialogProcessId: "dialog-stopped",
                turnScopeId: "turn-stopped",
                frontendUserMessage: true,
              },
            },
            {
              type: "human",
              content:
                '[用户元信息]\n{"userName":"wrong","attachments":[{"attachmentRef":"attachment:v1:wrong/user/wrong"}]}\n[/用户元信息]',
              additional_kwargs: {
                dialogProcessId: "dialog-stopped",
                turnScopeId: "turn-stopped",
                noobotInternalMessageType: "user_meta",
              },
            },
          ],
        },
      },
    ),
    {
      currentUserMessage: createPersistedCurrentUserMessage("continue", {
        userName: "admin",
        sessionId: "s1",
        dialogProcessId: "dialog-continue",
        turnScopeId: "turn-continue",
        attachments: [userAttachment("attachment-b", "s1", { name: "continue.docx" })],
      }),
    },
  );

  const bodies = messages.filter((message) =>
    ["parse attachment", "continue"].includes(String(message?.content || "")),
  );
  assert.equal(bodies.length, 2);
  const metas = bodies.map((body) => parseUserMeta(messages[messages.indexOf(body) + 1].content));
  assert.deepEqual(
    metas.map(
      ({
        userName,
        sessionId,
        parentSessionId,
        dialogProcessId,
        parentDialogProcessId,
        turnScopeId,
        attachments,
      }) => ({
        userName,
        sessionId,
        parentSessionId,
        dialogProcessId,
        parentDialogProcessId,
        turnScopeId,
        attachmentRefs: attachments.map((attachment) => attachment.attachmentRef),
      }),
    ),
    [
      {
        userName: "admin",
        sessionId: "s1",
        parentSessionId: "parent-1",
        dialogProcessId: "dialog-stopped",
        parentDialogProcessId: "parent-dialog-1",
        turnScopeId: "turn-stopped",
        attachmentRefs: ["attachment:v1:s1/user/attachment-a"],
      },
      {
        userName: "admin",
        sessionId: "s1",
        parentSessionId: "",
        dialogProcessId: "dialog-continue",
        parentDialogProcessId: "",
        turnScopeId: "turn-continue",
        attachmentRefs: ["attachment:v1:s1/user/attachment-b"],
      },
    ],
  );
  assert.equal(
    messages.filter((message) => String(message?.content || "").startsWith("[用户元信息]")).length,
    2,
  );
});

test("buildContextMessages does not project frontend user metadata for internal prompts", () => {
  const messages = buildContextMessages(
    createTestAgentExecutionScope(
      {
        userId: "admin",
        userMessageAttachments: [],
        systemRuntime: { sessionId: "child", dialogProcessId: "dialog-child" },
      },
      {
        messageBlocks: {
          system: [],
          history: [
            {
              role: "user",
              content: "internal task",
              messageOrigin: "internal",
              dialogProcessId: "dialog-previous-child",
              turnScopeId: "internal-turn:1",
            },
          ],
        },
      },
    ),
  );
  assert.equal(
    messages.some((message) => message?.content === "internal task"),
    true,
  );
  assert.equal(
    messages.some((message) => String(message?.content || "").startsWith("[用户元信息]")),
    false,
  );

  const currentMessages = buildContextMessages(
    createTestAgentExecutionScope(
      {
        userId: "admin",
        userMessageAttachments: [],
        systemRuntime: { sessionId: "child", dialogProcessId: "dialog-child", caller: "bot" },
      },
      { messageBlocks: { system: [], history: [] } },
    ),
    {
      currentUserMessage: createPersistedCurrentUserMessage("current internal task", {
        userName: "admin",
        sessionId: "child",
        dialogProcessId: "dialog-child",
        turnScopeId: "internal-turn:current",
        frontendUserMessage: false,
        messageOrigin: "internal",
      }),
    },
  );
  assert.equal(
    currentMessages.some((message) => message?.content === "current internal task"),
    true,
  );
  assert.equal(
    currentMessages.some((message) => String(message?.content || "").startsWith("[用户元信息]")),
    false,
  );
});
