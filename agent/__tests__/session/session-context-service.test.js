/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";

import { SessionContextService } from "../../src/session/services/session-context-service.js";

function createSessionContextService(messages = [], { globalConfig = {}, turnStatuses = [] } = {}) {
  return new SessionContextService({
    globalConfig,
    sessionService: {
      async getSessionContextSource() {
        return { messages, turnStatuses };
      },
    },
  });
}

function createIndexedSessionContextService(messages = [], dialogOrder = []) {
  return new SessionContextService({
    sessionService: {
      async getSessionContextSource() {
        return { messages, turnStatuses: [] };
      },
    },
  });
}

test("getRecentSessionMessages excludes history without dialog identity", async () => {
  const messages = [
    {
      role: "assistant",
      content: "",
      tool_calls: [{ id: "call_old", function: { name: "execute_script", arguments: "{}" } }],
    },
    {
      role: "tool",
      content: "{\"toolName\":\"execute_script\",\"ok\":true}",
      tool_call_id: "call_old",
    },
    {
      role: "user",
      content: "next task",
    },
    {
      role: "tool",
      content: "{\"toolName\":\"execute_script\",\"ok\":true}",
      tool_call_id: "call_old",
    },
  ];
  const service = createSessionContextService(messages);
  const result = await service.getRecentSessionMessages({
    userId: "u1",
    sessionId: "s1",
  });

  assert.deepEqual(result, []);
});

test("getRecentSessionMessages keeps explicit dialog group content in original order", async () => {
  const messages = [
    { role: "user", content: "please continue", dialogProcessId: "dlg_1" },
    { role: "assistant", content: "", dialogProcessId: "dlg_1" },
    {
      role: "assistant",
      content: "",
      dialogProcessId: "dlg_1",
      tool_calls: [{ id: "call_1", function: { name: "task_summary", arguments: "{}" } }],
    },
    {
      role: "tool",
      content: "{\"toolName\":\"task_summary\",\"ok\":true}",
      dialogProcessId: "dlg_1",
      tool_call_id: "call_1",
    },
  ];
  const service = createSessionContextService(messages);
  const result = await service.getRecentSessionMessages({
    userId: "u1",
    sessionId: "s1",
  });

  assert.deepEqual(
    result.map((messageItem) => messageItem.role),
    ["user", "assistant", "assistant", "tool"],
  );
});

test("getRecentSessionMessages respects summarized filter before window normalization", async () => {
  const messages = [
    { role: "user", content: "keep me", summarized: false, dialogProcessId: "dlg_1" },
    { role: "assistant", content: "old", summarized: true, dialogProcessId: "dlg_1" },
    { role: "assistant", content: "new", summarized: false, dialogProcessId: "dlg_1" },
  ];
  const service = createSessionContextService(messages);
  const result = await service.getRecentSessionMessages({
    userId: "u1",
    sessionId: "s1",
  });

  assert.deepEqual(
    result.map((messageItem) => messageItem.content),
    ["keep me", "new"],
  );
});

