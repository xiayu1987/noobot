import test from "node:test";
import assert from "node:assert/strict";

import {
  buildContextMessages,
  buildHumanMessagesForUser,
} from "../../../../src/system-core/agent/core/context/message-builder.js";

function findUserMetaMessage(messages) {
  return messages.find((message) => String(message?.content || "").startsWith("[用户元信息]"));
}

function parseUserMeta(content) {
  const text = String(content || "");
  const json = text.replace(/^\[用户元信息\]\n/, "").replace(/\n\[\/用户元信息\]$/, "");
  return JSON.parse(json);
}

test("buildContextMessages uses current runtime userMessageAttachments in user meta", () => {
  const messages = buildContextMessages(
    {
      execution: {
        controllers: {
          runtime: {
            userId: "admin",
            userMessageAttachments: [
              {
                attachmentId: "att-a",
                name: "AI 体系现状概览.docx",
                mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                size: 1407731,
              },
            ],
            attachments: [],
            systemRuntime: {
              sessionId: "session-a",
              dialogProcessId: "dialog-a",
              turnScopeId: "turn-a",
            },
          },
        },
      },
      payload: { messages: { system: [], history: [] } },
    },
    { currentUserMessage: "hello" },
  );

  const metaMessage = findUserMetaMessage(messages);
  assert.ok(metaMessage);
  const meta = parseUserMeta(metaMessage.content);
  assert.equal(meta.attachments.length, 1);
  assert.equal(meta.attachments[0].attachmentId, "att-a");
  assert.equal(meta.attachments[0].name, "AI 体系现状概览.docx");
});

test("buildContextMessages preserves explicit empty current userMessageAttachments", () => {
  const messages = buildContextMessages(
    {
      execution: {
        controllers: {
          runtime: {
            userId: "admin",
            userMessageAttachments: [],
            systemRuntime: {
              sessionId: "session-a",
              dialogProcessId: "dialog-a",
              turnScopeId: "turn-a",
            },
          },
        },
      },
      payload: { messages: { system: [], history: [] } },
    },
    { currentUserMessage: "hello" },
  );

  const metaMessage = findUserMetaMessage(messages);
  assert.ok(metaMessage);
  const meta = parseUserMeta(metaMessage.content);
  assert.deepEqual(meta.attachments, []);
});

test("buildContextMessages does not treat runtime attachments bucket as current user attachments", () => {
  const messages = buildContextMessages(
    {
      execution: {
        controllers: {
          runtime: {
            userId: "admin",
            userMessageAttachments: [],
            attachments: [
              { attachmentId: "tool-output", name: "tool.txt", mimeType: "text/plain" },
            ],
            systemRuntime: {
              sessionId: "session-a",
              dialogProcessId: "dialog-a",
              turnScopeId: "turn-a",
            },
          },
        },
      },
      payload: { messages: { system: [], history: [] } },
    },
    { currentUserMessage: "hello" },
  );

  const metaMessage = findUserMetaMessage(messages);
  assert.ok(metaMessage);
  const meta = parseUserMeta(metaMessage.content);
  assert.deepEqual(meta.attachments, []);
});

