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
} from "../../../src/context/assembly/message-builder.js";
import { TURN_THRESHOLDS } from "@noobot/shared/turn-thresholds";

const MAIN_MODEL_HISTORY_ROUND_LIMIT = TURN_THRESHOLDS.session.mainModelHistoryRoundLimit;
import { createModelContext } from "@noobot/context-protocol/assembly/hook-context";
import { projectSessionRecordsToContextMessages as toConversationMessages } from "@noobot/context-protocol/message/session-projection";
import { createPersistedCurrentUserMessage } from "./message-builder-current-user-fixture.js";
import { projectTerminalHistoryMessages } from "@noobot/context-protocol/policy/terminal-history";

function buildAgentContext({
  userId = "u1",
  sessionId = "s1",
  dialogProcessId = "dlg-current",
  turnScopeId = "turn-current",
  messages = {},
} = {}) {
  return {
    context: {
      kind: "noobot.agent-context",
      protocolVersion: 1,
      identity: {
        sessionId,
        parentSessionId: "",
        dialogProcessId,
        parentDialogProcessId: "",
        turnScopeId,
        messageId: `message:${turnScopeId}`,
      },
      modelContext: createModelContext({
        messageBlocks: {
          system: Array.isArray(messages.system) ? messages.system : [],
          history: Array.isArray(messages.history) ? messages.history : [],
          incremental: Array.isArray(messages.incremental) ? messages.incremental : [],
        },
        activeTurnIdentity: { dialogProcessId, turnScopeId },
      }),
    },
    bindings: {
      runtime: {
        userId,
        systemRuntime: { sessionId, dialogProcessId, turnScopeId },
      },
    },
  };
}

test("terminal history reaches the model as canonical user/meta/injection/explanation messages", () => {
  const projected = projectTerminalHistoryMessages({
    messages: [
      {
        messageUid: "stopped-user",
        role: "user",
        content: "停止轮问题",
        frontendUserMessage: true,
        userName: "u1",
        sessionId: "s1",
        dialogProcessId: "dlg-stopped",
        turnScopeId: "turn-stopped",
        summarized: true,
      },
      {
        messageUid: "guidance-old",
        role: "user",
        content: "旧 guidance",
        injectedMessage: true,
        injectedBy: "harness-plugin",
        injectedMessageType: "guidance",
        dialogProcessId: "dlg-stopped",
        turnScopeId: "turn-stopped",
      },
      {
        messageUid: "tool-result",
        role: "tool",
        content: "工具结果",
        tool_call_id: "call-1",
        dialogProcessId: "dlg-stopped",
        turnScopeId: "turn-stopped",
      },
      {
        messageUid: "guidance-new",
        role: "user",
        content: "最新 guidance",
        injectedMessage: true,
        injectedBy: "harness-plugin",
        injectedMessageType: "guidance",
        dialogProcessId: "dlg-stopped",
        turnScopeId: "turn-stopped",
      },
    ],
    terminalStatuses: [
      {
        status: "user_stopped",
        reason: "user_stop",
        description: "用户停止了本轮生成",
        dialogProcessId: "dlg-stopped",
        turnScopeId: "turn-stopped",
      },
    ],
  });
  const history = toConversationMessages(projected);
  const blocks = buildContextMessageBlocks(
    buildAgentContext({
      sessionId: "s-current",
      messages: { history },
    }),
  );

  assert.deepEqual(
    blocks.history.map((item) => item.content),
    ["停止轮问题", blocks.history[1].content, "最新 guidance", "用户停止了本轮生成"],
  );
  assert.equal(blocks.history[1].content.startsWith("[用户元信息]"), true);
  assert.deepEqual(
    blocks.history.map((item) => item.additional_kwargs?.noobotMessageId),
    ["stopped-user", "stopped-user::user_meta", "guidance-new", "turn-stopped::terminal_status"],
  );
  assert.equal(blocks.history[3]._getType(), "human");
});