test("getRecentSessionMessages applies the terminal-history protocol before summarized filtering", async () => {
  const messages = [
    {
      messageUid: "stopped-user",
      role: "user",
      content: "停止轮问题",
      frontendUserMessage: true,
      summarized: true,
      dialogProcessId: "dlg_stopped",
      turnScopeId: "turn_stopped",
    },
    {
      messageUid: "stopped-guidance-old",
      role: "user",
      content: "旧 guidance",
      injectedMessage: true,
      injectedBy: "harness-plugin",
      injectedMessageType: "guidance",
      summarized: true,
      dialogProcessId: "dlg_stopped",
      turnScopeId: "turn_stopped",
    },
    {
      messageUid: "stopped-call",
      role: "assistant",
      content: "",
      tool_calls: [{ id: "call-stopped", name: "read" }],
      dialogProcessId: "dlg_stopped",
      turnScopeId: "turn_stopped",
    },
    {
      messageUid: "stopped-result",
      role: "tool",
      content: "不应进入 history 的工具结果",
      tool_call_id: "call-stopped",
      dialogProcessId: "dlg_stopped",
      turnScopeId: "turn_stopped",
    },
    {
      messageUid: "stopped-guidance-new",
      role: "user",
      content: "最新 guidance",
      injectedMessage: true,
      injectedBy: "harness-plugin",
      injectedMessageType: "guidance",
      summarized: false,
      dialogProcessId: "dlg_stopped",
      turnScopeId: "turn_stopped",
    },
    {
      messageUid: "completed-user",
      role: "user",
      content: "正常轮问题",
      summarized: false,
      dialogProcessId: "dlg_completed",
      turnScopeId: "turn_completed",
    },
    {
      messageUid: "completed-old-injection",
      role: "user",
      content: "正常轮未小结注入 1",
      injectedMessage: true,
      injectedBy: "harness-plugin",
      injectedMessageType: "guidance",
      summarized: false,
      dialogProcessId: "dlg_completed",
      turnScopeId: "turn_completed",
    },
    {
      messageUid: "completed-new-injection",
      role: "user",
      content: "正常轮未小结注入 2",
      injectedMessage: true,
      injectedBy: "harness-plugin",
      injectedMessageType: "guidance",
      summarized: false,
      dialogProcessId: "dlg_completed",
      turnScopeId: "turn_completed",
    },
  ];
  const service = createSessionContextService(messages, {
    turnStatuses: [{
      status: "user_stopped",
      reason: "user_stop",
      description: "用户停止了本轮生成",
      dialogProcessId: "dlg_stopped",
      turnScopeId: "turn_stopped",
    }, {
      status: "completed",
      reason: "run_completed",
      description: "本轮对话已正常完成",
      dialogProcessId: "dlg_completed",
      turnScopeId: "turn_completed",
    }],
  });

  const result = await service.getRecentSessionMessages({ userId: "u1", sessionId: "s1" });

  assert.deepEqual(result.map((item) => item.messageUid), [
    "stopped-user",
    "stopped-guidance-new",
    "turn_stopped::terminal_status",
    "completed-user",
    "completed-old-injection",
    "completed-new-injection",
  ]);
  assert.equal(result[2].role, "user");
  assert.equal(result[2].terminalHistoryExplanation, true);
});

test("getRecentSessionMessages projects error and timeout explanations as assistant messages", async () => {
  const messages = ["error", "timeout"].map((terminalStatus, index) => ({
    messageUid: `${terminalStatus}-user`,
    role: "user",
    content: `${terminalStatus} question`,
    frontendUserMessage: true,
    dialogProcessId: `${terminalStatus}-dialog`,
    turnScopeId: `${terminalStatus}-turn`,
    summarized: true,
  }));
  const turnStatuses = ["error", "timeout"].map((terminalStatus) => ({
    status: terminalStatus,
    reason: terminalStatus === "error" ? "run_error" : "run_timeout",
    description: `${terminalStatus} explanation`,
    dialogProcessId: `${terminalStatus}-dialog`,
    turnScopeId: `${terminalStatus}-turn`,
  }));
  const service = createSessionContextService(messages, { turnStatuses });

  const result = await service.getRecentSessionMessages({ userId: "u1", sessionId: "s1" });

  assert.deepEqual(result.map((item) => [item.messageUid, item.role]), [
    ["error-user", "user"],
    ["error-turn::terminal_status", "assistant"],
    ["timeout-user", "user"],
    ["timeout-turn::terminal_status", "assistant"],
  ]);
});

test("getRecentSessionMessages excludes an unmaterialized failed turn without blocking later history", async () => {
  const messages = [{
    messageUid: "completed-user",
    role: "user",
    content: "previous question",
    frontendUserMessage: true,
    dialogProcessId: "completed-dialog",
    turnScopeId: "completed-turn",
  }];
  const service = createSessionContextService(messages, {
    turnStatuses: [{
      status: "error",
      reason: "run_error",
      description: "session aggregate version conflict",
      dialogProcessId: "unmaterialized-dialog",
      turnScopeId: "unmaterialized-turn",
    }],
  });

  const result = await service.getRecentSessionMessages({ userId: "u1", sessionId: "s1" });

  assert.deepEqual(result, messages);
});