test("buildContextMessages uses only userMessageAttachments as current user attachment input", () => {
  const messages = buildContextMessages(
    {
      execution: {
        controllers: {
          runtime: {
            userId: "admin",
            userMessageAttachments: [
              { attachmentId: "current-user-input", name: "current.docx", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" },
            ],
            attachments: [
              { attachmentId: "tool-output", name: "tool.txt", mimeType: "text/plain" },
            ],
            systemRuntime: {
              sessionId: "session-a",
              dialogProcessId: "dialog-a",
              turnScopeId: "turn-a",
            },
          },
        },
      },
      payload: { messages: { system: [], history: [] } },
    },
    { currentUserMessage: "hello" },
  );

  const metaMessage = findUserMetaMessage(messages);
  assert.ok(metaMessage);
  const meta = parseUserMeta(metaMessage.content);
  assert.equal(meta.attachments.length, 1);
  assert.equal(meta.attachments[0].attachmentId, "current-user-input");
});

test("buildContextMessages does not use fallback meta attachments as current user attachments", () => {
  const messages = buildContextMessages(
    {
      execution: {
        controllers: {
          runtime: {
            userId: "admin",
            userMessageAttachments: [],
            attachments: [
              { attachmentId: "tool-output", name: "tool.txt", mimeType: "text/plain" },
            ],
            systemRuntime: {
              sessionId: "session-a",
              dialogProcessId: "dialog-a",
              turnScopeId: "turn-a",
            },
          },
        },
      },
      payload: {
        messages: {
          system: [],
          history: [
            {
              role: "user",
              content: "history with stale attachments",
              attachments: [
                { attachmentId: "stale-history-attachment", name: "stale.txt", mimeType: "text/plain" },
              ],
            },
          ],
        },
      },
    },
    { currentUserMessage: "hello" },
  );

  const metaMessage = findUserMetaMessage(messages);
  assert.ok(metaMessage);
  const meta = parseUserMeta(metaMessage.content);
  assert.deepEqual(meta.attachments, []);
});

test("buildContextMessages preserves rich attachment fields in user meta", () => {
  const messages = buildContextMessages(
    {
      execution: {
        controllers: {
          runtime: {
            userId: "admin",
            userMessageAttachments: [
              {
                attachmentId: "att-rich",
                name: "AI 体系现状概览.docx",
                mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                attachmentSource: "user",
                sessionId: "session-rich",
                path: "/workspace/admin/runtime/attach/scoped/session-rich/user/att-rich/AI 体系现状概览.docx",
                relativePath: "runtime/attach/scoped/session-rich/user/att-rich/AI 体系现状概览.docx",
                sandboxPath: "/workspace/admin/runtime/attach/scoped/session-rich/user/att-rich/AI 体系现状概览.docx",
                previewUrl: "/preview/att-rich",
                downloadUrl: "/download/att-rich",
                parsedResultUrl: "/download/parsed-rich",
                parsedResultName: "AI 体系现状概览.txt",
                parsedResultAttachmentId: "parsed-rich",
                transferFilePath: "runtime/attach/scoped/session-rich/user/att-rich/AI 体系现状概览.docx",
                size: 1407731,
                parsedResult: {
                  attachmentId: "parsed-rich",
                  path: "/workspace/admin/runtime/attach/scoped/session-rich/user/parsed-rich/AI 体系现状概览.txt",
                  relativePath: "runtime/attach/scoped/session-rich/user/parsed-rich/AI 体系现状概览.txt",
                },
              },
            ],
            systemRuntime: {
              sessionId: "session-rich",
              dialogProcessId: "dialog-rich",
            },
          },
        },
      },
      payload: { messages: { system: [], history: [] } },
    },
    { currentUserMessage: "hello" },
  );

  const metaMessage = findUserMetaMessage(messages);
  assert.ok(metaMessage);
  const meta = parseUserMeta(metaMessage.content);
  assert.equal(meta.attachments.length, 1);
  const attachment = meta.attachments[0];
  assert.equal(attachment.attachmentId, "att-rich");
  assert.equal(attachment.sessionId, "session-rich");
  assert.equal(attachment.path.includes("att-rich"), true);
  assert.equal(attachment.relativePath.includes("att-rich"), true);
  assert.equal(attachment.sandboxPath.includes("att-rich"), true);
  assert.equal(attachment.previewUrl, "/preview/att-rich");
  assert.equal(attachment.downloadUrl, "/download/att-rich");
  assert.equal(attachment.parsedResultUrl, "/download/parsed-rich");
  assert.equal(attachment.parsedResultName, "AI 体系现状概览.txt");
  assert.equal(attachment.parsedResultAttachmentId, "parsed-rich");
  assert.equal(attachment.transferFilePath.includes("att-rich"), true);
  assert.equal(attachment.parsedResult.attachmentId, "parsed-rich");
});

test("buildContextMessages does not copy current-turn attachments into historical user metadata", () => {
  const fallbackMeta = {
    userName: "admin",
    sessionId: "session-a",
    turnScopeId: "turn-latest",
    userMessageAttachments: [
      { attachmentId: "latest-only", name: "latest.docx", mimeType: "application/docx" },
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
        { attachmentId: "history-only", name: "history.txt", mimeType: "text/plain" },
      ],
    },
    fallbackMeta,
    { allowFallbackAttachments: false },
  );

  const emptyMeta = parseUserMeta(attachmentFreeHistory[1].content);
  const historyMeta = parseUserMeta(attachedHistory[1].content);
  assert.deepEqual(emptyMeta.attachments, []);
  assert.deepEqual(historyMeta.attachments.map((item) => item.attachmentId), ["history-only"]);
  assert.notStrictEqual(emptyMeta.attachments, historyMeta.attachments);
});

