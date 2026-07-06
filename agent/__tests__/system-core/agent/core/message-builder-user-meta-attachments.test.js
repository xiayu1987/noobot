import test from "node:test";
import assert from "node:assert/strict";

import { buildContextMessages } from "../../../../src/system-core/agent/core/context/message-builder.js";

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
            inputAttachments: [],
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
            inputAttachments: [
              { attachmentId: "old", name: "old.docx", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" },
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