test("getRecentSessionMessages keeps latest fixed dialog rounds and all unsummarized injected messages", async () => {
  const messages = [
    { role: "user", content: "first real question", dialogProcessId: "dlg_1" },
    {
      role: "user",
      content: "[Relay from plugin/planning]\nold plan 1",
      dialogProcessId: "dlg_1",
    },
    { role: "assistant", content: "first real answer", dialogProcessId: "dlg_1" },
    { role: "user", content: "second real question", dialogProcessId: "dlg_2" },
    {
      role: "user",
      content: "[Relay from plugin/planning_revision]\nold plan 2",
      dialogProcessId: "dlg_2",
    },
    {
      role: "user",
      content: "[Relay from plugin/planning_revision]\nlatest plan 2",
      dialogProcessId: "dlg_2",
    },
    { role: "assistant", content: "second real answer", dialogProcessId: "dlg_2" },
    { role: "user", content: "third real question", dialogProcessId: "dlg_3" },
    {
      role: "user",
      content: "[Relay from plugin/planning]\ncurrent plan",
      dialogProcessId: "dlg_3",
    },
    { role: "assistant", content: "third real answer", dialogProcessId: "dlg_3" },
  ];
  const service = createSessionContextService(messages);
  const result = await service.getRecentSessionMessages({
    userId: "u1",
    sessionId: "s1",
  });

  assert.deepEqual(
    result.map((messageItem) => messageItem.content),
    [
      "first real question",
      "[Relay from plugin/planning]\nold plan 1",
      "first real answer",
      "second real question",
      "[Relay from plugin/planning_revision]\nold plan 2",
      "[Relay from plugin/planning_revision]\nlatest plan 2",
      "second real answer",
      "third real question",
      "[Relay from plugin/planning]\ncurrent plan",
      "third real answer",
    ],
  );
});

test("getRecentSessionMessages excludes current turn user when reusing an edited turn", async () => {
  const messages = [
    {
      role: "user",
      content: "上一轮问题",
      dialogProcessId: "dlg_old",
      turnScopeId: "client-turn:old",
    },
    {
      role: "assistant",
      content: "上一轮回答",
      dialogProcessId: "dlg_old",
      turnScopeId: "client-turn:old",
    },
    {
      role: "user",
      content: "全仓回归测试",
      dialogProcessId: "dlg_current",
      turnScopeId: "client-turn:mqrt1icf:lxcfigpr",
    },
    {
      role: "assistant",
      content: "旧的待替换回答",
      dialogProcessId: "dlg_current",
      turnScopeId: "client-turn:mqrt1icf:lxcfigpr",
    },
  ];
  const service = createSessionContextService(messages);
  const result = await service.getRecentSessionMessages({
    userId: "u1",
    sessionId: "s1",
    currentTurnScopeId: "client-turn:mqrt1icf:lxcfigpr",
  });

  assert.deepEqual(
    result.map((messageItem) => messageItem.content),
    ["上一轮问题", "上一轮回答"],
  );
});

test("getContextRecords passes current turn filter through recent history", async () => {
  const messages = [
    {
      role: "user",
      content: "历史问题",
      dialogProcessId: "dlg_old",
      turnScopeId: "client-turn:old",
    },
    {
      role: "assistant",
      content: "历史回答",
      dialogProcessId: "dlg_old",
      turnScopeId: "client-turn:old",
    },
    {
      role: "user",
      content: "全仓回归测试",
      dialogProcessId: "dlg_current",
      turnScopeId: "client-turn:mqrt1icf:lxcfigpr",
    },
    {
      role: "assistant",
      content: "旧回答",
      dialogProcessId: "dlg_current",
      turnScopeId: "client-turn:mqrt1icf:lxcfigpr",
    },
  ];
  const service = createSessionContextService(messages);
  const result = await service.getContextRecords({
    userId: "u1",
    sessionId: "s1",
    currentTurnScopeId: "client-turn:mqrt1icf:lxcfigpr",
  });

  assert.deepEqual(
    result.map((messageItem) => messageItem.content),
    ["历史问题", "历史回答"],
  );
});

test("current terminal round is excluded from both authoritative snapshot dimensions", async () => {
  const messages = [{
    messageUid: "current-user",
    role: "user",
    content: "当前问题",
    frontendUserMessage: true,
    dialogProcessId: "dlg_current",
    turnScopeId: "turn_current",
  }];
  const service = createSessionContextService(messages, {
    turnStatuses: [{
      status: "user_stopped",
      reason: "user_stop",
      description: "用户停止了本轮生成",
      dialogProcessId: "dlg_current",
      turnScopeId: "turn_current",
    }],
  });

  const result = await service.getContextRecords({
    userId: "u1",
    sessionId: "s1",
    currentDialogProcessId: "dlg_current",
    currentTurnScopeId: "turn_current",
  });

  assert.deepEqual(result, []);
});

