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
import { createTestAgentExecutionScope } from "../../helpers/agent-execution-scope.js";

const MAIN_MODEL_HISTORY_ROUND_LIMIT = TURN_THRESHOLDS.session.mainModelHistoryRoundLimit;
import { createPersistedCurrentUserMessage } from "./message-builder-current-user-fixture.js";

function createMessageBlockScope(runtime, messageBlocks) {
  return createTestAgentExecutionScope(runtime, {
    identity: {
      userId: runtime.userId,
      sessionId: runtime.systemRuntime.sessionId,
      parentSessionId: runtime.systemRuntime.parentSessionId,
      dialogProcessId: runtime.systemRuntime.dialogProcessId,
      turnScopeId: runtime.systemRuntime.turnScopeId,
    },
    messageBlocks,
  });
}

test("buildContextMessageBlocks splits system/history/incremental and preserves concat order", () => {
  const blocks = buildContextMessageBlocks(
    createMessageBlockScope(
      { userId: "u1", systemRuntime: { sessionId: "s1", dialogProcessId: "dlg1" } },
      {
        system: ["sys-1"],
        history: [
          { role: "user", content: "h-u", dialogProcessId: "dlg-history" },
          { role: "assistant", content: "h-1", dialogProcessId: "dlg-history" },
        ],
      },
    ),
    { currentUserMessage: createPersistedCurrentUserMessage("u-1") },
  );

  assert.equal(Array.isArray(blocks.system), true);
  assert.equal(Array.isArray(blocks.history), true);
  assert.equal(Array.isArray(blocks.incremental), true);
  assert.equal(blocks.system.length, 1);
  assert.equal(blocks.history.length, 2);
  assert.equal(blocks.incremental.length, 2);
  assert.equal(blocks.messages.length, 5);
  assert.equal(blocks.messages[0]?.content, "sys-1");
  assert.equal(blocks.messages[1]?.content, "h-u");
  assert.equal(blocks.messages[2]?.content, "h-1");
  assert.equal(blocks.messages[3]?.content, "u-1");
  assert.equal(blocks.messages[3]?.additional_kwargs?.noobotMessageId, "sm_current_user_fixture");
  assert.equal(blocks.messages[4]?.additional_kwargs?.noobotInternalMessageType, "user_meta");
  assert.equal(
    blocks.messages[4]?.additional_kwargs?.noobotMessageId,
    "sm_current_user_fixture::user_meta",
  );
});

test("buildContextMessageBlocks appends resume user message meta with attachments", () => {
  const blocks = buildContextMessageBlocks(
    createMessageBlockScope(
      {
        userId: "admin",
        userMessageAttachments: [
          {
            attachmentId: "att-1",
            name: "resume.txt",
            mimeType: "text/plain",
            attachmentSource: "user",
            sessionId: "s1",
          },
        ],
        systemRuntime: {
          sessionId: "s1",
          parentSessionId: "parent-s1",
          dialogProcessId: "dlg-resume-new",
          parentDialogProcessId: "dlg-stopped",
          turnScopeId: "turn-resume-new",
        },
      },
      {
        system: ["snapshot system"],
        history: [
          {
            role: "user",
            content: "snapshot user",
            frontendUserMessage: true,
            dialogProcessId: "dlg-stopped",
            turnScopeId: "turn-stopped",
            attachments: [],
          },
          {
            role: "assistant",
            content: "snapshot assistant",
            dialogProcessId: "dlg-stopped",
            turnScopeId: "turn-stopped",
          },
        ],
      },
    ),
    {
      currentUserMessage: createPersistedCurrentUserMessage("resume question", {
        userName: "admin",
        sessionId: "s1",
        parentSessionId: "parent-s1",
        dialogProcessId: "dlg-resume-new",
        parentDialogProcessId: "dlg-stopped",
        turnScopeId: "turn-resume-new",
        attachments: [
          {
            attachmentId: "att-1",
            name: "resume.txt",
            mimeType: "text/plain",
            attachmentSource: "user",
            sessionId: "s1",
          },
        ],
      }),
    },
  );

  assert.equal(blocks.system[0]?.content, "snapshot system");
  assert.equal(blocks.history[0]?.content, "snapshot user");
  assert.equal(
    blocks.history.some((message) => message?.content === "snapshot assistant"),
    true,
  );
  assert.equal(
    blocks.history.some(
      (message) =>
        message?.additional_kwargs?.noobotInternalMessageType === "user_meta" &&
        String(message?.content || "").includes('"dialogProcessId": "dlg-stopped"'),
    ),
    true,
  );
  assert.equal(blocks.incremental[0]?.content, "resume question");
  const meta = blocks.incremental[1]?.content || "";
  assert.match(meta, /\[用户元信息\]/);
  assert.match(meta, /"attachmentRef": "attachment:v1:s1\/user\/att-1"/);
  assert.match(meta, /"name": "resume.txt"/);
  assert.match(meta, /"dialogProcessId": "dlg-resume-new"/);
  assert.match(meta, /"turnScopeId": "turn-resume-new"/);
});