test("buildContextMessageBlocks builds user_meta with source info for historical user attachments", () => {
  const blocks = buildContextMessageBlocks(
    buildAgentContext({
      turnScopeId: "client-turn:current",
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
                sandboxPath:
                  "/workspace/primary-user/runtime/attach/scoped/s-history/user/att-history-1.md",
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
    }),
  );

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

test("historical user content and metadata remain distinct canonical projections", () => {
  const blocks = buildContextMessageBlocks(
    buildAgentContext({
      messages: {
        system: [],
        history: [
          {
            role: "user",
            content: "历史问题",
            messageUid: "sm_history_user",
            frontendUserMessage: true,
            dialogProcessId: "dlg-history",
            turnScopeId: "turn-history",
          },
        ],
      },
    }),
  );

  const context = createModelContext({
    messageBlocks: blocks,
  });
  const historicalUsers = context.messageBlocks.history;

  assert.deepEqual(
    historicalUsers.map((message) => message.content),
    ["历史问题", historicalUsers[1].content],
  );
  assert.equal(historicalUsers[1].content.startsWith("[用户元信息]"), true);
  assert.deepEqual(
    historicalUsers.map((message) => message.additional_kwargs?.noobotMessageId),
    ["sm_history_user", "sm_history_user::user_meta"],
  );
  assert.notEqual(historicalUsers[0], historicalUsers[1]);
});

test("persisted history keeps messageUid as its canonical model context identity", () => {
  const [persistedHistory] = toConversationMessages([
    {
      messageUid: "sm_persisted_history",
      role: "assistant",
      content: "历史回答",
      dialogProcessId: "dlg-history",
      turnScopeId: "turn-history",
    },
  ]);
  const blocks = buildContextMessageBlocks(
    buildAgentContext({
      messages: {
        system: [],
        history: [persistedHistory],
      },
    }),
  );
  const context = createModelContext({ messageBlocks: blocks });

  assert.equal(
    context.messageBlocks.history[0]?.additional_kwargs?.noobotMessageId,
    "sm_persisted_history",
  );
});

test("buildContextMessageBlocks does not infer frontend user metadata from round identity", () => {
  const blocks = buildContextMessageBlocks(
    buildAgentContext({
      messages: {
        system: [],
        history: [
          { role: "user", content: "无附件历史", dialogProcessId: "dlg-plain" },
          { role: "assistant", content: "普通回答", dialogProcessId: "dlg-plain" },
        ],
      },
    }),
  );

  assert.equal(blocks.history.length, 2);
  assert.equal(blocks.history[0]?.content, "无附件历史");
  assert.equal(blocks.history[0]?.additional_kwargs?.noobotInternalMessageType, undefined);
  assert.equal(blocks.history[1]?.content, "普通回答");
});

test("buildContextMessageBlocks keeps previous history rounds with same user text", () => {
  const blocks = buildContextMessageBlocks(
    buildAgentContext({
      turnScopeId: "client-turn:current",
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
    }),
    { currentUserMessage: createPersistedCurrentUserMessage("全仓回归测试") },
  );

  const visibleContents = blocks.messages
    .map((message) => message?.content)
    .filter((content) => typeof content === "string");

  assert.equal(visibleContents.filter((content) => content === "全仓回归测试").length, 2);
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
    buildAgentContext({
      dialogProcessId: "dlg_current",
      turnScopeId: "turn:current",
      messages: {
        system: [],
        history,
      },
    }),
    { currentUserMessage: createPersistedCurrentUserMessage("下一步") },
  );

  const visibleContents = blocks.messages
    .map((message) => message?.content)
    .filter((content) => typeof content === "string");

  assert.equal(visibleContents.filter((content) => content === "下一步").length, 6);
  for (const id of ["dlg_1", "dlg_2", "dlg_3", "dlg_4", "dlg_5"]) {
    assert.equal(visibleContents.includes(`${id} answer`), true, id);
  }
});