test("getRecentSessionMessages selects fixed latest previous dialogProcessId rounds", async () => {
  const messages = [];
  for (const id of ["dlg_1", "dlg_2", "dlg_3", "dlg_4", "dlg_current"]) {
    messages.push({
      role: "user",
      content: `${id} user`,
      dialogProcessId: id,
      turnScopeId: `turn:${id}`,
    });
    if (id !== "dlg_current") {
      messages.push({
        role: "assistant",
        content: `${id} assistant`,
        dialogProcessId: id,
        turnScopeId: `turn:${id}`,
      });
    }
  }
  const service = createSessionContextService(messages);
  const result = await service.getRecentSessionMessages({
    userId: "u1",
    sessionId: "s1",
    currentDialogProcessId: "dlg_current",
    currentTurnScopeId: "turn:dlg_current",
  });

  assert.deepEqual(
    result.map((messageItem) => messageItem.content),
    [
      "dlg_1 user",
      "dlg_1 assistant",
      "dlg_2 user",
      "dlg_2 assistant",
      "dlg_3 user",
      "dlg_3 assistant",
      "dlg_4 user",
      "dlg_4 assistant",
    ],
  );
});

test("getContextRecords uses fixed latest dialog history", async () => {
  const messages = [
    { role: "user", content: "origin user", dialogProcessId: "dlg_1" },
    { role: "assistant", content: "old answer", dialogProcessId: "dlg_1" },
    {
      role: "assistant",
      content: "",
      taskStatus: "start",
      dialogProcessId: "dlg_2",
      tool_calls: [{ id: "call_run", function: { name: "execute_script", arguments: "{}" } }],
    },
    {
      role: "tool",
      content: "{\"toolName\":\"execute_script\",\"ok\":true}",
      tool_call_id: "call_run",
      dialogProcessId: "dlg_2",
    },
    { role: "user", content: "latest user", dialogProcessId: "dlg_3" },
  ];
  const service = createSessionContextService(messages);

  const result = await service.getContextRecords({
    userId: "u1",
    sessionId: "s1",
  });

  assert.deepEqual(
    result.map((messageItem) => messageItem.content),
    [
      "origin user",
      "old answer",
      "",
      "{\"toolName\":\"execute_script\",\"ok\":true}",
      "latest user",
    ],
  );
});

test("getRecentSessionMessages uses message first occurrence as the only model history order", async () => {
  const messages = [
    { role: "user", content: "d6 user", dialogProcessId: "d6" },
    { role: "assistant", content: "d1 late append", dialogProcessId: "d1" },
    { role: "user", content: "d1 user", dialogProcessId: "d1" },
    { role: "user", content: "d2 user", dialogProcessId: "d2" },
    { role: "user", content: "d3 user", dialogProcessId: "d3" },
    { role: "user", content: "d4 user", dialogProcessId: "d4" },
    { role: "user", content: "d5 user", dialogProcessId: "d5" },
  ];
  const service = createIndexedSessionContextService(messages, [
    { dialogProcessId: "d1", dialogOrdinal: 1 },
    { dialogProcessId: "d2", dialogOrdinal: 2 },
    { dialogProcessId: "d3", dialogOrdinal: 3 },
    { dialogProcessId: "d4", dialogOrdinal: 4 },
    { dialogProcessId: "d5", dialogOrdinal: 5 },
    { dialogProcessId: "d6", dialogOrdinal: 6 },
  ]);

  const result = await service.getRecentSessionMessages({
    userId: "u1",
    sessionId: "s1",
  });

  assert.deepEqual(result.map((messageItem) => messageItem.content), [
    "d1 late append", "d1 user", "d2 user", "d3 user", "d4 user", "d5 user",
  ]);
});

test("session context config always uses the central main history round limit", async () => {
  const service = createSessionContextService([]);

  const result = service._sessionContextConfig();

  assert.equal(result.historyRoundLimit, 5);
});

test("session context reads messages and terminal statuses from the same parent-scoped snapshot", async () => {
  let received = null;
  const service = new SessionContextService({
    sessionMessageService: {
      async getSessionContextSource(payload) {
        received = payload;
        return { messages: [], turnStatuses: [] };
      },
    },
  });

  await service.getContextRecords({
    userId: "u1",
    sessionId: "child-1",
    parentSessionId: "parent-1",
  });

  assert.deepEqual(received, {
    userId: "u1",
    sessionId: "child-1",
    parentSessionId: "parent-1",
  });
});