test("buildContextMessageBlocks reads restored stopped snapshot messages from unified history", () => {
  const blocks = buildContextMessageBlocks(
    createMessageBlockScope(
      {
        userId: "admin",
        resumeFromStoppedSnapshot: true,
        userMessageAttachments: [
          {
            attachmentId: "att-resume",
            sessionId: "s1",
            attachmentSource: "user",
            name: "resume.png",
            mimeType: "image/png",
          },
        ],
        systemRuntime: {
          sessionId: "s1",
          dialogProcessId: "dlg-current",
          parentDialogProcessId: "dlg-stopped",
          turnScopeId: "turn-current",
        },
      },
      {
        system: ["[HARNESS_POLICY_SELECTION]\nsnapshot policy"],
        history: [
          {
            role: "user",
            content: "snapshot history user",
            dialogProcessId: "dlg-stopped",
            turnScopeId: "turn-stopped",
          },
          {
            role: "assistant",
            content: "snapshot partial assistant",
            dialogProcessId: "dlg-stopped",
            turnScopeId: "turn-stopped",
          },
        ],
      },
    ),
    {
      currentUserMessage: createPersistedCurrentUserMessage("resume user input", {
        userName: "admin",
        dialogProcessId: "dlg-current",
        turnScopeId: "turn-current",
        parentDialogProcessId: "dlg-stopped",
        attachments: [
          {
            attachmentId: "att-resume",
            sessionId: "s1",
            attachmentSource: "user",
            name: "resume.png",
            mimeType: "image/png",
          },
        ],
      }),
    },
  );

  assert.equal(blocks.system.length, 1);
  assert.equal(blocks.system[0]?.content, "[HARNESS_POLICY_SELECTION]\nsnapshot policy");
  assert.equal(blocks.history[0]?.content, "snapshot history user");
  assert.equal(
    blocks.history.some((message) => message?.content === "snapshot partial assistant"),
    true,
  );
  assert.equal(blocks.incremental[0]?.content, "resume user input");
  assert.match(String(blocks.incremental[1]?.content || ""), /\[用户元信息\]/);
  assert.match(
    String(blocks.incremental[1]?.content || ""),
    /"attachmentRef": "attachment:v1:s1\/user\/att-resume"/,
  );
  const contents = blocks.messages.map((message) => message?.content);
  assert.equal(contents[0], "[HARNESS_POLICY_SELECTION]\nsnapshot policy");
  assert.equal(contents[1], "snapshot history user");
  assert.equal(
    contents.indexOf("snapshot partial assistant") < contents.indexOf("resume user input"),
    true,
  );
  assert.equal(contents.indexOf("resume user input") < contents.length - 1, true);
  assert.match(String(contents[contents.length - 1] || ""), /"dialogProcessId": "dlg-current"/);
});

test("buildContextMessageBlocks adapts restored protocol tool messages into LangChain history", () => {
  const blocks = buildContextMessageBlocks(
    createMessageBlockScope(
      {
        userId: "admin",
        resumeFromStoppedSnapshot: true,
        userMessageAttachments: [],
        systemRuntime: {
          sessionId: "s1",
          dialogProcessId: "dlg-current",
          parentDialogProcessId: "dlg-stopped",
          turnScopeId: "turn-current",
        },
      },
      {
        system: ["snapshot system"],
        history: [
          {
            role: "assistant",
            content: "",
            tool_calls: [{ id: "call_resume_1", name: "read_file", args: { filePath: "a.txt" } }],
            dialogProcessId: "dlg-stopped",
          },
          {
            role: "tool",
            toolCallId: "call_resume_1",
            content: "tool result text",
            dialogProcessId: "dlg-stopped",
          },
        ],
      },
    ),
    { currentUserMessage: createPersistedCurrentUserMessage("resume user input") },
  );

  assert.equal(blocks.history[0]?._getType?.(), "ai");
  assert.equal(blocks.history[0]?.tool_calls?.[0]?.id, "call_resume_1");
  assert.equal(blocks.history[1]?._getType?.(), "tool");
  assert.equal(blocks.history[1]?.tool_call_id, "call_resume_1");
  assert.equal(blocks.history[1]?.content, "tool result text");
  assert.equal(blocks.incremental[0]?._getType?.(), "human");
  assert.equal(blocks.incremental[0]?.content, "resume user input");
  assert.equal(
    blocks.messages.some(
      (message) => message?._getType?.() === "human" && String(message?.content || "") === "",
    ),
    false,
  );
});