test("buildContextMessages keeps complete metadata per historical user turn without current-turn fallback", () => {
  const messages = buildContextMessages(
    {
      execution: {
        controllers: {
          runtime: {
            userId: "current-admin",
            userMessageAttachments: [
              { attachmentId: "latest-only", name: "latest.docx", mimeType: "application/docx" },
            ],
            systemRuntime: {
              sessionId: "current-session",
              dialogProcessId: "current-dialog",
              turnScopeId: "current-turn",
            },
          },
        },
      },
      payload: {
        messages: {
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
    },
    { currentUserMessage: "current turn" },
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
  assert.deepEqual(metas[2].attachments.map((item) => item.attachmentId), ["latest-only"]);
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
        { attachmentId: "last-turn-only", name: "last.docx", mimeType: "application/docx" },
      ],
    },
  ];
  const messages = buildContextMessages(
    {
      execution: {
        controllers: {
          runtime: {
            userId: "current-admin",
            userMessageAttachments: [],
            systemRuntime: {
              sessionId: "current-session",
              dialogProcessId: "dialog-current",
              turnScopeId: "turn-current",
            },
          },
        },
      },
      payload: { messages: { system: [], history } },
    },
    { currentUserMessage: "current" },
  );

  // LangChain HumanMessage instances expose their type through _getType(),
  // rather than a persisted `role` property.
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
  assert.deepEqual(historicalMetas.map((meta) => meta.attachments.map((item) => item.attachmentId)), [
    [],
    [],
    ["last-turn-only"],
  ]);
});

test("buildContextMessages discards restored user_meta projections before rebuilding", () => {
  const messages = buildContextMessages(
    {
      execution: {
        controllers: {
          runtime: {
            resumeFromStoppedSnapshot: true,
            userId: "admin",
            userMessageAttachments: [],
            systemRuntime: {
              sessionId: "s1",
              dialogProcessId: "dialog-current",
              turnScopeId: "turn-current",
            },
          },
        },
      },
      payload: {
        messages: {
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
                  content: '[用户元信息]\n{}\n[/用户元信息]',
                },
          ],
        },
      },
    },
    { currentUserMessage: "" },
  );

  assert.equal(messages.filter((message) => message?.content === "hello").length, 1);
  assert.equal(
    messages.filter((message) => String(message?.content || "").startsWith("[用户元信息]")).length,
    1,
  );
});

