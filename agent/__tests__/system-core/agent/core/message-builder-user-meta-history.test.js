/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";

import {
  buildContextMessages,
  buildContextMessageBlocks,
} from "../../../../src/system-core/agent/core/context/message-builder.js";
import { MAIN_MODEL_HISTORY_ROUND_LIMIT } from "../../../../src/system-core/session/utils/context-window-normalizer.js";

test("buildContextMessageBlocks builds user_meta with source info for historical user attachments", () => {
  const blocks = buildContextMessageBlocks({
    execution: {
      controllers: {
        runtime: {
          userId: "u1",
          systemRuntime: {
            sessionId: "s1",
            dialogProcessId: "dlg-current",
            turnScopeId: "client-turn:current",
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
            content: "历史附件问题",
            dialogProcessId: "dlg-history",
            turnScopeId: "client-turn:history",
            attachments: [
              {
                attachmentId: "att-history-1",
                name: "history.md",
                mimeType: "text/markdown",
                attachmentSource: "user",
                sessionId: "s-history",
                relativePath: "runtime/attach/scoped/s-history/user/att-history-1.md",
                sandboxPath: "/workspace/primary-user/runtime/attach/scoped/s-history/user/att-history-1.md",
                size: 42,
                isSandbox: true,
              },
            ],
          },
          {
            role: "assistant",
            content: "历史回答",
            dialogProcessId: "dlg-history",
            turnScopeId: "client-turn:history",
          },
        ],
      },
    },
  });

  assert.equal(blocks.history.length, 3);
  assert.equal(blocks.history[0]?.content, "历史附件问题");
  assert.equal(blocks.history[1]?.additional_kwargs?.noobotInternalMessageType, "user_meta");
  assert.equal(blocks.history[2]?.content, "历史回答");

  const metaContent = blocks.history[1]?.content || "";
  const metaPayload = JSON.parse(metaContent.match(/\n([\s\S]*)\n\[\//)?.[1] || "{}");
  assert.deepEqual(metaPayload.attachments, [
    {
      attachmentId: "att-history-1",
      name: "history.md",
      mimeType: "text/markdown",
      attachmentSource: "user",
      sessionId: "s-history",
      path: "",
      relativePath: "runtime/attach/scoped/s-history/user/att-history-1.md",
      sandboxPath: "/workspace/primary-user/runtime/attach/scoped/s-history/user/att-history-1.md",
      downloadUrl: "",
      previewUrl: "",
      parsedResultUrl: "",
      parsedResultName: "",
      parsedResultAttachmentId: "",
      transferFilePath: "",
      size: 42,
      isSandbox: true,
    },
  ]);
});

test("buildContextMessageBlocks does not infer frontend user metadata from round identity", () => {
  const blocks = buildContextMessageBlocks({
    execution: { controllers: { runtime: { userId: "u1", systemRuntime: { sessionId: "s1" } } } },
    payload: {
      messages: {
        system: [],
        history: [
          { role: "user", content: "无附件历史", dialogProcessId: "dlg-plain" },
          { role: "assistant", content: "普通回答", dialogProcessId: "dlg-plain" },
        ],
      },
    },
  });

  assert.equal(blocks.history.length, 2);
  assert.equal(blocks.history[0]?.content, "无附件历史");
  assert.equal(blocks.history[0]?.additional_kwargs?.noobotInternalMessageType, undefined);
  assert.equal(blocks.history[1]?.content, "普通回答");
});

test("buildContextMessageBlocks keeps previous history rounds with same user text", () => {
  const blocks = buildContextMessageBlocks(
    {
      execution: {
        controllers: {
          runtime: {
            userId: "u1",
            systemRuntime: {
              sessionId: "s1",
              dialogProcessId: "dlg-current",
              turnScopeId: "client-turn:current",
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
              content: "全仓回归测试",
              dialogProcessId: "dlg-old-same-text",
              turnScopeId: "client-turn:old-same-text",
            },
            {
              role: "assistant",
              content: "旧同文本回答",
              dialogProcessId: "dlg-old-same-text",
              turnScopeId: "client-turn:old-same-text",
            },
            {
              role: "user",
              content: "项目中 不光工作流插件  其他 的 dialogId  都收敛完了吗",
              dialogProcessId: "dlg-old-other",
              turnScopeId: "client-turn:old-other",
            },
            {
              role: "assistant",
              content: "旧不同文本回答",
              dialogProcessId: "dlg-old-other",
              turnScopeId: "client-turn:old-other",
            },
          ],
        },
      },
    },
    { currentUserMessage: "全仓回归测试" },
  );

  const visibleContents = blocks.messages
    .map((message) => message?.content)
    .filter((content) => typeof content === "string");

  assert.equal(
    visibleContents.filter((content) => content === "全仓回归测试").length,
    2,
  );
  assert.equal(visibleContents.includes("旧同文本回答"), true);
  assert.equal(visibleContents.includes("旧不同文本回答"), true);
});

test("buildContextMessageBlocks keeps latest repeated next-step dialog rounds", () => {
  const history = [];
  for (const id of ["dlg_1", "dlg_2", "dlg_3", "dlg_4", "dlg_5"]) {
    history.push({
      role: "user",
      content: "下一步",
      dialogProcessId: id,
      turnScopeId: `turn:${id}`,
    });
    history.push({
      role: "assistant",
      content: `${id} answer`,
      dialogProcessId: id,
      turnScopeId: `turn:${id}`,
    });
  }

  const blocks = buildContextMessageBlocks(
    {
      execution: {
        controllers: {
          runtime: {
            userId: "u1",
            systemRuntime: {
              sessionId: "s1",
              dialogProcessId: "dlg_current",
              turnScopeId: "turn:current",
            },
          },
        },
      },
      payload: {
        messages: {
          system: [],
          history,
        },
      },
    },
    { currentUserMessage: "下一步" },
  );

  const visibleContents = blocks.messages
    .map((message) => message?.content)
    .filter((content) => typeof content === "string");

  assert.equal(visibleContents.filter((content) => content === "下一步").length, 6);
  for (const id of ["dlg_1", "dlg_2", "dlg_3", "dlg_4", "dlg_5"]) {
    assert.equal(visibleContents.includes(`${id} answer`), true, id);
  }
});