test("buildContextMessageBlocks removes current turn user residue from history", () => {
  const blocks = buildContextMessageBlocks(
    createMessageBlockScope(
      {
        userId: "u1",
        systemRuntime: {
          sessionId: "s1",
          dialogProcessId: "dlg-current",
          turnScopeId: "client-turn:mqrt1icf:lxcfigpr",
        },
      },
      {
        system: [],
        history: [
          {
            role: "user",
            content: "上一轮问题",
            dialogProcessId: "dlg-old",
            turnScopeId: "client-turn:old",
          },
          {
            role: "assistant",
            content: "上一轮回答",
            dialogProcessId: "dlg-old",
            turnScopeId: "client-turn:old",
          },
          {
            role: "user",
            content: "全仓回归测试",
            dialogProcessId: "dlg-resend-stale",
            turnScopeId: "client-turn:mqrt1icf:lxcfigpr",
          },
        ],
      },
    ),
    {
      currentUserMessage: createPersistedCurrentUserMessage("全仓回归测试", {
        dialogProcessId: "dlg-current",
        turnScopeId: "client-turn:mqrt1icf:lxcfigpr",
      }),
    },
  );

  const visibleContents = blocks.messages
    .map((message) => message?.content)
    .filter((content) => typeof content === "string");

  assert.equal(visibleContents.filter((content) => content === "全仓回归测试").length, 1);
  assert.equal(blocks.history.length, 3);
  assert.equal(blocks.incremental[0]?.content, "全仓回归测试");
  assert.equal(blocks.incremental[0]?.additional_kwargs?.frontendUserMessage, true);
  assert.equal(
    blocks.incremental[0]?.additional_kwargs?.turnScopeId,
    "client-turn:mqrt1icf:lxcfigpr",
  );
  assert.equal(blocks.incremental[0]?.additional_kwargs?.dialogProcessId, "dlg-current");
  assert.equal(blocks.incremental[1]?.additional_kwargs?.noobotInternalMessageType, "user_meta");
  assert.equal(
    blocks.incremental[1]?.additional_kwargs?.turnScopeId,
    "client-turn:mqrt1icf:lxcfigpr",
  );
});

test("buildContextMessageBlocks does not duplicate frontend current user already in incremental payload", () => {
  const blocks = buildContextMessageBlocks(
    createMessageBlockScope(
      {
        userId: "u1",
        systemRuntime: {
          sessionId: "s1",
          dialogProcessId: "dlg-current",
          turnScopeId: "client-turn:current",
        },
      },
      {
        system: [],
        history: [
          {
            role: "user",
            content: "上一轮",
            dialogProcessId: "dlg-old",
            turnScopeId: "client-turn:old",
          },
          {
            role: "assistant",
            content: "上一轮回答",
            dialogProcessId: "dlg-old",
            turnScopeId: "client-turn:old",
          },
        ],
        incremental: [
          {
            messageUid: "sm_current_user_fixture",
            role: "user",
            content: "全仓回归测试",
            frontendUserMessage: true,
            dialogProcessId: "dlg-current",
            turnScopeId: "client-turn:current",
          },
        ],
      },
    ),
    {
      currentUserMessage: createPersistedCurrentUserMessage("全仓回归测试", {
        dialogProcessId: "dlg-current",
        turnScopeId: "client-turn:current",
      }),
    },
  );

  const visibleContents = blocks.messages
    .map((message) => message?.content)
    .filter((content) => typeof content === "string");

  assert.equal(visibleContents.filter((content) => content === "全仓回归测试").length, 1);
  assert.equal(blocks.incremental[0]?.content, "全仓回归测试");
  assert.equal(blocks.incremental[0]?.additional_kwargs?.frontendUserMessage, true);
  assert.equal(blocks.incremental[0]?.additional_kwargs?.turnScopeId, "client-turn:current");
  assert.equal(blocks.incremental[1]?.additional_kwargs?.noobotInternalMessageType, "user_meta");
});