test("buildContextMessages restores stopped source attachments by exact turn identity", () => {
  const messages = buildContextMessages(
    {
      execution: {
        controllers: {
          runtime: {
            resumeFromStoppedSnapshot: true,
            userId: "admin",
            userMessageAttachments: [{ attachmentId: "attachment-b", name: "continue.docx" }],
            systemRuntime: {
              sessionId: "s1",
              dialogProcessId: "dialog-continue",
              turnScopeId: "turn-continue",
            },
          },
        },
      },
      payload: {
        messages: {
          system: [],
          history: [
                {
                  type: "human",
                  content: "parse attachment",
                  additional_kwargs: {
                    dialogProcessId: "dialog-stopped",
                    turnScopeId: "turn-stopped",
                    frontendUserMessage: true,
                  },
                },
                {
                  type: "human",
                  content: '[用户元信息]\n{"userName":"admin","sessionId":"s1","parentSessionId":"parent-1","dialogProcessId":"dialog-stopped","parentDialogProcessId":"parent-dialog-1","turnScopeId":"turn-stopped","attachments":[{"attachmentId":"attachment-a","name":"stopped.docx"}]}\n[/用户元信息]',
                  additional_kwargs: {
                    dialogProcessId: "dialog-stopped",
                    turnScopeId: "turn-stopped",
                    noobotInternalMessageType: "user_meta",
                  },
                },
          ],
        },
      },
    },
    { currentUserMessage: "continue" },
  );

  const bodies = messages.filter((message) =>
    ["parse attachment", "continue"].includes(String(message?.content || "")),
  );
  assert.equal(bodies.length, 2);
  const metas = bodies.map((body) => parseUserMeta(messages[messages.indexOf(body) + 1].content));
  assert.deepEqual(
    metas.map(({ userName, sessionId, parentSessionId, dialogProcessId, parentDialogProcessId, turnScopeId, attachments }) => ({
      userName,
      sessionId,
      parentSessionId,
      dialogProcessId,
      parentDialogProcessId,
      turnScopeId,
      attachmentIds: attachments.map((attachment) => attachment.attachmentId),
    })),
    [
      {
        userName: "admin",
        sessionId: "s1",
        parentSessionId: "parent-1",
        dialogProcessId: "dialog-stopped",
        parentDialogProcessId: "parent-dialog-1",
        turnScopeId: "turn-stopped",
        attachmentIds: ["attachment-a"],
      },
      {
        userName: "admin",
        sessionId: "s1",
        parentSessionId: "",
        dialogProcessId: "dialog-continue",
        parentDialogProcessId: "",
        turnScopeId: "turn-continue",
        attachmentIds: ["attachment-b"],
      },
    ],
  );
  assert.equal(
    messages.filter((message) => String(message?.content || "").startsWith("[用户元信息]")).length,
    2,
  );
});

test("buildContextMessages does not project frontend user metadata for internal prompts", () => {
  const messages = buildContextMessages({
    execution: {
      controllers: {
        runtime: {
          userId: "admin",
          userMessageAttachments: [],
          systemRuntime: { sessionId: "child", dialogProcessId: "dialog-child" },
        },
      },
    },
    payload: {
      messages: {
        system: [],
        history: [{
          role: "user",
          content: "internal task",
          messageOrigin: "internal",
          dialogProcessId: "dialog-previous-child",
          turnScopeId: "internal-turn:1",
        }],
      },
    },
  });
  assert.equal(messages.some((message) => message?.content === "internal task"), true);
  assert.equal(
    messages.some((message) => String(message?.content || "").startsWith("[用户元信息]")),
    false,
  );

  const currentMessages = buildContextMessages(
    {
      execution: {
        controllers: {
          runtime: {
            userId: "admin",
            userMessageAttachments: [],
            systemRuntime: { sessionId: "child", dialogProcessId: "dialog-child", caller: "bot" },
          },
        },
      },
      payload: { messages: { system: [], history: [] } },
    },
    { currentUserMessage: "current internal task" },
  );
  assert.equal(currentMessages.some((message) => message?.content === "current internal task"), true);
  assert.equal(
    currentMessages.some((message) => String(message?.content || "").startsWith("[用户元信息]")),
    false,
  );
});
